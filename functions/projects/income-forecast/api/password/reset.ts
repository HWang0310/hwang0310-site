import type { AppRole } from "../../../../../shared/income-forecast/contracts";
import type { AuditEventInput } from "../../../../_lib/audit";
import { writeAudit } from "../../../../_lib/audit";
import { type Env, requireEnv } from "../../../../_lib/env";
import { HttpError, json, requireSameOrigin } from "../../../../_lib/http";
import {
  clearedCookieHeaders,
  errorResponse,
  isAppRole,
  newPassword,
  readPasswordJson,
  recoveryTokenHash,
  sessionResponse,
} from "../../../../_lib/password";
import type { ProfileRecord } from "../../../../_lib/session";
import {
  createPublicSupabaseClient,
  createServiceRoleSupabaseClient,
} from "../../../../_lib/supabase";

const RESET_KEYS = new Set(["tokenHash", "password"]);
const INVALID_RECOVERY = "重置链接无效或已过期";

export type PasswordAuthSession = {
  userId: string;
  role: AppRole;
  accessToken: string;
  refreshToken: string;
};

export type ResetPasswordDependencies = {
  verifyRecoveryToken(
    tokenHash: string,
    type: "recovery",
  ): Promise<PasswordAuthSession | null>;
  getProfile(userId: string): Promise<ProfileRecord | null>;
  updatePassword(password: string): Promise<void>;
  markPasswordChanged(userId: string): Promise<void>;
  revokeSessions(accessToken: string): Promise<void>;
  signInWithPassword(
    phone: string,
    password: string,
  ): Promise<PasswordAuthSession | null>;
  writeAudit(event: AuditEventInput): Promise<void>;
};

function profileFromRow(row: {
  user_id: string;
  full_name: string;
  employee_no: string;
  phone: string;
  email: string;
  role: ProfileRecord["role"];
  is_active: boolean;
  uses_initial_password: boolean;
  must_change_password: boolean;
}): ProfileRecord {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    employeeNo: row.employee_no,
    phone: row.phone,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    usesInitialPassword: row.uses_initial_password,
    mustChangePassword: row.must_change_password,
  };
}

function authServiceError(): never {
  throw new HttpError(503, "密码服务暂不可用");
}

function defaultDependencies(
  env: Env,
  config: ReturnType<typeof requireEnv>,
): ResetPasswordDependencies {
  const authClient = createPublicSupabaseClient(config);
  const serviceClient = createServiceRoleSupabaseClient(config);

  return {
    async verifyRecoveryToken(tokenHash, type) {
      try {
        const response = await authClient.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (response.error !== null) {
          if ((response.error.status ?? 500) >= 500) authServiceError();
          return null;
        }
        const user = response.data.user;
        const session = response.data.session;
        const role = user?.app_metadata.role;
        if (
          user === null ||
          session === null ||
          !isAppRole(role)
        ) {
          authServiceError();
        }
        return {
          userId: user.id,
          role,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        authServiceError();
      }
    },

    async getProfile(userId) {
      try {
        const response = await serviceClient
          .from("profiles")
          .select(
            "user_id,full_name,employee_no,phone,email,role,is_active,uses_initial_password,must_change_password",
          )
          .eq("user_id", userId)
          .maybeSingle();
        if (response.error !== null) authServiceError();
        return response.data === null ? null : profileFromRow(response.data);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        authServiceError();
      }
    },

    async updatePassword(password) {
      try {
        const response = await authClient.auth.updateUser({ password });
        if (response.error !== null || response.data.user === null) {
          authServiceError();
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        authServiceError();
      }
    },

    async markPasswordChanged(userId) {
      try {
        const response = await serviceClient
          .from("profiles")
          .update({
            uses_initial_password: false,
            must_change_password: false,
          })
          .eq("user_id", userId)
          .select("user_id,uses_initial_password,must_change_password")
          .maybeSingle();
        if (
          response.error !== null ||
          response.data === null ||
          response.data.user_id !== userId ||
          response.data.uses_initial_password !== false ||
          response.data.must_change_password !== false
        ) {
          authServiceError();
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        authServiceError();
      }
    },

    async revokeSessions(accessToken) {
      try {
        const response = await serviceClient.auth.admin.signOut(
          accessToken,
          "global",
        );
        if (response.error !== null) authServiceError();
      } catch (error) {
        if (error instanceof HttpError) throw error;
        authServiceError();
      }
    },

    async signInWithPassword(phone, password) {
      try {
        const response = await authClient.auth.signInWithPassword({
          phone,
          password,
        });
        if (response.error !== null) authServiceError();
        const user = response.data.user;
        const session = response.data.session;
        const role = user?.app_metadata.role;
        if (user === null || session === null || !isAppRole(role)) {
          authServiceError();
        }
        return {
          userId: user.id,
          role,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        authServiceError();
      }
    },

    writeAudit: (event) => writeAudit(env, event),
  };
}

function trustedRecoveryProfile(
  auth: PasswordAuthSession,
  profile: ProfileRecord | null,
): profile is ProfileRecord {
  return (
    profile !== null &&
    profile.isActive &&
    profile.userId === auth.userId &&
    profile.role === auth.role
  );
}

async function bestEffortRevoke(
  dependencies: ResetPasswordDependencies,
  accessToken: string | null,
): Promise<void> {
  if (accessToken === null) return;
  try {
    await dependencies.revokeSessions(accessToken);
  } catch {
    // The caller returns no token or authenticated cookie after cleanup failure.
  }
}

async function postResetPassword(
  request: Request,
  dependencies: ResetPasswordDependencies,
): Promise<Response> {
  const body = await readPasswordJson(request, RESET_KEYS);
  const tokenHash = recoveryTokenHash(body.tokenHash);
  const password = newPassword(body.password);
  let recoveryAccessToken: string | null = null;
  let newAccessToken: string | null = null;
  let passwordMutationStarted = false;
  let actorUserId: string | null = null;

  try {
    const auth = await dependencies.verifyRecoveryToken(tokenHash, "recovery");
    if (auth === null) {
      throw new HttpError(400, INVALID_RECOVERY);
    }
    recoveryAccessToken = auth.accessToken;
    actorUserId = auth.userId;
    const profile = await dependencies.getProfile(auth.userId);
    if (!trustedRecoveryProfile(auth, profile)) {
      await bestEffortRevoke(dependencies, recoveryAccessToken);
      recoveryAccessToken = null;
      throw new HttpError(400, INVALID_RECOVERY);
    }

    passwordMutationStarted = true;
    await dependencies.updatePassword(password);
    await dependencies.markPasswordChanged(profile.userId);
    await dependencies.revokeSessions(recoveryAccessToken);
    recoveryAccessToken = null;

    const nextSession = await dependencies.signInWithPassword(
      profile.phone,
      password,
    );
    if (
      nextSession === null ||
      nextSession.userId !== profile.userId ||
      nextSession.role !== profile.role
    ) {
      await bestEffortRevoke(
        dependencies,
        nextSession?.accessToken ?? null,
      );
      throw new HttpError(503, "密码服务暂不可用");
    }
    newAccessToken = nextSession.accessToken;
    await dependencies.writeAudit({
      action: "password.reset",
      actorUserId: profile.userId,
      targetType: "account",
      targetId: profile.userId,
      result: true,
    });
    return sessionResponse(nextSession);
  } catch (error) {
    await Promise.all([
      bestEffortRevoke(dependencies, recoveryAccessToken),
      bestEffortRevoke(dependencies, newAccessToken),
    ]);
    try {
      await dependencies.writeAudit({
        action: "password.reset",
        actorUserId,
        targetType: "account",
        targetId: actorUserId,
        result: false,
        metadata: {
          reason:
            error instanceof HttpError && error.status === 400
              ? "invalid_recovery"
              : "service_failure",
        },
      });
    } catch {
      // Preserve the original failure and never expose recovery material.
    }
    return errorResponse(
      error,
      passwordMutationStarted ? clearedCookieHeaders() : undefined,
    );
  }
}

export async function handleResetPasswordRequest(
  request: Request,
  env: Env,
  injectedDependencies?: ResetPasswordDependencies,
): Promise<Response> {
  try {
    const config = requireEnv(env);
    requireSameOrigin(request, config.siteOrigin);
    if (request.method.toUpperCase() !== "POST") {
      return json(
        { error: "请求方法不允许" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    return await postResetPassword(
      request,
      injectedDependencies ?? defaultDependencies(env, config),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) =>
  handleResetPasswordRequest(context.request, context.env);
