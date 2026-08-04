import { describe, expect, it } from "vitest";

import type { Env } from "../functions/_lib/env";
import {
  buildLoginLimitTargets,
  checkLoginLimits,
  createRateLimitRpc,
  type RateLimitCheckArgs,
  type RateLimitClearArgs,
  type RateLimitFailureArgs,
  type RateLimitRpc,
  type RateLimitRpcClient,
  type RateLimitRpcResponse,
} from "../functions/_lib/rate-limit";
import {
  handleSessionRequest,
  type LoginResult,
  type SessionRouteDependencies,
} from "../functions/projects/income-forecast/api/session";
import type { ProfileRecord } from "../functions/_lib/session";
import type { AuditEventInput } from "../functions/_lib/audit";

type StoredLimit = {
  windowStartedAt: number;
  failureCount: number;
  blockedUntil: number | null;
};

type RpcCall =
  | { name: "check_rate_limit"; args: RateLimitCheckArgs }
  | { name: "record_rate_limit_failure"; args: RateLimitFailureArgs }
  | { name: "clear_rate_limit"; args: RateLimitClearArgs };

type RpcInvocation =
  | [name: "check_rate_limit", args: RateLimitCheckArgs]
  | [name: "record_rate_limit_failure", args: RateLimitFailureArgs]
  | [name: "clear_rate_limit", args: RateLimitClearArgs];

function rpcResponse<T>(data: T): RateLimitRpcResponse<T> {
  return {
    success: true,
    data,
    error: null,
    count: null,
    status: 200,
    statusText: "OK",
  };
}

class InMemoryRateLimitRpc implements RateLimitRpc {
  readonly calls: RpcCall[] = [];
  readonly limits = new Map<string, StoredLimit>();

  private id(limitKey: string, action: string): string {
    return `${action}\n${limitKey}`;
  }

  async checkRateLimit(args: RateLimitCheckArgs) {
    this.calls.push({ name: "check_rate_limit", args });
    const now = Date.parse(args.p_now);
    const id = this.id(args.p_limit_key, args.p_action);
    const current = this.limits.get(id);
    if (current === undefined) {
      return rpcResponse([
        { is_blocked: false, blocked_until: null, failure_count: 0 },
      ]);
    }

    if (current.blockedUntil !== null && current.blockedUntil > now) {
      return rpcResponse([
        {
          is_blocked: true,
          blocked_until: new Date(current.blockedUntil).toISOString(),
          failure_count: current.failureCount,
        },
      ]);
    }

    if (
      current.blockedUntil !== null ||
      current.windowStartedAt + args.p_window_seconds * 1_000 <= now
    ) {
      current.windowStartedAt = now;
      current.failureCount = 0;
      current.blockedUntil = null;
    } else if (current.failureCount >= args.p_max_failures) {
      current.blockedUntil = now + args.p_block_seconds * 1_000;
    }

    return rpcResponse([
      {
        is_blocked: current.blockedUntil !== null && current.blockedUntil > now,
        blocked_until:
          current.blockedUntil === null
            ? null
            : new Date(current.blockedUntil).toISOString(),
        failure_count: current.failureCount,
      },
    ]);
  }

  async recordRateLimitFailure(args: RateLimitFailureArgs) {
    this.calls.push({ name: "record_rate_limit_failure", args });
    const now = Date.parse(args.p_now);
    const id = this.id(args.p_limit_key, args.p_action);
    let current = this.limits.get(id);
    if (current === undefined) {
      current = { windowStartedAt: now, failureCount: 1, blockedUntil: null };
      this.limits.set(id, current);
    } else if (
      (current.blockedUntil !== null && current.blockedUntil <= now) ||
      current.windowStartedAt + args.p_window_seconds * 1_000 <= now
    ) {
      current.windowStartedAt = now;
      current.failureCount = 1;
      current.blockedUntil = null;
    } else {
      current.failureCount += 1;
    }

    return rpcResponse([
      {
        failure_count: current.failureCount,
        blocked_until:
          current.blockedUntil === null
            ? null
            : new Date(current.blockedUntil).toISOString(),
        is_blocked: current.blockedUntil !== null && current.blockedUntil > now,
      },
    ]);
  }

  async clearRateLimit(args: RateLimitClearArgs) {
    this.calls.push({ name: "clear_rate_limit", args });
    this.limits.delete(this.id(args.p_limit_key, args.p_action));
    return rpcResponse(null);
  }
}

class RecordingRateLimitClient {
  readonly calls: Array<{
    name: RpcInvocation[0];
    args: RateLimitCheckArgs | RateLimitFailureArgs | RateLimitClearArgs;
  }> = [];

  async rpc(...invocation: RpcInvocation) {
    switch (invocation[0]) {
      case "check_rate_limit":
        this.calls.push({ name: invocation[0], args: invocation[1] });
        return rpcResponse([
          { is_blocked: false, blocked_until: null, failure_count: 7 },
        ]);
      case "record_rate_limit_failure":
        this.calls.push({ name: invocation[0], args: invocation[1] });
        return rpcResponse([
          { failure_count: 8, blocked_until: null, is_blocked: false },
        ]);
      case "clear_rate_limit":
        this.calls.push({ name: invocation[0], args: invocation[1] });
        return rpcResponse(null);
    }
  }
}

const assets: Fetcher = {
  fetch: async () => new Response("asset"),
  connect: () => {
    throw new Error("connect is not used in rate-limit tests");
  },
};

const env: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  RATE_LIMIT_HMAC_SECRET: "rate-limit-test-value",
  SITE_ORIGIN: "https://hwang0310.dpdns.org",
  SUPABASE_STORAGE_BUCKET: "income-forecast-reports",
  ASSETS: assets,
};

const rootProfile: ProfileRecord = {
  userId: "root-user",
  fullName: "管理员",
  employeeNo: "000001",
  phone: "13800000001",
  email: "root@example.test",
  role: "root_admin",
  isActive: true,
  usesInitialPassword: false,
  mustChangePassword: false,
};

function failedLoginRequest(phone: string, ip = "203.0.113.10"): Request {
  return new Request(
    "https://hwang0310.dpdns.org/projects/income-forecast/api/session",
    {
      method: "POST",
      headers: {
        "CF-Connecting-IP": ip,
        "Content-Type": "application/json",
        Origin: "https://hwang0310.dpdns.org",
      },
      body: JSON.stringify({ phone, password: "incorrect-credential" }),
    },
  );
}

function dependencies(
  rpc: InMemoryRateLimitRpc,
  options: {
    now: () => Date;
    profile?: ProfileRecord | null;
    login?: LoginResult | null;
  },
) {
  let authCalls = 0;
  const audits: AuditEventInput[] = [];
  const deps: SessionRouteDependencies = {
    rateLimitRpc: rpc,
    now: options.now,
    findProfileByPhone: async () => options.profile ?? null,
    signInWithPassword: async () => {
      authCalls += 1;
      return options.login ?? null;
    },
    getSession: async () => null,
    revokeAccessToken: async () => undefined,
    revokeSession: async (_request, headers) => {
      headers.set("X-Test-Logout", "done");
    },
    writeAudit: async (event) => {
      audits.push(event);
    },
  };
  return { deps, audits, authCalls: () => authCalls };
}

async function post(request: Request, deps: SessionRouteDependencies) {
  return handleSessionRequest(request, env, deps);
}

describe("phone-login HMAC keys", () => {
  it("adapts the exact PostgreSQL RPC names, arguments, and response shape", async () => {
    const client = new RecordingRateLimitClient();
    const rpc = createRateLimitRpc(client as RateLimitRpcClient);
    const args: RateLimitCheckArgs = {
      p_limit_key: "phone:hashed-value",
      p_action: "login_phone",
      p_window_seconds: 300,
      p_max_failures: 10,
      p_block_seconds: 300,
      p_now: "2026-08-04T00:00:00.000Z",
    };

    const response = await rpc.checkRateLimit(args);

    expect(client.calls).toEqual([{ name: "check_rate_limit", args }]);
    expect(response).toEqual({
      success: true,
      data: [{ is_blocked: false, blocked_until: null, failure_count: 7 }],
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
    });
  });

  it("uses irreversible, domain-separated keys and only the Cloudflare IP header", async () => {
    const request = failedLoginRequest("13800000000", "2001:db8::42");
    const targets = await buildLoginLimitTargets(
      env.RATE_LIMIT_HMAC_SECRET,
      "13800000000",
      request,
      "root_admin",
    );

    expect(targets.map(({ scope, key }) => ({ scope, key }))).toEqual([
      { scope: "phone", key: expect.stringMatching(/^phone:[0-9a-f]{64}$/u) },
      { scope: "ip", key: expect.stringMatching(/^ip:[0-9a-f]{64}$/u) },
      { scope: "rootAdmin", key: expect.stringMatching(/^root:[0-9a-f]{64}$/u) },
    ]);
    expect(new Set(targets.map((target) => target.key)).size).toBe(3);
    expect(JSON.stringify(targets)).not.toContain("13800000000");
    expect(JSON.stringify(targets)).not.toContain("2001:db8::42");
  });

  it("fails closed on a structurally invalid RPC response", async () => {
    const target = (
      await buildLoginLimitTargets(
        env.RATE_LIMIT_HMAC_SECRET,
        "13800000000",
        failedLoginRequest("13800000000"),
        null,
      )
    )[0];
    const malformedRpc: RateLimitRpc = {
      checkRateLimit: async () => ({
        ...rpcResponse([
          { is_blocked: false, blocked_until: null, failure_count: 0 },
        ]),
        success: false,
      }),
      recordRateLimitFailure: async () =>
        rpcResponse([
          { failure_count: 1, blocked_until: null, is_blocked: false },
        ]),
      clearRateLimit: async () => rpcResponse(null),
    };

    await expect(
      checkLoginLimits(
        [target],
        malformedRpc,
        new Date("2026-08-04T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe("exact login rate-limit boundaries", () => {
  it("records the 10th phone failure and blocks the 11th before Auth for five full minutes", async () => {
    const rpc = new InMemoryRateLimitRpc();
    let now = new Date("2026-08-04T00:00:00.000Z");
    const setup = dependencies(rpc, { now: () => now });

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await post(failedLoginRequest("13800000000"), setup.deps);
      expect(response.status).toBe(401);
    }
    expect(setup.authCalls()).toBe(10);

    now = new Date("2026-08-04T00:04:00.000Z");
    const blocked = await post(failedLoginRequest("13800000000"), setup.deps);
    expect(blocked.status).toBe(429);
    expect(setup.authCalls()).toBe(10);
    expect(await blocked.json()).toEqual({
      error: "登录尝试过多，请稍后再试",
      retryAfterSeconds: 300,
    });

    const triggeringCheck = rpc.calls.slice().reverse().find(
      (call) =>
        call.name === "check_rate_limit" && call.args.p_action === "login_phone",
    );
    expect(triggeringCheck?.name).toBe("check_rate_limit");
    const phoneTarget = (
      await buildLoginLimitTargets(
        env.RATE_LIMIT_HMAC_SECRET,
        "13800000000",
        failedLoginRequest("13800000000"),
        null,
      )
    )[0];
    expect(rpc.limits.get(`login_phone\n${phoneTarget.key}`)).toEqual({
      windowStartedAt: Date.parse("2026-08-04T00:00:00.000Z"),
      failureCount: 10,
      blockedUntil: Date.parse("2026-08-04T00:09:00.000Z"),
    });
  });

  it("records the 20th shared-IP failure and blocks the 21st before Auth", async () => {
    const rpc = new InMemoryRateLimitRpc();
    let now = new Date("2026-08-04T01:00:00.000Z");
    const setup = dependencies(rpc, { now: () => now });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const phone = String(13800000000 + attempt);
      const response = await post(failedLoginRequest(phone), setup.deps);
      expect(response.status).toBe(401);
    }
    expect(setup.authCalls()).toBe(20);

    now = new Date("2026-08-04T01:03:00.000Z");
    const blocked = await post(failedLoginRequest("13900000000"), setup.deps);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("300");
    expect(setup.authCalls()).toBe(20);
  });

  it("records the 3rd trusted root-admin failure and blocks the 4th before Auth", async () => {
    const rpc = new InMemoryRateLimitRpc();
    let now = new Date("2026-08-04T02:00:00.000Z");
    const setup = dependencies(rpc, {
      now: () => now,
      profile: rootProfile,
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await post(failedLoginRequest(rootProfile.phone), setup.deps);
      expect(response.status).toBe(401);
    }
    expect(setup.authCalls()).toBe(3);

    now = new Date("2026-08-04T02:02:00.000Z");
    const blocked = await post(failedLoginRequest(rootProfile.phone), setup.deps);
    expect(blocked.status).toBe(429);
    expect(setup.authCalls()).toBe(3);

    const rootChecks = rpc.calls.filter(
      (call) =>
        call.name === "check_rate_limit" &&
        call.args.p_action === "login_root_admin",
    );
    expect(rootChecks).toHaveLength(4);
    const rootState = [...rpc.limits.entries()].find(([id]) =>
      id.startsWith("login_root_admin\n"),
    )?.[1];
    expect(rootState?.blockedUntil).toBe(
      Date.parse("2026-08-04T02:07:00.000Z"),
    );
  });

  it("clears phone and root counters after success but preserves the IP window", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T03:00:00.000Z");
    const failureSetup = dependencies(rpc, { now, profile: rootProfile });
    expect(
      (await post(failedLoginRequest(rootProfile.phone), failureSetup.deps)).status,
    ).toBe(401);

    const login: LoginResult = {
      user: { id: rootProfile.userId, appMetadata: { role: "root_admin" } },
      accessToken: "access-value",
      refreshToken: "refresh-value",
    };
    const successSetup = dependencies(rpc, {
      now,
      profile: rootProfile,
      login,
    });
    const response = await post(failedLoginRequest(rootProfile.phone), successSetup.deps);
    expect(response.status).toBe(200);

    const actionsStillStored = [...rpc.limits.keys()].map((id) => id.split("\n")[0]);
    expect(actionsStillStored).toEqual(["login_ip"]);
    expect(
      rpc.calls
        .filter((call) => call.name === "clear_rate_limit")
        .map((call) => call.args.p_action),
    ).toEqual(["login_phone", "login_root_admin"]);
    expect(JSON.stringify(successSetup.audits)).not.toContain(rootProfile.phone);
    expect(JSON.stringify(successSetup.audits)).not.toContain("incorrect-credential");
  });
});
