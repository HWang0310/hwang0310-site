import { describe, expect, it, vi } from "vitest";

import type { Env } from "../functions/_lib/env";
import { HttpError } from "../functions/_lib/http";
import {
  buildLoginLimitTargets,
  createRateLimitRpc,
  reserveLoginAttempt,
  type RateLimitFinalizeArgs,
  type RateLimitFinalizeRow,
  type RateLimitReservationArgs,
  type RateLimitReservationRow,
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
  pendingCount: number;
  blockedUntil: number | null;
};

type StoredReservation = {
  limitId: string;
  windowStartedAt: number;
};

type RpcCall =
  | { name: "reserve_rate_limit_attempt"; args: RateLimitReservationArgs }
  | { name: "finalize_rate_limit_attempt"; args: RateLimitFinalizeArgs };

type RpcInvocation =
  | [name: "reserve_rate_limit_attempt", args: RateLimitReservationArgs]
  | [name: "finalize_rate_limit_attempt", args: RateLimitFinalizeArgs];

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
  readonly reservations = new Map<string, StoredReservation>();

  private id(limitKey: string, action: string): string {
    return `${action}\n${limitKey}`;
  }

  async reserveRateLimitAttempt(args: RateLimitReservationArgs) {
    this.calls.push({ name: "reserve_rate_limit_attempt", args });
    const now = Date.parse(args.p_now);
    const id = this.id(args.p_limit_key, args.p_action);
    let current = this.limits.get(id);
    if (current === undefined) {
      current = {
        windowStartedAt: now,
        failureCount: 0,
        pendingCount: 0,
        blockedUntil: null,
      };
      this.limits.set(id, current);
    } else if (current.blockedUntil !== null && current.blockedUntil > now) {
      return rpcResponse<RateLimitReservationRow[]>([
        {
          is_reserved: false,
          is_blocked: true,
          blocked_until: new Date(current.blockedUntil).toISOString(),
          failure_count: current.failureCount,
        },
      ]);
    } else if (
      current.blockedUntil !== null ||
      current.windowStartedAt + args.p_window_seconds * 1_000 <= now
    ) {
      current.windowStartedAt = now;
      current.failureCount = 0;
      current.pendingCount = 0;
      current.blockedUntil = null;
      for (const [reservationId, reservation] of this.reservations) {
        if (reservation.limitId === id) this.reservations.delete(reservationId);
      }
    }

    if (current.failureCount + current.pendingCount >= args.p_max_failures) {
      current.blockedUntil = now + args.p_block_seconds * 1_000;
      return rpcResponse<RateLimitReservationRow[]>([
        {
          is_reserved: false,
          is_blocked: true,
          blocked_until: new Date(current.blockedUntil).toISOString(),
          failure_count: current.failureCount,
        },
      ]);
    }

    const reservationKey = `${args.p_reservation_id}\n${id}`;
    if (!this.reservations.has(reservationKey)) {
      this.reservations.set(reservationKey, {
        limitId: id,
        windowStartedAt: current.windowStartedAt,
      });
      current.pendingCount += 1;
    }
    return rpcResponse<RateLimitReservationRow[]>([
      {
        is_reserved: true,
        is_blocked: false,
        blocked_until: null,
        failure_count: current.failureCount,
      },
    ]);
  }

  async finalizeRateLimitAttempt(args: RateLimitFinalizeArgs) {
    this.calls.push({ name: "finalize_rate_limit_attempt", args });
    const id = this.id(args.p_limit_key, args.p_action);
    const reservationKey = `${args.p_reservation_id}\n${id}`;
    const reservation = this.reservations.get(reservationKey);
    const current = this.limits.get(id);
    if (reservation === undefined || current === undefined) {
      return rpcResponse<RateLimitFinalizeRow[]>([
        {
          applied: false,
          failure_count: current?.failureCount ?? 0,
          pending_count: current?.pendingCount ?? 0,
        },
      ]);
    }
    this.reservations.delete(reservationKey);
    const sameWindow = reservation.windowStartedAt === current.windowStartedAt;
    if (sameWindow) current.pendingCount = Math.max(current.pendingCount - 1, 0);
    if (args.p_outcome === "failure" && sameWindow) current.failureCount += 1;
    if (args.p_outcome === "success_clear") {
      current.failureCount = 0;
      current.blockedUntil = null;
    } else if (
      args.p_outcome === "release" &&
      sameWindow &&
      current.failureCount + current.pendingCount < args.p_max_failures
    ) {
      current.blockedUntil = null;
    }
    return rpcResponse<RateLimitFinalizeRow[]>([
      {
        applied: true,
        failure_count: current.failureCount,
        pending_count: current.pendingCount,
      },
    ]);
  }
}

class RecordingRateLimitClient {
  readonly calls: Array<{
    name: RpcInvocation[0];
    args: RateLimitReservationArgs | RateLimitFinalizeArgs;
  }> = [];

  async rpc(...invocation: RpcInvocation) {
    switch (invocation[0]) {
      case "reserve_rate_limit_attempt":
        this.calls.push({ name: invocation[0], args: invocation[1] });
        return rpcResponse([
          {
            is_reserved: true,
            is_blocked: false,
            blocked_until: null,
            failure_count: 7,
          },
        ]);
      case "finalize_rate_limit_attempt":
        this.calls.push({ name: invocation[0], args: invocation[1] });
        return rpcResponse([
          { applied: true, failure_count: 8, pending_count: 0 },
        ]);
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

const userProfile: ProfileRecord = {
  ...rootProfile,
  userId: "normal-user",
  employeeNo: "000002",
  phone: "13800000002",
  email: "user@example.test",
  role: "user",
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
  let monotonicMilliseconds = 0;
  const sleepCalls: number[] = [];
  const timingCalls: string[] = [];
  const audits: AuditEventInput[] = [];
  const deferred: Promise<void>[] = [];
  const deps: SessionRouteDependencies = {
    rateLimitRpc: rpc,
    now: options.now,
    monotonicNow: () => {
      timingCalls.push("now");
      return monotonicMilliseconds;
    },
    sleep: async (milliseconds) => {
      sleepCalls.push(milliseconds);
      timingCalls.push(`sleep:${milliseconds}`);
      monotonicMilliseconds += milliseconds;
    },
    defer: (promise) => {
      deferred.push(promise);
    },
    findProfileByPhone: async () => options.profile ?? null,
    signInWithPassword: async () => {
      authCalls += 1;
      return options.login ?? null;
    },
    getSession: async () => null,
    revokeAccessToken: async () => undefined,
    revokeSession: async () => undefined,
    writeAudit: async (event) => {
      audits.push(event);
    },
  };
  return {
    deps,
    audits,
    authCalls: () => authCalls,
    deferred,
    sleepCalls,
    timingCalls,
  };
}

async function post(request: Request, deps: SessionRouteDependencies) {
  return handleSessionRequest(request, env, deps);
}

describe("phone-login HMAC keys", () => {
  it("adapts the atomic reservation RPC name, arguments, and response shape", async () => {
    const client = new RecordingRateLimitClient();
    const rpc = createRateLimitRpc(client as RateLimitRpcClient);
    const args: RateLimitReservationArgs = {
      p_reservation_id: "00000000-0000-4000-8000-000000000001",
      p_limit_key: "phone:hashed-value",
      p_action: "login_phone",
      p_window_seconds: 300,
      p_max_failures: 10,
      p_block_seconds: 300,
      p_now: "2026-08-04T00:00:00.000Z",
    };

    const response = await rpc.reserveRateLimitAttempt(args);

    expect(client.calls).toEqual([{ name: "reserve_rate_limit_attempt", args }]);
    expect(response).toEqual({
      success: true,
      data: [
        {
          is_reserved: true,
          is_blocked: false,
          blocked_until: null,
          failure_count: 7,
        },
      ],
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

});

describe("concurrent login reservations", () => {
  it.each([
    ["two", null, 2],
    ["three", "root_admin", 3],
  ] as const)(
    "starts all %s target RPCs before awaiting any response",
    async (_label, role, expectedCount) => {
      const targets = await buildLoginLimitTargets(
        env.RATE_LIMIT_HMAC_SECRET,
        rootProfile.phone,
        failedLoginRequest(rootProfile.phone),
        role,
      );
      const started: RateLimitReservationArgs[] = [];
      let releaseBarrier!: () => void;
      const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const rpc: RateLimitRpc = {
        async reserveRateLimitAttempt(args) {
          started.push(args);
          await barrier;
          return rpcResponse([
            {
              is_reserved: true,
              is_blocked: false,
              blocked_until: null,
              failure_count: 0,
            },
          ]);
        },
        finalizeRateLimitAttempt: async () =>
          rpcResponse([{ applied: true, failure_count: 0, pending_count: 0 }]),
      };

      const admissionPromise = reserveLoginAttempt(
        targets,
        rpc,
        new Date("2026-08-04T00:00:00.000Z"),
      );
      const concurrencyCheck = vi
        .waitFor(() => expect(started).toHaveLength(expectedCount), {
          timeout: 100,
          interval: 5,
        })
        .finally(releaseBarrier);
      const [, admission] = await Promise.all([
        concurrencyCheck,
        admissionPromise,
      ]);

      expect(new Set(started.map((args) => args.p_reservation_id)).size).toBe(1);
      expect(admission).toEqual({
        admitted: true,
        reservation: {
          id: started[0]?.p_reservation_id,
          targets,
        },
      });
    },
  );

  it("releases every successful reservation and fails closed when blocked and error results are mixed", async () => {
    const targets = await buildLoginLimitTargets(
      env.RATE_LIMIT_HMAC_SECRET,
      rootProfile.phone,
      failedLoginRequest(rootProfile.phone),
      "root_admin",
    );
    const pending = new Set<string>();
    const finalized: RateLimitFinalizeArgs[] = [];
    const rpc: RateLimitRpc = {
      async reserveRateLimitAttempt(args) {
        if (args.p_action === "login_ip") {
          return rpcResponse([
            {
              is_reserved: false,
              is_blocked: true,
              blocked_until: "2026-08-04T00:05:00.000Z",
              failure_count: 20,
            },
          ]);
        }
        if (args.p_action === "login_root_admin") {
          throw new Error("root reservation unavailable");
        }
        pending.add(`${args.p_reservation_id}:${args.p_action}`);
        return rpcResponse([
          {
            is_reserved: true,
            is_blocked: false,
            blocked_until: null,
            failure_count: 0,
          },
        ]);
      },
      async finalizeRateLimitAttempt(args) {
        finalized.push(args);
        pending.delete(`${args.p_reservation_id}:${args.p_action}`);
        return rpcResponse([{ applied: true, failure_count: 0, pending_count: 0 }]);
      },
    };

    await expect(
      reserveLoginAttempt(
        targets,
        rpc,
        new Date("2026-08-04T00:00:00.000Z"),
      ),
    ).rejects.toThrow("root reservation unavailable");

    expect(pending.size).toBe(0);
    expect(finalized.map((args) => [args.p_action, args.p_outcome])).toEqual([
      ["login_phone", "release"],
    ]);
  });

  it("uses target order for blocked priority and returns every unblocked reservation", async () => {
    const targets = await buildLoginLimitTargets(
      env.RATE_LIMIT_HMAC_SECRET,
      rootProfile.phone,
      failedLoginRequest(rootProfile.phone),
      "root_admin",
    );
    const rpc: RateLimitRpc = {
      reserveRateLimitAttempt: async (args) =>
        rpcResponse([
          args.p_action === "login_root_admin"
            ? {
                is_reserved: true,
                is_blocked: false,
                blocked_until: null,
                failure_count: 0,
              }
            : {
                is_reserved: false,
                is_blocked: true,
                blocked_until: "2026-08-04T00:05:00.000Z",
                failure_count: 20,
              },
        ]),
      finalizeRateLimitAttempt: async () =>
        rpcResponse([{ applied: true, failure_count: 0, pending_count: 0 }]),
    };

    const admission = await reserveLoginAttempt(
      targets,
      rpc,
      new Date("2026-08-04T00:00:00.000Z"),
    );

    expect(admission).toMatchObject({
      admitted: false,
      blockedScope: "phone",
      reservation: { targets: [targets[2]] },
    });
  });
});

describe("exact login rate-limit boundaries", () => {
  it("records the 10th phone failure and blocks the 11th before Auth for five full minutes", async () => {
    const rpc = new InMemoryRateLimitRpc();
    let now = new Date("2026-08-04T00:00:00.000Z");
    const setup = dependencies(rpc, { now: () => now });

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await post(failedLoginRequest("13800000000"), setup.deps);
      expect(response.status).toBe(attempt <= 3 ? 401 : 429);
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
        call.name === "reserve_rate_limit_attempt" &&
        call.args.p_action === "login_phone",
    );
    expect(triggeringCheck?.name).toBe("reserve_rate_limit_attempt");
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
      pendingCount: 0,
      blockedUntil: Date.parse("2026-08-04T00:09:00.000Z"),
    });

    now = new Date("2026-08-04T00:05:00.000Z");
    const stillBlocked = await post(
      failedLoginRequest("13800000000"),
      setup.deps,
    );
    expect(stillBlocked.status).toBe(429);
    expect(setup.authCalls()).toBe(10);
    expect(
      rpc.limits.get(`login_phone\n${phoneTarget.key}`)?.blockedUntil,
    ).toBe(Date.parse("2026-08-04T00:09:00.000Z"));

    now = new Date("2026-08-04T00:09:00.000Z");
    const afterBlock = await post(failedLoginRequest("13800000000"), setup.deps);
    expect(afterBlock.status).toBe(401);
    expect(setup.authCalls()).toBe(11);
    expect(rpc.limits.get(`login_phone\n${phoneTarget.key}`)).toMatchObject({
      windowStartedAt: Date.parse("2026-08-04T00:09:00.000Z"),
      failureCount: 1,
      pendingCount: 0,
      blockedUntil: null,
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

  it("records the 3rd trusted root-admin failure and masks the 4th with one Auth call", async () => {
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
    expect(setup.authCalls()).toBe(4);

    const rootChecks = rpc.calls.filter(
      (call) =>
        call.name === "reserve_rate_limit_attempt" &&
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

    const stateByAction = Object.fromEntries(
      [...rpc.limits.entries()].map(([id, state]) => [id.split("\n")[0], state]),
    );
    expect(stateByAction.login_phone.failureCount).toBe(0);
    expect(stateByAction.login_root_admin.failureCount).toBe(0);
    expect(stateByAction.login_ip.failureCount).toBe(1);
    expect(stateByAction.login_ip.pendingCount).toBe(0);
    expect(
      rpc.calls
        .filter((call) => call.name === "finalize_rate_limit_attempt")
        .map((call) => call.args.p_outcome)
        .slice(-3),
    ).toEqual(["success_clear", "release", "success_clear"]);
    expect(JSON.stringify(successSetup.audits)).not.toContain(rootProfile.phone);
    expect(JSON.stringify(successSetup.audits)).not.toContain("incorrect-credential");
  });

  it.each([
    ["phone", null, "13800000000", 9, 1],
    ["root admin", rootProfile, rootProfile.phone, 2, 2],
  ] as const)(
    "preserves atomic admission and masking across a concurrent %s boundary",
    async (_scope, profile, phone, priorFailures, expectedAuthCalls) => {
      const rpc = new InMemoryRateLimitRpc();
      const now = () => new Date("2026-08-04T05:00:00.000Z");
      const warmup = dependencies(rpc, { now, profile });
      for (let attempt = 0; attempt < priorFailures; attempt += 1) {
        await post(failedLoginRequest(phone), warmup.deps);
      }

      let authCalls = 0;
      let signalAuthStarted!: () => void;
      let releaseFirstAuth!: () => void;
      const authStarted = new Promise<void>((resolve) => {
        signalAuthStarted = resolve;
      });
      const firstAuthBarrier = new Promise<void>((resolve) => {
        releaseFirstAuth = resolve;
      });
      const concurrent = dependencies(rpc, { now, profile });
      concurrent.deps.signInWithPassword = async () => {
        authCalls += 1;
        if (authCalls === 1) {
          signalAuthStarted();
          await firstAuthBarrier;
        }
        return null;
      };

      const firstResponsePromise = post(
        failedLoginRequest(phone),
        concurrent.deps,
      );
      await authStarted;
      const secondResponse = await post(
        failedLoginRequest(phone),
        concurrent.deps,
      );
      expect([...rpc.limits.values()].every((state) => state.pendingCount === 1)).toBe(
        true,
      );
      releaseFirstAuth();
      await firstResponsePromise;

      expect(secondResponse.status).toBe(429);
      expect(authCalls).toBe(expectedAuthCalls);
      expect([...rpc.limits.values()].every((state) => state.pendingCount >= 0)).toBe(
        true,
      );
    },
  );

  it("equalizes attempt-4-and-later Auth, counters, delay, and envelopes", async () => {
    const runSequence = async (profile: ProfileRecord | null, phone: string) => {
      const rpc = new InMemoryRateLimitRpc();
      const now = () => new Date("2026-08-04T06:00:00.000Z");
      const setup = dependencies(rpc, { now, profile });
      const responses: Array<{
        status: number;
        retryAfter: string | null;
        body: string;
      }> = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await post(failedLoginRequest(phone), setup.deps);
        responses.push({
          status: response.status,
          retryAfter: response.headers.get("Retry-After"),
          body: await response.text(),
        });
      }
      const states = Object.fromEntries(
        [...rpc.limits.entries()].map(([id, state]) => [id.split("\n")[0], state]),
      );
      return {
        responses,
        authCalls: setup.authCalls(),
        sleepCalls: setup.sleepCalls,
        timingCalls: setup.timingCalls,
        phoneFailures: states.login_phone.failureCount,
        ipFailures: states.login_ip.failureCount,
      };
    };

    const [root, normal, unknown] = await Promise.all([
      runSequence(rootProfile, rootProfile.phone),
      runSequence(userProfile, userProfile.phone),
      runSequence(null, "13800000003"),
    ]);

    for (const result of [root, normal, unknown]) {
      expect(result).toMatchObject({
        authCalls: 5,
        phoneFailures: 5,
        ipFailures: 5,
        sleepCalls: [800, 800, 800, 800, 800],
      });
      expect(result.responses.map(({ status }) => status)).toEqual([
        401, 401, 401, 429, 429,
      ]);
      expect(
        result.responses.slice(3).map(({ retryAfter }) => retryAfter),
      ).toEqual(["300", "300"]);
    }
    expect(root.responses).toEqual(normal.responses);
    expect(normal.responses).toEqual(unknown.responses);
    expect(root.timingCalls).toEqual(normal.timingCalls);
    expect(normal.timingCalls).toEqual(unknown.timingCalls);
    expect(root.timingCalls).toEqual([
      "now",
      "now",
      "sleep:800",
      "now",
      "now",
      "sleep:800",
      "now",
      "now",
      "sleep:800",
      "now",
      "now",
      "sleep:800",
      "now",
      "now",
      "sleep:800",
    ]);
    expect(JSON.parse(root.responses[3].body)).toEqual({
      error: "登录尝试过多，请稍后再试",
      retryAfterSeconds: 300,
    });
  });

  it("still lets correct normal credentials reach Auth and succeed on attempt 4", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T06:30:00.000Z");
    const failed = dependencies(rpc, { now, profile: userProfile });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await post(failedLoginRequest(userProfile.phone), failed.deps)).status).toBe(
        401,
      );
    }
    const successful = dependencies(rpc, {
      now,
      profile: userProfile,
      login: {
        user: { id: userProfile.userId, appMetadata: { role: "user" } },
        accessToken: "access-value",
        refreshToken: "refresh-value",
      },
    });

    expect(
      (await post(failedLoginRequest(userProfile.phone), successful.deps)).status,
    ).toBe(200);
    expect(successful.authCalls()).toBe(1);
    expect(successful.sleepCalls).toEqual([]);
  });

  it("does not pad a credential-format rejection", async () => {
    const setup = dependencies(new InMemoryRateLimitRpc(), {
      now: () => new Date("2026-08-04T06:45:00.000Z"),
      profile: userProfile,
    });
    const request = new Request(
      "https://hwang0310.dpdns.org/projects/income-forecast/api/session",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json",
          Origin: env.SITE_ORIGIN,
        },
        body: JSON.stringify({ phone: userProfile.phone, password: "" }),
      },
    );

    const response = await post(request, setup.deps);

    expect(response.status).toBe(401);
    expect(setup.authCalls()).toBe(0);
    expect(setup.sleepCalls).toEqual([]);
    expect(setup.timingCalls).toEqual(["now"]);
  });

  it("keeps an already-decided 429 when its audit write fails", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T07:00:00.000Z");
    const warmup = dependencies(rpc, { now, profile: rootProfile });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await post(failedLoginRequest(rootProfile.phone), warmup.deps);
    }
    const blocked = dependencies(rpc, { now, profile: rootProfile });
    blocked.deps.writeAudit = async () => {
      throw new Error("audit unavailable");
    };

    const response = await post(failedLoginRequest(rootProfile.phone), blocked.deps);

    expect(response.status).toBe(429);
    expect(blocked.authCalls()).toBe(1);
    expect(blocked.sleepCalls).toEqual([800]);
    expect(await response.json()).toEqual({
      error: "登录尝试过多，请稍后再试",
      retryAfterSeconds: 300,
    });
  });

  it("releases every reservation when Auth is unavailable", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T07:30:00.000Z");
    const setup = dependencies(rpc, { now, profile: userProfile });
    setup.deps.signInWithPassword = async () => {
      throw new HttpError(503, "登录服务暂不可用");
    };

    const response = await post(failedLoginRequest(userProfile.phone), setup.deps);

    expect(response.status).toBe(503);
    expect(
      [...rpc.limits.values()].every(
        (state) => state.pendingCount === 0 && state.failureCount === 0,
      ),
    ).toBe(true);
    expect(rpc.reservations.size).toBe(0);
  });

  it("clears a provisional phone block when the admitted Auth call fails as a service error", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T07:40:00.000Z");
    const warmup = dependencies(rpc, { now });
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await post(failedLoginRequest("13800000000"), warmup.deps);
    }

    let signalAuthStarted!: () => void;
    let releaseAuth!: () => void;
    const authStarted = new Promise<void>((resolve) => {
      signalAuthStarted = resolve;
    });
    const authBarrier = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const concurrent = dependencies(rpc, { now });
    concurrent.deps.signInWithPassword = async () => {
      signalAuthStarted();
      await authBarrier;
      throw new HttpError(503, "登录服务暂不可用");
    };

    const admittedPromise = post(failedLoginRequest("13800000000"), concurrent.deps);
    await authStarted;
    expect(
      (await post(failedLoginRequest("13800000000"), concurrent.deps)).status,
    ).toBe(429);
    releaseAuth();
    expect((await admittedPromise).status).toBe(503);

    const phoneState = [...rpc.limits.entries()].find(([id]) =>
      id.startsWith("login_phone\n"),
    )?.[1];
    expect(phoneState).toMatchObject({
      failureCount: 9,
      pendingCount: 0,
      blockedUntil: null,
    });
  });

  it("retains a provisional block when the admitted attempt finalizes as failure", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T07:50:00.000Z");
    const warmup = dependencies(rpc, { now });
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await post(failedLoginRequest("13800000000"), warmup.deps);
    }

    let signalAuthStarted!: () => void;
    let releaseAuth!: () => void;
    const authStarted = new Promise<void>((resolve) => {
      signalAuthStarted = resolve;
    });
    const authBarrier = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const concurrent = dependencies(rpc, { now });
    concurrent.deps.signInWithPassword = async () => {
      signalAuthStarted();
      await authBarrier;
      return null;
    };

    const admittedPromise = post(failedLoginRequest("13800000000"), concurrent.deps);
    await authStarted;
    await post(failedLoginRequest("13800000000"), concurrent.deps);
    releaseAuth();
    await admittedPromise;

    const phoneState = [...rpc.limits.entries()].find(([id]) =>
      id.startsWith("login_phone\n"),
    )?.[1];
    expect(phoneState).toMatchObject({
      failureCount: 10,
      pendingCount: 0,
      blockedUntil: Date.parse("2026-08-04T07:55:00.000Z"),
    });
  });

  it("clears a provisional IP block when the admitted login succeeds", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T08:00:00.000Z");
    const warmup = dependencies(rpc, { now });
    for (let attempt = 0; attempt < 19; attempt += 1) {
      await post(failedLoginRequest(String(13800000100 + attempt)), warmup.deps);
    }

    let signalAuthStarted!: () => void;
    let releaseAuth!: () => void;
    const authStarted = new Promise<void>((resolve) => {
      signalAuthStarted = resolve;
    });
    const authBarrier = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const admitted = dependencies(rpc, {
      now,
      profile: userProfile,
      login: {
        user: { id: userProfile.userId, appMetadata: { role: "user" } },
        accessToken: "access-value",
        refreshToken: "refresh-value",
      },
    });
    admitted.deps.signInWithPassword = async () => {
      signalAuthStarted();
      await authBarrier;
      return {
        user: { id: userProfile.userId, appMetadata: { role: "user" } },
        accessToken: "access-value",
        refreshToken: "refresh-value",
      };
    };

    const admittedPromise = post(
      failedLoginRequest(userProfile.phone),
      admitted.deps,
    );
    await authStarted;
    expect(
      (await post(failedLoginRequest("13900000000"), admitted.deps)).status,
    ).toBe(429);
    releaseAuth();
    expect((await admittedPromise).status).toBe(200);

    const ipState = [...rpc.limits.entries()].find(([id]) =>
      id.startsWith("login_ip\n"),
    )?.[1];
    expect(ipState).toMatchObject({
      failureCount: 19,
      pendingCount: 0,
      blockedUntil: null,
    });
  });

  it("accepts an idempotent applied:false finalize without revoking a successful login", async () => {
    const setup = dependencies(new InMemoryRateLimitRpc(), {
      now: () => new Date("2026-08-04T08:30:00.000Z"),
      profile: userProfile,
      login: {
        user: { id: userProfile.userId, appMetadata: { role: "user" } },
        accessToken: "access-value",
        refreshToken: "refresh-value",
      },
    });
    let revoked = 0;
    setup.deps.rateLimitRpc = {
      reserveRateLimitAttempt: async () =>
        rpcResponse([
          {
            is_reserved: true,
            is_blocked: false,
            blocked_until: null,
            failure_count: 0,
          },
        ]),
      finalizeRateLimitAttempt: async () =>
        rpcResponse([{ applied: false, failure_count: 0, pending_count: 0 }]),
    };
    setup.deps.revokeAccessToken = async () => {
      revoked += 1;
    };

    const response = await post(failedLoginRequest(userProfile.phone), setup.deps);

    expect(response.status).toBe(200);
    expect(revoked).toBe(0);
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("masks a blocked root success, withholds cookies, and best-effort revokes its token", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T09:00:00.000Z");
    const warmup = dependencies(rpc, { now, profile: rootProfile });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await post(failedLoginRequest(rootProfile.phone), warmup.deps);
    }
    const blocked = dependencies(rpc, {
      now,
      profile: rootProfile,
      login: {
        user: { id: rootProfile.userId, appMetadata: { role: "root_admin" } },
        accessToken: "blocked-access-value",
        refreshToken: "blocked-refresh-value",
      },
    });
    let revoked = 0;
    blocked.deps.revokeAccessToken = async (token) => {
      expect(token).toBe("blocked-access-value");
      revoked += 1;
      throw new Error("revocation unavailable");
    };

    const response = await post(failedLoginRequest(rootProfile.phone), blocked.deps);

    expect(response.status).toBe(429);
    expect(blocked.authCalls()).toBe(1);
    expect(revoked).toBe(1);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(blocked.sleepCalls).toEqual([800]);
    expect(await response.text()).not.toContain("blocked-access-value");
    expect(blocked.deferred).toHaveLength(1);
    await Promise.all(blocked.deferred);
  });

  it.each(["slow", "never-resolving"] as const)(
    "returns a padded blocked-root 429 without waiting for a %s revocation",
    async (mode) => {
      const rpc = new InMemoryRateLimitRpc();
      const now = () => new Date("2026-08-04T09:15:00.000Z");
      const warmup = dependencies(rpc, { now, profile: rootProfile });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await post(failedLoginRequest(rootProfile.phone), warmup.deps);
      }
      const blocked = dependencies(rpc, {
        now,
        profile: rootProfile,
        login: {
          user: { id: rootProfile.userId, appMetadata: { role: "root_admin" } },
          accessToken: "blocked-access-value",
          refreshToken: "blocked-refresh-value",
        },
      });
      let finishRevocation!: () => void;
      const revocation = new Promise<void>((resolve) => {
        finishRevocation = resolve;
      });
      blocked.deps.revokeAccessToken = () => revocation;

      const response = await post(
        failedLoginRequest(rootProfile.phone),
        blocked.deps,
      );

      expect(response.status).toBe(429);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(blocked.sleepCalls).toEqual([800]);
      expect(blocked.deferred).toHaveLength(1);
      if (mode === "slow") {
        finishRevocation();
        await Promise.all(blocked.deferred);
      }
    },
  );

  it("keeps the blocked-root 429 when the background scheduler throws", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T09:20:00.000Z");
    const warmup = dependencies(rpc, { now, profile: rootProfile });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await post(failedLoginRequest(rootProfile.phone), warmup.deps);
    }
    const blocked = dependencies(rpc, {
      now,
      profile: rootProfile,
      login: {
        user: { id: rootProfile.userId, appMetadata: { role: "root_admin" } },
        accessToken: "blocked-access-value",
        refreshToken: "blocked-refresh-value",
      },
    });
    blocked.deps.revokeAccessToken = async () => undefined;
    blocked.deps.defer = () => {
      throw new Error("scheduler unavailable");
    };

    const response = await post(failedLoginRequest(rootProfile.phone), blocked.deps);

    expect(response.status).toBe(429);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(blocked.sleepCalls).toEqual([800]);
  });

  it("keeps a blocked-root 429 when Auth itself is unavailable", async () => {
    const rpc = new InMemoryRateLimitRpc();
    const now = () => new Date("2026-08-04T09:30:00.000Z");
    const warmup = dependencies(rpc, { now, profile: rootProfile });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await post(failedLoginRequest(rootProfile.phone), warmup.deps);
    }
    const blocked = dependencies(rpc, { now, profile: rootProfile });
    let authCalls = 0;
    blocked.deps.signInWithPassword = async () => {
      authCalls += 1;
      throw new HttpError(503, "登录服务暂不可用");
    };

    const response = await post(failedLoginRequest(rootProfile.phone), blocked.deps);

    expect(response.status).toBe(429);
    expect(authCalls).toBe(1);
    expect(blocked.sleepCalls).toEqual([800]);
    const states = Object.fromEntries(
      [...rpc.limits.entries()].map(([id, state]) => [id.split("\n")[0], state]),
    );
    expect(states.login_phone.failureCount).toBe(4);
    expect(states.login_ip.failureCount).toBe(4);
  });

  it("fails closed on a structurally invalid atomic reservation response", async () => {
    const setup = dependencies(new InMemoryRateLimitRpc(), {
      now: () => new Date("2026-08-04T08:00:00.000Z"),
    });
    let authCalls = 0;
    setup.deps.rateLimitRpc = {
      reserveRateLimitAttempt: async () =>
        rpcResponse([
          {
            is_reserved: false,
            is_blocked: false,
            blocked_until: null,
            failure_count: 0,
          },
        ]),
      finalizeRateLimitAttempt: async () =>
        rpcResponse([{ applied: true, failure_count: 0, pending_count: 0 }]),
    };
    setup.deps.signInWithPassword = async () => {
      authCalls += 1;
      return null;
    };

    const response = await post(failedLoginRequest("13800000000"), setup.deps);

    expect(response.status).toBe(503);
    expect(authCalls).toBe(0);
  });
});
