import type { AuditEventInput } from "../../../../_lib/audit";
import { writeAudit } from "../../../../_lib/audit";
import { type Env, requireEnv } from "../../../../_lib/env";
import { HttpError, json, requireSameOrigin } from "../../../../_lib/http";
import {
  clearedCookieHeaders,
  currentPassword,
  errorResponse,
  isAppRole,
  newPassword,
  readPasswordJson,
  sessionResponse,
} from "../../../../_lib/password";
import { getSession, type SessionUser } from "../../../../_lib/session";
import {
  createPublicSupabaseClient,
  createServiceRoleSupabaseClient,
} from "../../../../_lib/supabase";
import type { PasswordAuthSession } from "./reset";

const CHANGE_KEYS = new Set(["currentPassword", "newPassword"]);

export type ChangePasswordDependencies = {
  getSession(request: Request): Promise<SessionUser | null>;
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<PasswordAuthSession | null>;
  updatePassword(password: string): Promise<void>;
  markPasswordChanged(userId: string): Promise<void>;
  revokeSessions(accessToken: string): Promise<void>;
  establishSession(
    email: string,
    password: string,
  ): Promise<PasswordAuthSession | null>;
  writeAudit(event: AuditEventInput): Promise<void>;
};

function authServiceError(): never {
  throw new HttpError(503, "密码服务暂不可用");
}

function defaultDependencies(
  env: Env,
  config: ReturnType<typeof requireEnv>,
): ChangePasswordDependencies {
  const authClient = createPublicSupabaseClient(config);
  const serviceClient = createServiceRoleSupabaseClient(config);

  const signIn = async (
    email: string,
    password: string,
    invalidCredentialsAreNull: boolean,
  ): Promise<PasswordAuthSession | null> => {
    try {
      const response = await authClient.auth.signInWithPassword({ email, password });
      if (response.error !== null) {
        if (invalidCredentialsAreNull && (response.error.status ?? 500) < 500) {
          return null;
        }
        authServiceError();
      }
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
  };

  return {
    getSession: (request) => getSession(request, env),
    signInWithPassword: (phone, password) => signIn(phone, password, true),

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

    establishSession: (phone, password) => signIn(phone, password, false),
    writeAudit: (event) => writeAudit(env, event),
  };
}

async function bestEffortRevoke(
  dependencies: ChangePasswordDependencies,
  accessToken: string | null,
): Promise<void> {
  if (accessToken === null) return;
  try {
    await dependencies.revokeSessions(accessToken);
  } catch {
    // No token is returned and no authenticated cookie is issued on failure.
  }
}

async function postChangePassword(
  request: Request,
  dependencies: ChangePasswordDependencies,
): Promise<Response> {
  const session = await dependencies.getSession(request);
  if (session === null) {
    throw new HttpError(401, "请先登录");
  }

  const body = await readPasswordJson(request, CHANGE_KEYS);
  const oldPassword = currentPassword(body.currentPassword);
  const password = newPassword(body.newPassword);
  if (oldPassword === password) {
    throw new HttpError(400, "新密码不能与当前密码相同");
  }

  let reauthAccessToken: string | null = null;
  let newAccessToken: string | null = null;
  let passwordMutationStarted = false;
  try {
    const reauthenticated = await dependencies.signInWithPassword(
      session.email,
      oldPassword,
    );
    if (reauthenticated === null) {
      throw new HttpError(401, "当前密码错误");
    }
    reauthAccessToken = reauthenticated.accessToken;
    if (
      reauthenticated.userId !== session.id ||
      reauthenticated.role !== session.role
    ) {
      await bestEffortRevoke(dependencies, reauthAccessToken);
      reauthAccessToken = null;
      throw new HttpError(401, "当前密码错误");
    }

    passwordMutationStarted = true;
    await dependencies.updatePassword(password);
    await dependencies.markPasswordChanged(session.id);
    await dependencies.revokeSessions(reauthAccessToken);
    reauthAccessToken = null;

    const established = await dependencies.establishSession(
      session.email,
      password,
    );
    if (
      established === null ||
      established.userId !== session.id ||
      established.role !== session.role
    ) {
      await bestEffortRevoke(
        dependencies,
        established?.accessToken ?? null,
      );
      throw new HttpError(503, "密码服务暂不可用");
    }
    newAccessToken = established.accessToken;
    await dependencies.writeAudit({
      action: "password.change",
      actorUserId: session.id,
      targetType: "account",
      targetId: session.id,
      result: true,
    });
    return sessionResponse(established, {
      id: session.id,
      name: session.name,
      role: session.role,
    });
  } catch (error) {
    await Promise.all([
      bestEffortRevoke(dependencies, reauthAccessToken),
      bestEffortRevoke(dependencies, newAccessToken),
    ]);
    try {
      await dependencies.writeAudit({
        action: "password.change",
        actorUserId: session.id,
        targetType: "account",
        targetId: session.id,
        result: false,
        metadata: {
          reason:
            error instanceof HttpError && error.status === 401
              ? "reauthentication_failed"
              : "service_failure",
        },
      });
    } catch {
      // Preserve the original failure and never include credential material.
    }
    return errorResponse(
      error,
      passwordMutationStarted ? clearedCookieHeaders() : undefined,
    );
  }
}

export async function handleChangePasswordRequest(
  request: Request,
  env: Env,
  injectedDependencies?: ChangePasswordDependencies,
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
    return await postChangePassword(
      request,
      injectedDependencies ?? defaultDependencies(env, config),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) =>
  handleChangePasswordRequest(context.request, context.env);
