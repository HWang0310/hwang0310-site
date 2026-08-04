import type { AuditEventInput } from "../../../../_lib/audit";
import { writeAudit } from "../../../../_lib/audit";
import { type Env, requireEnv } from "../../../../_lib/env";
import {
  HttpError,
  json,
  maskEmail,
  normalizeName,
  requireSameOrigin,
} from "../../../../_lib/http";
import { errorResponse, readPasswordJson } from "../../../../_lib/password";
import {
  createPasswordRecoveryRateLimitRpc,
  hmacRateLimitKey,
  type PasswordRecoveryRateLimitRpc,
  type PasswordRecoveryRateLimitRpcClient,
  type PasswordRecoveryLimitRow,
} from "../../../../_lib/rate-limit";
import type { ProfileRecord } from "../../../../_lib/session";
import {
  createPublicSupabaseClient,
  createServiceRoleSupabaseClient,
} from "../../../../_lib/supabase";

const RECOVERY_REDIRECT =
  "https://hwang0310.dpdns.org/projects/income-forecast/reset-password/";
const FORGOT_ERROR = "无法发送重置信息，请确认信息后稍后再试";
const FORGOT_KEYS = new Set(["name", "employeeSuffix"]);

export type ForgotAttemptResult = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

export type ForgotPasswordDependencies = {
  consumeAttempt(normalizedName: string): Promise<ForgotAttemptResult>;
  findActiveProfilesByName(normalizedName: string): Promise<ProfileRecord[]>;
  sendRecoveryEmail(email: string, redirectTo: string): Promise<boolean>;
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

export async function consumeForgotPasswordAttempt(
  secret: string,
  normalizedName: string,
  rpc: PasswordRecoveryRateLimitRpc,
  now: Date,
): Promise<ForgotAttemptResult> {
  if (!Number.isFinite(now.getTime())) {
    throw new HttpError(503, "限流服务暂不可用");
  }
  const [minuteKey, hourKey] = await Promise.all([
    hmacRateLimitKey(secret, "forgot_minute", normalizedName),
    hmacRateLimitKey(secret, "forgot_hour", normalizedName),
  ]);
  const response = await rpc.consumePasswordRecoveryAttempt({
    p_minute_key: minuteKey,
    p_hour_key: hourKey,
    p_now: now.toISOString(),
  });
  const row: PasswordRecoveryLimitRow | undefined = response.data?.[0];
  if (
    response.success !== true ||
    response.error !== null ||
    response.data?.length !== 1 ||
    row === undefined ||
    typeof row.is_allowed !== "boolean" ||
    !Number.isInteger(row.retry_after_seconds) ||
    row.retry_after_seconds < 0 ||
    row.retry_after_seconds > 3_600 ||
    !Number.isInteger(row.minute_count) ||
    row.minute_count < 0 ||
    row.minute_count > 2 ||
    !Number.isInteger(row.hour_count) ||
    row.hour_count < 1 ||
    row.hour_count > 11 ||
    (row.is_allowed &&
      (row.retry_after_seconds !== 0 ||
        row.minute_count !== 1 ||
        row.hour_count > 10)) ||
    (!row.is_allowed && row.retry_after_seconds < 1)
  ) {
    throw new HttpError(503, "限流服务暂不可用");
  }
  return {
    allowed: row.is_allowed,
    retryAfterSeconds: row.retry_after_seconds,
  };
}

function defaultDependencies(
  env: Env,
  config: ReturnType<typeof requireEnv>,
): ForgotPasswordDependencies {
  const publicClient = createPublicSupabaseClient(config);
  const serviceClient = createServiceRoleSupabaseClient(config);
  const rateLimitClient = serviceClient as typeof serviceClient &
    PasswordRecoveryRateLimitRpcClient;
  const rpc = createPasswordRecoveryRateLimitRpc(rateLimitClient);

  return {
    consumeAttempt: (normalizedName) =>
      consumeForgotPasswordAttempt(
        config.rateLimitHmacSecret,
        normalizedName,
        rpc,
        new Date(),
      ),

    async findActiveProfilesByName(normalizedName) {
      try {
        const response = await serviceClient
          .from("profiles")
          .select(
            "user_id,full_name,employee_no,phone,email,role,is_active,uses_initial_password,must_change_password",
          )
          .eq("full_name", normalizedName)
          .eq("is_active", true)
          .limit(20);
        if (response.error !== null) {
          throw new HttpError(503, "密码服务暂不可用");
        }
        return response.data.map(profileFromRow);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, "密码服务暂不可用");
      }
    },

    async sendRecoveryEmail(email, redirectTo) {
      try {
        const response = await publicClient.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        return response.error === null;
      } catch {
        throw new HttpError(503, "密码服务暂不可用");
      }
    },

    writeAudit: (event) => writeAudit(env, event),
  };
}

async function auditFailure(
  dependencies: ForgotPasswordDependencies,
  reason: "not_found" | "suffix_mismatch" | "delivery_failed",
): Promise<void> {
  await dependencies.writeAudit({
    action: "password.forgot",
    result: false,
    targetType: "account_recovery",
    metadata: { reason },
  });
}

function employeeSuffix(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9]{4}$/u.test(value)) {
    throw new HttpError(400, "请输入工号后四位");
  }
  return value;
}

async function postForgotPassword(
  request: Request,
  dependencies: ForgotPasswordDependencies,
): Promise<Response> {
  const body = await readPasswordJson(request, FORGOT_KEYS);
  const name = normalizeName(body.name);

  const admission = await dependencies.consumeAttempt(name);
  if (!admission.allowed) {
    try {
      await dependencies.writeAudit({
        action: "password.forgot.rate_limited",
        result: false,
        targetType: "account_recovery",
        metadata: { retryAfterSeconds: admission.retryAfterSeconds },
      });
    } catch {
      // The atomic admission decision is final; audit availability cannot alter it.
    }
    return json(
      {
        error: "请求过于频繁，请稍后再试",
        retryAfterSeconds: admission.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(admission.retryAfterSeconds) },
      },
    );
  }

  const suffix = employeeSuffix(body.employeeSuffix);

  const profiles = (await dependencies.findActiveProfilesByName(name)).filter(
    (candidate) => candidate.isActive,
  );
  if (profiles.length === 0) {
    await auditFailure(dependencies, "not_found");
    throw new HttpError(400, FORGOT_ERROR);
  }

  if (profiles.length > 1 && suffix === undefined) {
    await dependencies.writeAudit({
      action: "password.forgot.needs_employee_suffix",
      result: false,
      targetType: "account_recovery",
      metadata: { reason: "duplicate_name" },
    });
    return json({ status: "needs_employee_suffix" });
  }

  const matched =
    profiles.length === 1
      ? profiles[0]
      : profiles.find((candidate) => candidate.employeeNo.endsWith(suffix ?? ""));
  if (matched === undefined) {
    await auditFailure(dependencies, "suffix_mismatch");
    throw new HttpError(400, FORGOT_ERROR);
  }

  const maskedEmail = maskEmail(matched.email);
  const accepted = await dependencies.sendRecoveryEmail(
    matched.email,
    RECOVERY_REDIRECT,
  );
  if (!accepted) {
    await auditFailure(dependencies, "delivery_failed");
    throw new HttpError(503, FORGOT_ERROR);
  }

  await dependencies.writeAudit({
    action: "password.forgot",
    actorUserId: matched.userId,
    targetType: "account_recovery",
    targetId: matched.userId,
    result: true,
  });
  return json({
    status: "sent",
    maskedEmail,
    message: `重置信息已发送。请前往您的邮箱：${maskedEmail}，查看收件箱或垃圾邮件，并按邮件提示重置密码。`,
  });
}

export async function handleForgotPasswordRequest(
  request: Request,
  env: Env,
  injectedDependencies?: ForgotPasswordDependencies,
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
    return await postForgotPassword(
      request,
      injectedDependencies ?? defaultDependencies(env, config),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) =>
  handleForgotPasswordRequest(context.request, context.env);
