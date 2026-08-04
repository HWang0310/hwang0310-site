import type { AppRole } from "../../shared/income-forecast/contracts";
import { HttpError } from "./http";

export const LOGIN_LIMITS = {
  phone: { windowSeconds: 300, maxFailures: 10, blockSeconds: 300 },
  ip: { windowSeconds: 300, maxFailures: 20, blockSeconds: 300 },
  rootAdmin: { windowSeconds: 300, maxFailures: 3, blockSeconds: 300 },
} as const;

type LoginLimitRule = Readonly<{
  windowSeconds: number;
  maxFailures: number;
  blockSeconds: number;
}>;

export type LoginLimitScope = keyof typeof LOGIN_LIMITS;

export type LoginLimitTarget = Readonly<{
  scope: LoginLimitScope;
  key: string;
  action: "login_phone" | "login_ip" | "login_root_admin";
  rule: LoginLimitRule;
}>;

type RateLimitRpcError = {
  message: string;
  details: string;
  hint: string;
  code: string;
};

export type RateLimitRpcResponse<T> = {
  success: boolean;
  data: T;
  error: RateLimitRpcError | null;
  count: number | null;
  status: number;
  statusText: string;
};

type SharedRateLimitArgs = {
  p_limit_key: string;
  p_action: string;
  p_now: string;
};

export type RateLimitReservationArgs = SharedRateLimitArgs & {
  p_reservation_id: string;
  p_window_seconds: number;
  p_max_failures: number;
  p_block_seconds: number;
};

export type RateLimitReservationRow = {
  is_reserved: boolean;
  is_blocked: boolean;
  blocked_until: string | null;
  failure_count: number;
};

export type RateLimitFinalizeOutcome = "failure" | "release" | "success_clear";

export type RateLimitFinalizeArgs = SharedRateLimitArgs & {
  p_reservation_id: string;
  p_outcome: RateLimitFinalizeOutcome;
  p_max_failures: number;
};

export type RateLimitFinalizeRow = {
  applied: boolean;
  failure_count: number;
  pending_count: number;
};

export type RateLimitRpc = {
  reserveRateLimitAttempt(
    args: RateLimitReservationArgs,
  ): Promise<RateLimitRpcResponse<RateLimitReservationRow[] | null>>;
  finalizeRateLimitAttempt(
    args: RateLimitFinalizeArgs,
  ): Promise<RateLimitRpcResponse<RateLimitFinalizeRow[] | null>>;
};

export type RateLimitRpcClient = {
  rpc(
    name: "reserve_rate_limit_attempt",
    args: RateLimitReservationArgs,
  ): PromiseLike<RateLimitRpcResponse<RateLimitReservationRow[] | null>>;
  rpc(
    name: "finalize_rate_limit_attempt",
    args: RateLimitFinalizeArgs,
  ): PromiseLike<RateLimitRpcResponse<RateLimitFinalizeRow[] | null>>;
};

export function createRateLimitRpc(client: RateLimitRpcClient): RateLimitRpc {
  return {
    async reserveRateLimitAttempt(args) {
      return client.rpc("reserve_rate_limit_attempt", args);
    },
    async finalizeRateLimitAttempt(args) {
      return client.rpc("finalize_rate_limit_attempt", args);
    },
  };
}

export type LoginLimitReservation = Readonly<{
  id: string;
  targets: readonly LoginLimitTarget[];
}>;

export type LoginLimitAdmission =
  | Readonly<{ admitted: true; reservation: LoginLimitReservation }>
  | Readonly<{
      admitted: false;
      blockedScope: LoginLimitScope;
      reservation: LoginLimitReservation;
    }>;

function invalidClientAddress(): never {
  throw new HttpError(403, "无法验证请求来源");
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^(0|[1-9][0-9]{0,2})$/u.test(part) && Number(part) <= 255,
    )
  );
}

function isIpv6(value: string): boolean {
  if (!value.includes(":")) return false;
  try {
    const url = new URL(`http://[${value}]/`);
    return url.hostname.length > 2;
  } catch {
    return false;
  }
}

export function requireCloudflareClientIp(request: Request): string {
  const value = request.headers.get("CF-Connecting-IP");
  if (
    value === null ||
    value.length === 0 ||
    value.length > 64 ||
    value.trim() !== value ||
    /[\s,\u0000-\u001f\u007f]/u.test(value) ||
    (!isIpv4(value) && !isIpv6(value))
  ) {
    invalidClientAddress();
  }
  return value;
}

async function hmacKey(
  secret: string,
  domain: "phone" | "ip" | "root",
  value: string,
): Promise<string> {
  if (secret.trim().length === 0) {
    throw new HttpError(500, "服务器配置不可用");
  }
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(`${domain}:${value}`),
  );
  const digest = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${domain}:${digest}`;
}

export async function buildLoginLimitTargets(
  secret: string,
  phone: string,
  request: Request,
  trustedRole: AppRole | null | undefined,
): Promise<LoginLimitTarget[]> {
  const clientIp = requireCloudflareClientIp(request);
  const [phoneKey, ipKey, rootKey] = await Promise.all([
    hmacKey(secret, "phone", phone),
    hmacKey(secret, "ip", clientIp),
    trustedRole === "root_admin"
      ? hmacKey(secret, "root", phone)
      : Promise.resolve(null),
  ]);
  const targets: LoginLimitTarget[] = [
    {
      scope: "phone",
      key: phoneKey,
      action: "login_phone",
      rule: LOGIN_LIMITS.phone,
    },
    {
      scope: "ip",
      key: ipKey,
      action: "login_ip",
      rule: LOGIN_LIMITS.ip,
    },
  ];
  if (rootKey !== null) {
    targets.push({
      scope: "rootAdmin",
      key: rootKey,
      action: "login_root_admin",
      rule: LOGIN_LIMITS.rootAdmin,
    });
  }
  return targets;
}

function checkedNow(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new HttpError(500, "限流服务暂不可用");
  }
  return now.toISOString();
}

function reservationArgs(
  reservationId: string,
  target: LoginLimitTarget,
  now: Date,
): RateLimitReservationArgs {
  return {
    p_reservation_id: reservationId,
    p_limit_key: target.key,
    p_action: target.action,
    p_window_seconds: target.rule.windowSeconds,
    p_max_failures: target.rule.maxFailures,
    p_block_seconds: target.rule.blockSeconds,
    p_now: checkedNow(now),
  };
}

function reservationRow(
  response: RateLimitRpcResponse<RateLimitReservationRow[] | null>,
): RateLimitReservationRow {
  const row = response.data?.[0];
  if (
    response.success !== true ||
    response.error !== null ||
    response.data?.length !== 1 ||
    row === undefined ||
    typeof row.is_reserved !== "boolean" ||
    typeof row.is_blocked !== "boolean" ||
    !Number.isInteger(row.failure_count) ||
    row.failure_count < 0 ||
    row.is_reserved === row.is_blocked ||
    (row.is_blocked &&
      (row.blocked_until === null ||
        !Number.isFinite(Date.parse(row.blocked_until)))) ||
    (row.is_reserved && row.blocked_until !== null)
  ) {
    throw new HttpError(503, "限流服务暂不可用");
  }
  return row;
}

function finalizedRow(
  response: RateLimitRpcResponse<RateLimitFinalizeRow[] | null>,
): RateLimitFinalizeRow {
  const row = response.data?.[0];
  if (
    response.success !== true ||
    response.error !== null ||
    response.data?.length !== 1 ||
    row === undefined ||
    typeof row.applied !== "boolean" ||
    !Number.isInteger(row.failure_count) ||
    row.failure_count < 0 ||
    !Number.isInteger(row.pending_count) ||
    row.pending_count < 0
  ) {
    throw new HttpError(503, "限流服务暂不可用");
  }
  return row;
}

async function finalizeTargets(
  reservation: LoginLimitReservation,
  rpc: RateLimitRpc,
  now: Date,
  outcomeFor: (target: LoginLimitTarget) => RateLimitFinalizeOutcome,
): Promise<Map<LoginLimitScope, RateLimitFinalizeRow>> {
  const timestamp = checkedNow(now);
  const results = await Promise.allSettled(
    reservation.targets.map(async (target) => {
      const row = finalizedRow(
        await rpc.finalizeRateLimitAttempt({
          p_reservation_id: reservation.id,
          p_limit_key: target.key,
          p_action: target.action,
          p_outcome: outcomeFor(target),
          p_max_failures: target.rule.maxFailures,
          p_now: timestamp,
        }),
      );
      return [target.scope, row] as const;
    }),
  );
  const entries: Array<readonly [LoginLimitScope, RateLimitFinalizeRow]> = [];
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    entries.push(result.value);
  }
  return new Map(entries);
}

export async function reserveLoginAttempt(
  targets: readonly LoginLimitTarget[],
  rpc: RateLimitRpc,
  now: Date,
): Promise<LoginLimitAdmission> {
  const reservationId = crypto.randomUUID();
  const results = await Promise.allSettled(
    targets.map(async (target) => ({
      target,
      row: reservationRow(
        await rpc.reserveRateLimitAttempt(
          reservationArgs(reservationId, target, now),
        ),
      ),
    })),
  );
  const reservedTargets: LoginLimitTarget[] = [];
  let blockedScope: LoginLimitScope | undefined;
  let hasError = false;
  let firstError: unknown;
  for (const result of results) {
    if (result.status === "rejected") {
      hasError = true;
      firstError ??= result.reason;
    } else if (result.value.row.is_blocked) {
      blockedScope ??= result.value.target.scope;
    } else {
      reservedTargets.push(result.value.target);
    }
  }

  if (hasError) {
    if (reservedTargets.length > 0) {
      await Promise.allSettled(
        reservedTargets.map((target) =>
          rpc.finalizeRateLimitAttempt({
            p_reservation_id: reservationId,
            p_limit_key: target.key,
            p_action: target.action,
            p_outcome: "release",
            p_max_failures: target.rule.maxFailures,
            p_now: checkedNow(now),
          }),
        ),
      );
    }
    throw firstError ?? new HttpError(503, "限流服务暂不可用");
  }
  if (blockedScope !== undefined) {
    return {
      admitted: false,
      blockedScope,
      reservation: { id: reservationId, targets: [...reservedTargets] },
    };
  }
  return {
    admitted: true,
    reservation: { id: reservationId, targets: [...reservedTargets] },
  };
}

export async function finalizeLoginFailure(
  reservation: LoginLimitReservation,
  rpc: RateLimitRpc,
  now: Date,
): Promise<number> {
  const rows = await finalizeTargets(
    reservation,
    rpc,
    now,
    () => "failure",
  );
  const phone = rows.get("phone");
  if (phone === undefined) {
    throw new HttpError(503, "限流服务暂不可用");
  }
  return phone.failure_count;
}

export async function finalizeLoginSuccess(
  reservation: LoginLimitReservation,
  rpc: RateLimitRpc,
  now: Date,
): Promise<void> {
  await finalizeTargets(
    reservation,
    rpc,
    now,
    (target) => (target.scope === "ip" ? "release" : "success_clear"),
  );
}

export async function releaseLoginAttempt(
  reservation: LoginLimitReservation,
  rpc: RateLimitRpc,
  now: Date,
): Promise<void> {
  await finalizeTargets(reservation, rpc, now, () => "release");
}
