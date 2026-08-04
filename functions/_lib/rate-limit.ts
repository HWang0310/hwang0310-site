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
  p_window_seconds: number;
  p_max_failures: number;
  p_block_seconds: number;
  p_now: string;
};

export type RateLimitCheckArgs = SharedRateLimitArgs;
export type RateLimitFailureArgs = SharedRateLimitArgs;
export type RateLimitClearArgs = {
  p_limit_key: string;
  p_action: string;
};

export type RateLimitCheckRow = {
  is_blocked: boolean;
  blocked_until: string | null;
  failure_count: number;
};

export type RateLimitFailureRow = {
  failure_count: number;
  blocked_until: string | null;
  is_blocked: boolean;
};

export type RateLimitRpc = {
  checkRateLimit(
    args: RateLimitCheckArgs,
  ): Promise<RateLimitRpcResponse<RateLimitCheckRow[] | null>>;
  recordRateLimitFailure(
    args: RateLimitFailureArgs,
  ): Promise<RateLimitRpcResponse<RateLimitFailureRow[] | null>>;
  clearRateLimit(
    args: RateLimitClearArgs,
  ): Promise<RateLimitRpcResponse<null>>;
};

export type RateLimitRpcClient = {
  rpc(
    name: "check_rate_limit",
    args: RateLimitCheckArgs,
  ): PromiseLike<RateLimitRpcResponse<RateLimitCheckRow[] | null>>;
  rpc(
    name: "record_rate_limit_failure",
    args: RateLimitFailureArgs,
  ): PromiseLike<RateLimitRpcResponse<RateLimitFailureRow[] | null>>;
  rpc(
    name: "clear_rate_limit",
    args: RateLimitClearArgs,
  ): PromiseLike<RateLimitRpcResponse<null>>;
};

export function createRateLimitRpc(client: RateLimitRpcClient): RateLimitRpc {
  return {
    async checkRateLimit(args) {
      return client.rpc("check_rate_limit", args);
    },
    async recordRateLimitFailure(args) {
      return client.rpc("record_rate_limit_failure", args);
    },
    async clearRateLimit(args) {
      return client.rpc("clear_rate_limit", args);
    },
  };
}

export type LoginLimitDecision = Readonly<{
  blocked: boolean;
  blockedUntil: string | null;
  retryAfterSeconds: number;
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

function sharedArgs(target: LoginLimitTarget, now: Date): SharedRateLimitArgs {
  if (!Number.isFinite(now.getTime())) {
    throw new HttpError(500, "限流服务暂不可用");
  }
  return {
    p_limit_key: target.key,
    p_action: target.action,
    p_window_seconds: target.rule.windowSeconds,
    p_max_failures: target.rule.maxFailures,
    p_block_seconds: target.rule.blockSeconds,
    p_now: now.toISOString(),
  };
}

function checkedRow(
  response: RateLimitRpcResponse<RateLimitCheckRow[] | null>,
): RateLimitCheckRow {
  const row = response.data?.[0];
  if (
    response.success !== true ||
    response.error !== null ||
    response.data?.length !== 1 ||
    row === undefined ||
    typeof row.is_blocked !== "boolean" ||
    !Number.isInteger(row.failure_count) ||
    row.failure_count < 0 ||
    (row.blocked_until !== null &&
      (!Number.isFinite(Date.parse(row.blocked_until)) || !row.is_blocked)) ||
    (row.is_blocked && row.blocked_until === null)
  ) {
    throw new HttpError(503, "限流服务暂不可用");
  }
  return row;
}

function recordedRow(
  response: RateLimitRpcResponse<RateLimitFailureRow[] | null>,
): RateLimitFailureRow {
  const row = response.data?.[0];
  if (
    response.success !== true ||
    response.error !== null ||
    response.data?.length !== 1 ||
    row === undefined ||
    typeof row.is_blocked !== "boolean" ||
    !Number.isInteger(row.failure_count) ||
    row.failure_count < 1 ||
    (row.blocked_until !== null && !Number.isFinite(Date.parse(row.blocked_until)))
  ) {
    throw new HttpError(503, "限流服务暂不可用");
  }
  return row;
}

export async function checkLoginLimits(
  targets: readonly LoginLimitTarget[],
  rpc: RateLimitRpc,
  now: Date,
): Promise<LoginLimitDecision> {
  const rows = await Promise.all(
    targets.map(async (target) =>
      checkedRow(await rpc.checkRateLimit(sharedArgs(target, now))),
    ),
  );
  const deadlines = rows
    .filter((row) => row.is_blocked)
    .map((row) => Date.parse(row.blocked_until ?? ""));
  if (deadlines.length === 0) {
    return { blocked: false, blockedUntil: null, retryAfterSeconds: 0 };
  }
  const latestDeadline = Math.max(...deadlines);
  return {
    blocked: true,
    blockedUntil: new Date(latestDeadline).toISOString(),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((latestDeadline - now.getTime()) / 1_000),
    ),
  };
}

export async function recordLoginFailures(
  targets: readonly LoginLimitTarget[],
  rpc: RateLimitRpc,
  now: Date,
): Promise<void> {
  await Promise.all(
    targets.map(async (target) => {
      recordedRow(await rpc.recordRateLimitFailure(sharedArgs(target, now)));
    }),
  );
}

export async function clearLoginIdentityLimits(
  targets: readonly LoginLimitTarget[],
  rpc: RateLimitRpc,
): Promise<void> {
  await Promise.all(
    targets
      .filter((target) => target.scope !== "ip")
      .map(async (target) => {
        const response = await rpc.clearRateLimit({
          p_limit_key: target.key,
          p_action: target.action,
        });
        if (response.success !== true || response.error !== null) {
          throw new HttpError(503, "限流服务暂不可用");
        }
      }),
  );
}
