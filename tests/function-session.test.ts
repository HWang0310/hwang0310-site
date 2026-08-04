import { describe, expect, it } from "vitest";

import type { AuditEventInput } from "../functions/_lib/audit";
import type { Env } from "../functions/_lib/env";
import type {
  RateLimitCheckArgs,
  RateLimitClearArgs,
  RateLimitFailureArgs,
  RateLimitRpc,
  RateLimitRpcResponse,
} from "../functions/_lib/rate-limit";
import {
  revokeSession,
  type ProfileRecord,
  type SessionUser,
} from "../functions/_lib/session";
import {
  handleSessionRequest,
  type LoginResult,
  type SessionRouteDependencies,
} from "../functions/projects/income-forecast/api/session";

const assets: Fetcher = {
  fetch: async () => new Response("asset"),
  connect: () => {
    throw new Error("connect is not used in session tests");
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

const allowingRpc: RateLimitRpc = {
  checkRateLimit: async (_args: RateLimitCheckArgs) =>
    rpcResponse([{ is_blocked: false, blocked_until: null, failure_count: 0 }]),
  recordRateLimitFailure: async (_args: RateLimitFailureArgs) =>
    rpcResponse([{ failure_count: 1, blocked_until: null, is_blocked: false }]),
  clearRateLimit: async (_args: RateLimitClearArgs) => rpcResponse(null),
};

const profile: ProfileRecord = {
  userId: "user-1",
  fullName: "测试用户",
  employeeNo: "000002",
  phone: "13800000002",
  email: "user@example.test",
  role: "user",
  isActive: true,
  usesInitialPassword: true,
  mustChangePassword: false,
};

const loginResult: LoginResult = {
  user: { id: profile.userId, appMetadata: { role: profile.role } },
  accessToken: "access-value",
  refreshToken: "refresh-value",
};

function postRequest(body: object, headers: Record<string, string> = {}): Request {
  return new Request(
    "https://hwang0310.dpdns.org/projects/income-forecast/api/session",
    {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "203.0.113.20",
        "Content-Type": "application/json",
        Origin: "https://hwang0310.dpdns.org",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function dependencies(overrides: Partial<SessionRouteDependencies> = {}) {
  const audits: AuditEventInput[] = [];
  const deps: SessionRouteDependencies = {
    rateLimitRpc: allowingRpc,
    now: () => new Date("2026-08-04T04:00:00.000Z"),
    findProfileByPhone: async () => profile,
    signInWithPassword: async () => loginResult,
    getSession: async () => null,
    revokeAccessToken: async () => undefined,
    revokeSession: async (_request, headers) => {
      headers.set("X-Test-Logout", "done");
    },
    writeAudit: async (event) => {
      audits.push(event);
    },
    ...overrides,
  };
  return { deps, audits };
}

describe("income forecast session route", () => {
  it("logs in with a normalized phone and returns only the safe session response", async () => {
    let authInput: { phone: string; password: string } | null = null;
    const setup = dependencies({
      signInWithPassword: async (input) => {
        authInput = input;
        return loginResult;
      },
    });
    const response = await handleSessionRequest(
      postRequest({
        phone: " 138-0000-0002 ",
        password: "credential-value",
        next: "/projects/income-forecast/reports/2026/07/26/",
      }),
      env,
      setup.deps,
    );

    expect(response.status).toBe(200);
    expect(authInput).toEqual({
      phone: "13800000002",
      password: "credential-value",
    });
    const serializedResponse = await response.clone().text();
    expect(await response.json()).toEqual({
      user: {
        id: "user-1",
        name: "测试用户",
        role: "user",
        usesInitialPassword: true,
        mustChangePassword: false,
      },
      next: "/projects/income-forecast/reports/2026/07/26/",
    });
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=access-value; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
      "if_refresh=refresh-value; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
    ]);
    expect(serializedResponse).not.toContain("credential-value");
    expect(serializedResponse).not.toContain(profile.phone);
    expect(JSON.stringify(setup.audits)).not.toContain("credential-value");
    expect(JSON.stringify(setup.audits)).not.toContain(profile.phone);
  });

  it("uses one error for an unknown phone and a known phone with wrong credentials", async () => {
    let unknownAuthCalls = 0;
    const unknown = dependencies({
      findProfileByPhone: async () => null,
      signInWithPassword: async () => {
        unknownAuthCalls += 1;
        return null;
      },
    });
    const wrong = dependencies({ signInWithPassword: async () => null });

    const unknownResponse = await handleSessionRequest(
      postRequest({ phone: "13800000003", password: "unknown-value" }),
      env,
      unknown.deps,
    );
    const wrongResponse = await handleSessionRequest(
      postRequest({ phone: profile.phone, password: "wrong-value" }),
      env,
      wrong.deps,
    );

    expect(unknownAuthCalls).toBe(1);
    expect(unknownResponse.status).toBe(401);
    expect(wrongResponse.status).toBe(401);
    expect(await unknownResponse.text()).toBe(await wrongResponse.text());
    expect(JSON.stringify(unknown.audits)).not.toContain("13800000003");
    expect(JSON.stringify(wrong.audits)).not.toContain(profile.phone);
  });

  it("fails closed without CF-Connecting-IP before profile lookup or Auth", async () => {
    let dependencyCalls = 0;
    const setup = dependencies({
      findProfileByPhone: async () => {
        dependencyCalls += 1;
        return profile;
      },
      signInWithPassword: async () => {
        dependencyCalls += 1;
        return loginResult;
      },
    });
    const response = await handleSessionRequest(
      postRequest(
        { phone: profile.phone, password: "credential-value" },
        {
          "CF-Connecting-IP": "",
          "X-Forwarded-For": "198.51.100.99",
        },
      ),
      env,
      setup.deps,
    );

    expect(response.status).toBe(403);
    expect(dependencyCalls).toBe(0);
  });

  it("rejects an untrusted or mismatched auth role without returning tokens", async () => {
    let revoked = 0;
    const setup = dependencies({
      signInWithPassword: async () => ({
        ...loginResult,
        user: {
          id: profile.userId,
          appMetadata: { role: "root_admin" },
        },
      }),
      revokeAccessToken: async () => {
        revoked += 1;
      },
    });
    const response = await handleSessionRequest(
      postRequest({ phone: profile.phone, password: "credential-value" }),
      env,
      setup.deps,
    );

    expect(response.status).toBe(401);
    expect(revoked).toBe(1);
    expect(await response.text()).not.toContain("access-value");
  });

  it("GET returns a safe SessionResponse and applies rotated cookies", async () => {
    const session: SessionUser = {
      id: profile.userId,
      name: profile.fullName,
      employeeNo: profile.employeeNo,
      phone: profile.phone,
      email: profile.email,
      role: profile.role,
      usesInitialPassword: profile.usesInitialPassword,
      mustChangePassword: profile.mustChangePassword,
      applyCookies(headers) {
        headers.append("Set-Cookie", "if_access=rotated; HttpOnly; Secure");
      },
    };
    const setup = dependencies({ getSession: async () => session });
    const response = await handleSessionRequest(
      new Request(
        "https://hwang0310.dpdns.org/projects/income-forecast/api/session?next=https://evil.example",
      ),
      env,
      setup.deps,
    );

    expect(await response.json()).toEqual({
      user: {
        id: profile.userId,
        name: profile.fullName,
        role: profile.role,
        usesInitialPassword: true,
        mustChangePassword: false,
      },
      next: "/projects/income-forecast/",
    });
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=rotated; HttpOnly; Secure",
    ]);
  });

  it("DELETE revokes the local session and clears both cookies", async () => {
    let revoked = 0;
    const setup = dependencies({
      revokeSession: async (_request, headers) => {
        revoked += 1;
        headers.append(
          "Set-Cookie",
          "if_access=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
        );
        headers.append(
          "Set-Cookie",
          "if_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
        );
      },
    });
    const response = await handleSessionRequest(
      new Request(
        "https://hwang0310.dpdns.org/projects/income-forecast/api/session",
        {
          method: "DELETE",
          headers: {
            Cookie: "if_access=private-access; if_refresh=private-refresh",
            Origin: "https://hwang0310.dpdns.org",
          },
        },
      ),
      env,
      setup.deps,
    );

    expect(response.status).toBe(200);
    expect(revoked).toBe(1);
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
      "if_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
    ]);
    const body = await response.text();
    expect(body).not.toContain("private-access");
    expect(body).not.toContain("private-refresh");
  });

  it("checks DELETE origin before reading the session", async () => {
    let sessionCalls = 0;
    const setup = dependencies({
      getSession: async () => {
        sessionCalls += 1;
        return null;
      },
    });
    const response = await handleSessionRequest(
      new Request(
        "https://hwang0310.dpdns.org/projects/income-forecast/api/session",
        { method: "DELETE", headers: { Origin: "https://evil.example" } },
      ),
      env,
      setup.deps,
    );

    expect(response.status).toBe(403);
    expect(sessionCalls).toBe(0);
  });

  it("the token-safe revocation helper clears cookies even when remote revocation fails", async () => {
    const headers = new Headers();
    const request = new Request(
      "https://hwang0310.dpdns.org/projects/income-forecast/api/session",
      {
        method: "DELETE",
        headers: {
          Cookie: "if_access=private-access; if_refresh=private-refresh",
          Origin: "https://hwang0310.dpdns.org",
        },
      },
    );

    await expect(
      revokeSession(request, env, headers, {
        refreshSession: async () => ({
          accessToken: "rotated-private-access",
          refreshToken: "rotated-private-refresh",
        }),
        revokeAccessToken: async () => {
          throw new Error("upstream unavailable");
        },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(headers.getSetCookie()).toEqual([
      "if_access=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
      "if_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
    ]);
    expect(JSON.stringify(headers)).not.toContain("private-access");
    expect(JSON.stringify(headers)).not.toContain("private-refresh");
  });

  it("DELETE keeps cleared cookies and writes a safe failed audit when revocation fails", async () => {
    const setup = dependencies({
      revokeSession: (request, headers) =>
        revokeSession(request, env, headers, {
          refreshSession: async () => ({
            accessToken: "rotated-private-access",
            refreshToken: "rotated-private-refresh",
          }),
          revokeAccessToken: async () => {
            throw new Error("upstream unavailable");
          },
        }),
    });
    const response = await handleSessionRequest(
      new Request(
        "https://hwang0310.dpdns.org/projects/income-forecast/api/session",
        {
          method: "DELETE",
          headers: {
            Cookie: "if_access=private-access; if_refresh=private-refresh",
            Origin: "https://hwang0310.dpdns.org",
          },
        },
      ),
      env,
      setup.deps,
    );

    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([
      "if_access=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
      "if_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
    ]);
    expect(setup.audits).toEqual([
      {
        action: "session.logout",
        result: false,
        targetType: "session",
        metadata: { reason: "revocation_failed" },
      },
    ]);
    const serialized = `${await response.text()}${JSON.stringify(setup.audits)}`;
    expect(serialized).not.toContain("private-access");
    expect(serialized).not.toContain("private-refresh");
  });
});
