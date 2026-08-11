import { describe, expect, it } from "vitest";

import type { AuditEventInput } from "../functions/_lib/audit";
import type { Env } from "../functions/_lib/env";
import type {
  RateLimitFinalizeArgs,
  RateLimitFinalizeRow,
  PasswordRecoveryLimitArgs,
  PasswordRecoveryLimitRow,
  PasswordRecoveryRateLimitRpc,
  RateLimitReservationArgs,
  RateLimitReservationRow,
  RateLimitRpc,
  RateLimitRpcResponse,
} from "../functions/_lib/rate-limit";
import type { ProfileRecord, SessionUser } from "../functions/_lib/session";
import {
  consumeForgotPasswordAttempt,
  handleForgotPasswordRequest,
  type ForgotPasswordDependencies,
} from "../functions/projects/income-forecast/api/password/forgot";
import {
  handleResetPasswordRequest,
  type PasswordAuthSession,
  type ResetPasswordDependencies,
} from "../functions/projects/income-forecast/api/password/reset";
import {
  handleChangePasswordRequest,
  type ChangePasswordDependencies,
} from "../functions/projects/income-forecast/api/password/change";

const ORIGIN = "https://hwang0310.dpdns.org";
const RECOVERY_REDIRECT =
  `${ORIGIN}/projects/income-forecast/reset-password/`;
const SUCCESS_MESSAGE =
  "重置信息已发送。请前往您的邮箱：wan***ao@chinatelecom.cn，查看收件箱或垃圾邮件，并按邮件提示重置密码。";
const TOKEN_HASH = "a".repeat(64);

const assets: Fetcher = {
  fetch: async () => new Response("asset"),
  connect: () => {
    throw new Error("connect is not used in password tests");
  },
};

const env: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-test-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  RATE_LIMIT_HMAC_SECRET: "rate-limit-test-value",
  SITE_ORIGIN: ORIGIN,
  SUPABASE_STORAGE_BUCKET: "income-forecast-reports",
  ASSETS: assets,
};

const profile: ProfileRecord = {
  userId: "user-1",
  fullName: "王昊",
  employeeNo: "420001",
  phone: "13800138000",
  email: "wanghao@chinatelecom.cn",
  role: "user",
  isActive: true,
  usesInitialPassword: true,
  mustChangePassword: true,
};

const authSession: PasswordAuthSession = {
  userId: profile.userId,
  role: profile.role,
  accessToken: "recovery-access",
  refreshToken: "recovery-refresh",
};

function request(
  path: "forgot" | "reset" | "change",
  body: object,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    `${ORIGIN}/projects/income-forecast/api/password/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

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

type StoredLimit = {
  windowStartedAt: number;
  failureCount: number;
  pendingCount: number;
  blockedUntil: number | null;
};

class AtomicRateLimitRpc implements RateLimitRpc, PasswordRecoveryRateLimitRpc {
  readonly calls: Array<
    RateLimitReservationArgs | RateLimitFinalizeArgs | PasswordRecoveryLimitArgs
  > = [];
  readonly limits = new Map<string, StoredLimit>();
  readonly reservations = new Map<string, { limitId: string; window: number }>();

  private id(key: string, action: string): string {
    return `${action}\n${key}`;
  }

  async reserveRateLimitAttempt(args: RateLimitReservationArgs) {
    this.calls.push(args);
    const now = Date.parse(args.p_now);
    const id = this.id(args.p_limit_key, args.p_action);
    let limit = this.limits.get(id);
    if (limit === undefined) {
      limit = {
        windowStartedAt: now,
        failureCount: 0,
        pendingCount: 0,
        blockedUntil: null,
      };
      this.limits.set(id, limit);
    } else if (limit.blockedUntil !== null && limit.blockedUntil > now) {
      return rpcResponse<RateLimitReservationRow[]>([{
        is_reserved: false,
        is_blocked: true,
        blocked_until: new Date(limit.blockedUntil).toISOString(),
        failure_count: limit.failureCount,
      }]);
    } else if (
      limit.blockedUntil !== null ||
      limit.windowStartedAt + args.p_window_seconds * 1_000 <= now
    ) {
      limit.windowStartedAt = now;
      limit.failureCount = 0;
      limit.pendingCount = 0;
      limit.blockedUntil = null;
    }

    if (limit.failureCount + limit.pendingCount >= args.p_max_failures) {
      limit.blockedUntil = now + args.p_block_seconds * 1_000;
      return rpcResponse<RateLimitReservationRow[]>([{
        is_reserved: false,
        is_blocked: true,
        blocked_until: new Date(limit.blockedUntil).toISOString(),
        failure_count: limit.failureCount,
      }]);
    }

    const reservationId = `${args.p_reservation_id}\n${id}`;
    this.reservations.set(reservationId, {
      limitId: id,
      window: limit.windowStartedAt,
    });
    limit.pendingCount += 1;
    return rpcResponse<RateLimitReservationRow[]>([{
      is_reserved: true,
      is_blocked: false,
      blocked_until: null,
      failure_count: limit.failureCount,
    }]);
  }

  async finalizeRateLimitAttempt(args: RateLimitFinalizeArgs) {
    this.calls.push(args);
    const id = this.id(args.p_limit_key, args.p_action);
    const reservationId = `${args.p_reservation_id}\n${id}`;
    const reservation = this.reservations.get(reservationId);
    const limit = this.limits.get(id);
    if (reservation === undefined || limit === undefined) {
      return rpcResponse<RateLimitFinalizeRow[]>([{
        applied: false,
        failure_count: limit?.failureCount ?? 0,
        pending_count: limit?.pendingCount ?? 0,
      }]);
    }
    this.reservations.delete(reservationId);
    if (reservation.window === limit.windowStartedAt) {
      limit.pendingCount = Math.max(0, limit.pendingCount - 1);
      if (args.p_outcome === "failure") limit.failureCount += 1;
    }
    if (
      args.p_outcome === "release" &&
      limit.failureCount + limit.pendingCount < args.p_max_failures
    ) {
      limit.blockedUntil = null;
    }
    return rpcResponse<RateLimitFinalizeRow[]>([{
      applied: true,
      failure_count: limit.failureCount,
      pending_count: limit.pendingCount,
    }]);
  }

  async consumePasswordRecoveryAttempt(args: PasswordRecoveryLimitArgs) {
    this.calls.push(args);
    const now = Date.parse(args.p_now);
    const consumeWindow = (
      key: string,
      action: string,
      windowMilliseconds: number,
      saturationCount: number,
    ): StoredLimit => {
      const id = this.id(key, action);
      let limit = this.limits.get(id);
      if (
        limit === undefined ||
        limit.windowStartedAt + windowMilliseconds <= now
      ) {
        limit = {
          windowStartedAt: now,
          failureCount: 0,
          pendingCount: 0,
          blockedUntil: null,
        };
        this.limits.set(id, limit);
      }
      limit.failureCount = Math.min(
        limit.failureCount + 1,
        saturationCount,
      );
      return limit;
    };

    const hour = consumeWindow(
      args.p_hour_key,
      "password_forgot_hour",
      3_600_000,
      11,
    );
    if (hour.failureCount > 10) {
      return rpcResponse<PasswordRecoveryLimitRow[]>([{
        is_allowed: false,
        retry_after_seconds: Math.max(
          1,
          Math.ceil(
            (hour.windowStartedAt + 3_600_000 - now) / 1_000,
          ),
        ),
        minute_count: 0,
        hour_count: hour.failureCount,
      }]);
    }

    const minute = consumeWindow(
      args.p_minute_key,
      "password_forgot_minute",
      60_000,
      2,
    );
    if (minute.failureCount > 1) {
      return rpcResponse<PasswordRecoveryLimitRow[]>([{
        is_allowed: false,
        retry_after_seconds: Math.max(
          1,
          Math.ceil((minute.windowStartedAt + 60_000 - now) / 1_000),
        ),
        minute_count: minute.failureCount,
        hour_count: hour.failureCount,
      }]);
    }

    return rpcResponse<PasswordRecoveryLimitRow[]>([{
      is_allowed: true,
      retry_after_seconds: 0,
      minute_count: minute.failureCount,
      hour_count: hour.failureCount,
    }]);
  }
}

function forgotDependencies(overrides: Partial<ForgotPasswordDependencies> = {}) {
  const audits: AuditEventInput[] = [];
  const calls: string[] = [];
  const dependencies: ForgotPasswordDependencies = {
    consumeAttempt: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    findActiveProfilesByName: async () => [profile],
    sendRecoveryEmail: async () => true,
    writeAudit: async (event) => {
      audits.push(event);
    },
    ...overrides,
  };
  return { dependencies, audits, calls };
}

function resetDependencies(overrides: Partial<ResetPasswordDependencies> = {}) {
  const audits: AuditEventInput[] = [];
  const calls: string[] = [];
  const dependencies: ResetPasswordDependencies = {
    verifyRecoveryToken: async () => authSession,
    getProfile: async () => profile,
    updatePassword: async () => {
      calls.push("update-password");
    },
    markPasswordChanged: async () => {
      calls.push("update-profile");
    },
    revokeSessions: async () => {
      calls.push("revoke-sessions");
    },
    signInWithPassword: async () => ({
      ...authSession,
      accessToken: "new-access",
      refreshToken: "new-refresh",
    }),
    writeAudit: async (event) => {
      audits.push(event);
    },
    ...overrides,
  };
  return { dependencies, audits, calls };
}

const sessionUser: SessionUser = {
  id: profile.userId,
  name: profile.fullName,
  employeeNo: profile.employeeNo,
  phone: profile.phone,
  email: profile.email,
  role: profile.role,
  usesInitialPassword: true,
  mustChangePassword: true,
  applyCookies: () => undefined,
};

function changeDependencies(overrides: Partial<ChangePasswordDependencies> = {}) {
  const audits: AuditEventInput[] = [];
  const calls: string[] = [];
  const dependencies: ChangePasswordDependencies = {
    getSession: async () => sessionUser,
    signInWithPassword: async () => authSession,
    updatePassword: async () => {
      calls.push("update-password");
    },
    markPasswordChanged: async () => {
      calls.push("update-profile");
    },
    revokeSessions: async () => {
      calls.push("revoke-sessions");
    },
    establishSession: async () => ({
      ...authSession,
      accessToken: "new-access",
      refreshToken: "new-refresh",
    }),
    writeAudit: async (event) => {
      audits.push(event);
    },
    ...overrides,
  };
  return { dependencies, audits, calls };
}

describe("forgot-password route", () => {
  it("normalizes the name with NFC before limiting and looking up a profile", async () => {
    const seen: string[] = [];
    const setup = forgotDependencies({
      consumeAttempt: async (name) => {
        seen.push(`limit:${name}`);
        return { allowed: true, retryAfterSeconds: 0 };
      },
      findActiveProfilesByName: async (name) => {
        seen.push(`lookup:${name}`);
        return [profile];
      },
    });

    const response = await handleForgotPasswordRequest(
      request("forgot", { name: "  Wa\u0301ng  \u660a  " }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(200);
    expect(seen).toEqual(["limit:Wáng 昊", "lookup:Wáng 昊"]);
  });

  it("sends the fixed same-domain recovery URL and returns the exact masked success", async () => {
    let emailInput: { email: string; redirectTo: string } | null = null;
    const setup = forgotDependencies({
      sendRecoveryEmail: async (email, redirectTo) => {
        emailInput = { email, redirectTo };
        return true;
      },
    });
    const response = await handleForgotPasswordRequest(
      request("forgot", { name: profile.fullName }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(200);
    expect(emailInput).toEqual({
      email: profile.email,
      redirectTo: RECOVERY_REDIRECT,
    });
    expect(await response.json()).toEqual({
      status: "sent",
      maskedEmail: "wan***ao@chinatelecom.cn",
      message: SUCCESS_MESSAGE,
    });
    expect(JSON.stringify(setup.audits)).not.toContain(profile.fullName);
    expect(JSON.stringify(setup.audits)).not.toContain(profile.email);
  });

  it("counts an unknown or disabled name before lookup without sending email", async () => {
    const order: string[] = [];
    const setup = forgotDependencies({
      consumeAttempt: async () => {
        order.push("limit");
        return { allowed: true, retryAfterSeconds: 0 };
      },
      findActiveProfilesByName: async () => {
        order.push("lookup");
        return [];
      },
      sendRecoveryEmail: async () => {
        order.push("email");
        return true;
      },
    });
    const response = await handleForgotPasswordRequest(
      request("forgot", { name: "未知用户" }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(400);
    expect(order).toEqual(["limit", "lookup"]);
    expect(await response.text()).not.toContain("未知用户");
    expect(JSON.stringify(setup.audits)).not.toContain("未知用户");
  });

  it("consumes the normalized-name limit before validating an employee suffix", async () => {
    const order: string[] = [];
    const setup = forgotDependencies({
      consumeAttempt: async () => {
        order.push("limit");
        return { allowed: true, retryAfterSeconds: 0 };
      },
      findActiveProfilesByName: async () => {
        order.push("lookup");
        return [profile];
      },
    });
    const response = await handleForgotPasswordRequest(
      request("forgot", {
        name: profile.fullName,
        employeeSuffix: "12",
      }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(400);
    expect(order).toEqual(["limit"]);
  });

  it("requires an employee suffix for duplicate names and matches the exact last four digits", async () => {
    const duplicate = {
      ...profile,
      userId: "user-2",
      employeeNo: "429999",
      phone: "13900139000",
      email: "other@chinatelecom.cn",
    };
    let sentTo: string | null = null;
    const setup = forgotDependencies({
      findActiveProfilesByName: async () => [profile, duplicate],
      sendRecoveryEmail: async (email) => {
        sentTo = email;
        return true;
      },
    });

    const needsSuffix = await handleForgotPasswordRequest(
      request("forgot", { name: profile.fullName }),
      env,
      setup.dependencies,
    );
    expect(await needsSuffix.json()).toEqual({ status: "needs_employee_suffix" });

    const matched = await handleForgotPasswordRequest(
      request("forgot", { name: profile.fullName, employeeSuffix: "9999" }),
      env,
      setup.dependencies,
    );
    expect(matched.status).toBe(200);
    expect(sentTo).toBe(duplicate.email);

    const wrong = await handleForgotPasswordRequest(
      request("forgot", { name: profile.fullName, employeeSuffix: "0000" }),
      env,
      setup.dependencies,
    );
    expect(wrong.status).toBe(400);
    const wrongBody = await wrong.text();
    expect(wrongBody).not.toContain(profile.employeeNo);
    expect(wrongBody).not.toContain(duplicate.employeeNo);
  });

  it("fails safely when duplicate names share the same employee-number suffix", async () => {
    const first = {
      ...profile,
      employeeNo: "420001",
    };
    const second = {
      ...profile,
      userId: "user-2",
      employeeNo: "990001",
      phone: "13900139000",
      email: "other@chinatelecom.cn",
    };
    let emailCalls = 0;
    const setup = forgotDependencies({
      findActiveProfilesByName: async () => [first, second],
      sendRecoveryEmail: async () => {
        emailCalls += 1;
        return true;
      },
    });

    const response = await handleForgotPasswordRequest(
      request("forgot", {
        name: profile.fullName,
        employeeSuffix: "0001",
      }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(400);
    expect(emailCalls).toBe(0);
    const responseBody = await response.text();
    expect(responseBody).not.toContain(first.email);
    expect(responseBody).not.toContain(second.email);
    expect(responseBody).not.toContain(first.employeeNo);
    expect(responseBody).not.toContain(second.employeeNo);
  });

  it("never reports sent when the SMTP-backed Auth call rejects the message", async () => {
    const setup = forgotDependencies({ sendRecoveryEmail: async () => false });
    const response = await handleForgotPasswordRequest(
      request("forgot", { name: profile.fullName }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('"status":"sent"');
    expect(JSON.stringify(setup.audits)).not.toContain(profile.email);
  });

  it("rejects a malformed registered email before calling the mail service", async () => {
    let emailCalls = 0;
    const setup = forgotDependencies({
      findActiveProfilesByName: async () => [{
        ...profile,
        email: "not-an-email",
      }],
      sendRecoveryEmail: async () => {
        emailCalls += 1;
        return true;
      },
    });
    const response = await handleForgotPasswordRequest(
      request("forgot", { name: profile.fullName }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(400);
    expect(emailCalls).toBe(0);
  });

  it("atomically rejects the second concurrent minute attempt and the eleventh hourly attempt", async () => {
    const rpc = new AtomicRateLimitRpc();
    const now = new Date("2026-08-04T00:00:00.000Z");
    const concurrent = await Promise.all([
      consumeForgotPasswordAttempt("secret", profile.fullName, rpc, now),
      consumeForgotPasswordAttempt("secret", profile.fullName, rpc, now),
    ]);
    expect(concurrent.filter((entry) => entry.allowed)).toHaveLength(1);
    expect(concurrent.find((entry) => !entry.allowed)?.retryAfterSeconds).toBe(60);

    const hourlyRpc = new AtomicRateLimitRpc();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await consumeForgotPasswordAttempt(
        "secret",
        profile.fullName,
        hourlyRpc,
        new Date(now.getTime() + attempt * 61_000),
      );
      expect(result.allowed).toBe(true);
    }
    const eleventh = await consumeForgotPasswordAttempt(
      "secret",
      profile.fullName,
      hourlyRpc,
      new Date(now.getTime() + 10 * 61_000),
    );
    expect(eleventh).toEqual({ allowed: false, retryAfterSeconds: 2_990 });
    expect(JSON.stringify(hourlyRpc.calls)).not.toContain(profile.fullName);
  });

  it("keeps the original minute window instead of extending it from the rejected request", async () => {
    const rpc = new AtomicRateLimitRpc();
    const startedAt = new Date("2026-08-04T00:00:00.000Z");

    expect((await consumeForgotPasswordAttempt(
      "secret", profile.fullName, rpc, startedAt,
    )).allowed).toBe(true);
    expect(await consumeForgotPasswordAttempt(
      "secret",
      profile.fullName,
      rpc,
      new Date(startedAt.getTime() + 59_000),
    )).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect((await consumeForgotPasswordAttempt(
      "secret",
      profile.fullName,
      rpc,
      new Date(startedAt.getTime() + 60_000),
    )).allowed).toBe(true);
  });

  it("counts minute-blocked submissions toward the hourly limit", async () => {
    const rpc = new AtomicRateLimitRpc();
    const now = new Date("2026-08-04T00:00:00.000Z");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await consumeForgotPasswordAttempt(
        "secret",
        profile.fullName,
        rpc,
        now,
      );
    }

    expect(await consumeForgotPasswordAttempt(
      "secret",
      profile.fullName,
      rpc,
      now,
    )).toEqual({ allowed: false, retryAfterSeconds: 3_600 });
  });

  it("reopens the original hourly window at 3600 seconds", async () => {
    const rpc = new AtomicRateLimitRpc();
    const startedAt = new Date("2026-08-04T00:00:00.000Z");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await consumeForgotPasswordAttempt(
        "secret",
        profile.fullName,
        rpc,
        startedAt,
      );
    }

    expect(await consumeForgotPasswordAttempt(
      "secret",
      profile.fullName,
      rpc,
      new Date(startedAt.getTime() + 3_599_000),
    )).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect((await consumeForgotPasswordAttempt(
      "secret",
      profile.fullName,
      rpc,
      new Date(startedAt.getTime() + 3_600_000),
    )).allowed).toBe(true);
  });
});

describe("recovery password route", () => {
  it("verifies only recovery token_hash, changes flags, revokes old sessions, and sets new secure cookies", async () => {
    const order: string[] = [];
    let verifyInput: { tokenHash: string; type: "recovery" } | null = null;
    let signInInput: { email: string; password: string } | null = null;
    const setup = resetDependencies({
      verifyRecoveryToken: async (tokenHash, type) => {
        verifyInput = { tokenHash, type };
        return authSession;
      },
      updatePassword: async () => {
        order.push("password");
      },
      markPasswordChanged: async () => {
        order.push("profile");
      },
      revokeSessions: async () => {
        order.push("revoke");
      },
      signInWithPassword: async (email, password) => {
        signInInput = { email, password };
        order.push("sign-in");
        return { ...authSession, accessToken: "new-access", refreshToken: "new-refresh" };
      },
    });
    const response = await handleResetPasswordRequest(
      request("reset", { tokenHash: TOKEN_HASH, password: "new-pass" }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(200);
    expect(verifyInput).toEqual({ tokenHash: TOKEN_HASH, type: "recovery" });
    expect(signInInput).toEqual({ email: profile.email, password: "new-pass" });
    expect(order).toEqual(["password", "profile", "revoke", "sign-in"]);
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=new-access; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
      "if_refresh=new-refresh; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
    ]);
    expect(JSON.stringify(setup.audits)).not.toContain(TOKEN_HASH);
    expect(JSON.stringify(setup.audits)).not.toContain("new-pass");
  });

  it("rejects an invalid or replayed token without changing a password", async () => {
    let remaining = 1;
    let updates = 0;
    const setup = resetDependencies({
      verifyRecoveryToken: async () => remaining-- > 0 ? authSession : null,
      updatePassword: async () => {
        updates += 1;
      },
    });
    const first = await handleResetPasswordRequest(
      request("reset", { tokenHash: TOKEN_HASH, password: "new-pass" }),
      env,
      setup.dependencies,
    );
    const replay = await handleResetPasswordRequest(
      request("reset", { tokenHash: TOKEN_HASH, password: "new-pass" }),
      env,
      setup.dependencies,
    );
    const malformed = await handleResetPasswordRequest(
      request("reset", { tokenHash: "bad", password: "new-pass" }),
      env,
      setup.dependencies,
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(updates).toBe(1);
    expect(await replay.text()).not.toContain(TOKEN_HASH);
  });

  it.each([
    ["1234567", 400],
    ["a".repeat(73), 400],
    ["é".repeat(4), 200],
    ["a".repeat(72), 200],
  ])("enforces the 8–72 UTF-8 byte password boundary", async (password, status) => {
    const setup = resetDependencies();
    const response = await handleResetPasswordRequest(
      request("reset", { tokenHash: TOKEN_HASH, password }),
      env,
      setup.dependencies,
    );
    expect(response.status).toBe(status);
  });

  it("rejects a role/profile mismatch before updating Auth", async () => {
    let updates = 0;
    let revocations = 0;
    const setup = resetDependencies({
      verifyRecoveryToken: async () => ({ ...authSession, role: "root_admin" }),
      updatePassword: async () => {
        updates += 1;
      },
      revokeSessions: async () => {
        revocations += 1;
      },
    });
    const response = await handleResetPasswordRequest(
      request("reset", { tokenHash: TOKEN_HASH, password: "new-pass" }),
      env,
      setup.dependencies,
    );
    expect(response.status).toBe(400);
    expect(updates).toBe(0);
    expect(revocations).toBe(1);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("fails safely without new session cookies when profile update or revocation fails", async () => {
    for (const overrides of [
      { markPasswordChanged: async () => { throw new Error("profile unavailable"); } },
      { revokeSessions: async () => { throw new Error("revocation unavailable"); } },
    ]) {
      const setup = resetDependencies(overrides);
      const response = await handleResetPasswordRequest(
        request("reset", { tokenHash: TOKEN_HASH, password: "new-pass" }),
        env,
        setup.dependencies,
      );
      expect(response.status).toBe(503);
      expect(response.headers.getSetCookie().some((cookie) => cookie.includes("new-access"))).toBe(false);
      const responseBody = await response.text();
      expect(responseBody).not.toContain(TOKEN_HASH);
      expect(responseBody).not.toContain("new-pass");
    }
  });

  it("clears local cookies when the Auth password update result is uncertain", async () => {
    const setup = resetDependencies({
      updatePassword: async () => {
        throw new Error("connection closed after request");
      },
    });
    const response = await handleResetPasswordRequest(
      request("reset", { tokenHash: TOKEN_HASH, password: "new-pass" }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
      "if_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
    ]);
  });
});

describe("authenticated password-change route", () => {
  it.each([
    ["malformed JSON", "{", "application/json"],
    [
      "equal passwords",
      JSON.stringify({ currentPassword: "same-pass", newPassword: "same-pass" }),
      "application/json",
    ],
    [
      "invalid new password",
      JSON.stringify({ currentPassword: "old-pass", newPassword: "short" }),
      "application/json",
    ],
  ])("authenticates before reading an anonymous %s request", async (_case, body, contentType) => {
    let sessionCalls = 0;
    let reauthCalls = 0;
    const setup = changeDependencies({
      getSession: async () => {
        sessionCalls += 1;
        return null;
      },
      signInWithPassword: async () => {
        reauthCalls += 1;
        return authSession;
      },
    });
    const anonymousRequest = new Request(
      `${ORIGIN}/projects/income-forecast/api/password/change`,
      {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Origin: ORIGIN,
        },
        body,
      },
    );

    const response = await handleChangePasswordRequest(
      anonymousRequest,
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(401);
    expect(sessionCalls).toBe(1);
    expect(reauthCalls).toBe(0);
    expect(anonymousRequest.bodyUsed).toBe(false);
  });

  it("reauthenticates with the trusted profile email and establishes only a new session", async () => {
    let reauthInput: { email: string; password: string } | null = null;
    let establishInput: { email: string; password: string } | null = null;
    const setup = changeDependencies({
      signInWithPassword: async (email, password) => {
        reauthInput = { email, password };
        return authSession;
      },
      establishSession: async (email, password) => {
        establishInput = { email, password };
        return {
          ...authSession,
          accessToken: "new-access",
          refreshToken: "new-refresh",
        };
      },
    });
    const response = await handleChangePasswordRequest(
      request("change", {
        currentPassword: "old-pass",
        newPassword: "new-pass",
      }),
      env,
      setup.dependencies,
    );
    expect(response.status).toBe(200);
    expect(reauthInput).toEqual({ email: profile.email, password: "old-pass" });
    expect(establishInput).toEqual({ email: profile.email, password: "new-pass" });
    expect(setup.calls).toEqual([
      "update-password",
      "update-profile",
      "revoke-sessions",
    ]);
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=new-access; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
      "if_refresh=new-refresh; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
    ]);
    expect(JSON.stringify(setup.audits)).not.toContain("old-pass");
    expect(JSON.stringify(setup.audits)).not.toContain("new-pass");
    expect(JSON.stringify(setup.audits)).not.toContain(profile.phone);
  });

  it("rejects a wrong current password, equal new password, and reauth role mismatch", async () => {
    const wrong = changeDependencies({ signInWithPassword: async () => null });
    const wrongResponse = await handleChangePasswordRequest(
      request("change", { currentPassword: "wrong-pass", newPassword: "new-pass" }),
      env,
      wrong.dependencies,
    );
    expect(wrongResponse.status).toBe(401);

    const equal = changeDependencies();
    const equalResponse = await handleChangePasswordRequest(
      request("change", { currentPassword: "same-pass", newPassword: "same-pass" }),
      env,
      equal.dependencies,
    );
    expect(equalResponse.status).toBe(400);

    const mismatch = changeDependencies({
      signInWithPassword: async () => ({ ...authSession, role: "root_admin" }),
    });
    const mismatchResponse = await handleChangePasswordRequest(
      request("change", { currentPassword: "old-pass", newPassword: "new-pass" }),
      env,
      mismatch.dependencies,
    );
    expect(mismatchResponse.status).toBe(401);
    expect(mismatch.calls).toEqual(["revoke-sessions"]);
    for (const response of [wrongResponse, equalResponse, mismatchResponse]) {
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("does not issue a new cookie when Supabase, profile, revocation, or new sign-in fails", async () => {
    const cases: Partial<ChangePasswordDependencies>[] = [
      { updatePassword: async () => { throw new Error("auth unavailable"); } },
      { markPasswordChanged: async () => { throw new Error("profile unavailable"); } },
      { revokeSessions: async () => { throw new Error("revoke unavailable"); } },
      { establishSession: async () => null },
    ];
    for (const overrides of cases) {
      const setup = changeDependencies(overrides);
      const response = await handleChangePasswordRequest(
        request("change", { currentPassword: "old-pass", newPassword: "new-pass" }),
        env,
        setup.dependencies,
      );
      expect(response.status).toBe(503);
      expect(response.headers.getSetCookie().some((cookie) => cookie.includes("new-access"))).toBe(false);
      const responseBody = await response.text();
      expect(responseBody).not.toContain("old-pass");
      expect(responseBody).not.toContain("new-pass");
    }
  });

  it("clears the old login cookies when the Auth password update result is uncertain", async () => {
    const setup = changeDependencies({
      updatePassword: async () => {
        throw new Error("connection closed after request");
      },
    });
    const response = await handleChangePasswordRequest(
      request("change", { currentPassword: "old-pass", newPassword: "new-pass" }),
      env,
      setup.dependencies,
    );

    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
      "if_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
    ]);
  });
});

describe("password route HTTP boundary", () => {
  it("requires strict same-origin POST requests for all three routes", async () => {
    const forgot = forgotDependencies();
    const reset = resetDependencies();
    const change = changeDependencies();
    const foreign = { Origin: "https://evil.example" };
    const responses = await Promise.all([
      handleForgotPasswordRequest(request("forgot", { name: profile.fullName }, foreign), env, forgot.dependencies),
      handleResetPasswordRequest(request("reset", { tokenHash: TOKEN_HASH, password: "new-pass" }, foreign), env, reset.dependencies),
      handleChangePasswordRequest(request("change", { currentPassword: "old-pass", newPassword: "new-pass" }, foreign), env, change.dependencies),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
  });

  it("rejects unbounded or extra JSON without echoing sensitive fields", async () => {
    const setup = resetDependencies();
    const oversized = request("reset", {
      tokenHash: TOKEN_HASH,
      password: "a".repeat(5_000),
    });
    const extra = request("reset", {
      tokenHash: TOKEN_HASH,
      password: "new-pass",
      email: profile.email,
    });
    for (const candidate of [oversized, extra]) {
      const response = await handleResetPasswordRequest(candidate, env, setup.dependencies);
      expect(response.status).toBe(400);
      const responseBody = await response.text();
      expect(responseBody).not.toContain(TOKEN_HASH);
      expect(responseBody).not.toContain(profile.email);
    }
  });
});
