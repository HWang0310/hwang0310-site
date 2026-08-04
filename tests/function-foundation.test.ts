import { describe, expect, it } from "vitest";

import {
  type AuditDependencies,
  type AuditInsert,
  writeAudit,
} from "../functions/_lib/audit";
import { type Env, requireEnv } from "../functions/_lib/env";
import {
  HttpError,
  json,
  maskEmail,
  normalizeName,
  normalizePhone,
  requireSameOrigin,
  safeNext,
} from "../functions/_lib/http";
import {
  type ProfileRecord,
  type SessionDependencies,
  buildSessionCookieHeaders,
  clearSessionCookieHeaders,
  getSession,
  requireAdmin,
  requireUser,
} from "../functions/_lib/session";

const assets: Fetcher = {
  fetch: async () => new Response("asset"),
  connect: () => {
    throw new Error("connect is not used in foundation tests");
  },
};

function validEnv(): Env {
  return {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    RATE_LIMIT_HMAC_SECRET: "rate-limit-secret",
    SITE_ORIGIN: "https://hwang0310.dpdns.org",
    SUPABASE_STORAGE_BUCKET: "income-reports",
    ASSETS: assets,
  };
}

const activeProfile: ProfileRecord = {
  userId: "user-1",
  fullName: "王昊",
  employeeNo: "420001",
  phone: "13800138000",
  email: "wanghao@chinatelecom.cn",
  role: "user",
  isActive: true,
  usesInitialPassword: false,
  mustChangePassword: false,
};

function sessionDependencies(
  overrides: Partial<SessionDependencies> = {},
): SessionDependencies {
  return {
    verifyAccessToken: async (accessToken) =>
      accessToken === "valid-access"
        ? {
            id: "user-1",
            appMetadata: { role: "user" },
            userMetadata: { role: "root_admin" },
          }
        : null,
    refreshSession: async () => null,
    getProfile: async () => activeProfile,
    ...overrides,
  };
}

describe("function foundation environment", () => {
  it("returns a normalized immutable runtime config", () => {
    const config = requireEnv({
      ...validEnv(),
      SUPABASE_STORAGE_BUCKET: "  income-reports  ",
    });

    expect(config.supabaseStorageBucket).toBe("income-reports");
    expect(config.siteOrigin).toBe("https://hwang0310.dpdns.org");
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("fails closed without identifying a missing secret", () => {
    const env = { ...validEnv(), SUPABASE_SERVICE_ROLE_KEY: "" };

    expect(() => requireEnv(env)).toThrowError(
      expect.objectContaining({ status: 500, message: "服务器配置不可用" }),
    );
  });

  it("rejects a site origin that contains a path", () => {
    const env = {
      ...validEnv(),
      SITE_ORIGIN: "https://hwang0310.dpdns.org/projects/income-forecast/",
    };

    expect(() => requireEnv(env)).toThrowError(
      expect.objectContaining({ status: 500 }),
    );
  });
});

describe("function foundation input normalization", () => {
  it("normalizes a formatted mainland mobile number", () => {
    expect(normalizePhone(" 138-0013-8000 ")).toBe("13800138000");
  });

  it("rejects an invalid mobile number", () => {
    expect(() => normalizePhone("123")).toThrow(/手机号/);
  });

  it("normalizes surrounding and repeated name whitespace", () => {
    expect(normalizeName("  王\t 昊  ")).toBe("王 昊");
  });

  it("masks the local part while preserving the email domain", () => {
    expect(maskEmail("wanghao@chinatelecom.cn")).toBe(
      "wan***ao@chinatelecom.cn",
    );
  });

  it("rejects an external next URL", () => {
    expect(safeNext("https://evil.example/")).toBe(
      "/projects/income-forecast/",
    );
  });

  it("preserves an income forecast report path", () => {
    expect(
      safeNext("/projects/income-forecast/reports/2026/07/26/"),
    ).toBe("/projects/income-forecast/reports/2026/07/26/");
  });

  it.each([
    "/projects/income-forecast/../admin/",
    "/projects/income-forecast/%2e%2e/admin/",
    "/projects/income-forecast/%252e%252e/admin/",
    "/projects/income-forecast/reports/%0d%0aSet-Cookie:bad/",
    "//evil.example/projects/income-forecast/",
  ])("rejects a path that escapes the income forecast area: %s", (value) => {
    expect(safeNext(value)).toBe("/projects/income-forecast/");
  });

  it("rejects a name containing control characters", () => {
    expect(() => normalizeName("王\u0000昊")).toThrow(/姓名/);
  });

  it("rejects control characters hidden in a formatted phone", () => {
    expect(() => normalizePhone("138\n0013-8000")).toThrow(/手机号/);
  });
});

describe("function foundation HTTP responses", () => {
  it("sets JSON and private response headers without overriding explicit headers", async () => {
    const response = json(
      { ok: true },
      { status: 201, headers: { "X-Request-Id": "request-1" } },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toBe("request-1");
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each(["POST", "PATCH", "DELETE"])(
    "rejects a missing Origin for %s before authentication",
    (method) => {
      const request = new Request("https://preview.pages.dev/api/session", {
        method,
      });

      expect(() =>
        requireSameOrigin(request, "https://hwang0310.dpdns.org"),
      ).toThrowError(expect.objectContaining({ status: 403 }));
    },
  );

  it("accepts the request URL origin on a preview deployment", () => {
    const request = new Request("https://preview.pages.dev/api/session", {
      method: "POST",
      headers: { Origin: "https://preview.pages.dev" },
    });

    expect(() =>
      requireSameOrigin(request, "https://hwang0310.dpdns.org"),
    ).not.toThrow();
  });

  it("rejects a cross-origin mutation", () => {
    const request = new Request("https://hwang0310.dpdns.org/api/session", {
      method: "DELETE",
      headers: { Origin: "https://evil.example" },
    });

    expect(() =>
      requireSameOrigin(request, "https://hwang0310.dpdns.org"),
    ).toThrow(HttpError);
  });
});

describe("function foundation session cookies", () => {
  it("sets both tokens only in hardened HttpOnly cookies", () => {
    const cookies = buildSessionCookieHeaders({
      accessToken: "access-value",
      refreshToken: "refresh-value",
    });

    expect(cookies).toEqual([
      "if_access=access-value; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
      "if_refresh=refresh-value; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
    ]);
  });

  it("clears both hardened cookies", () => {
    expect(clearSessionCookieHeaders()).toEqual([
      "if_access=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
      "if_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/; Max-Age=0",
    ]);
  });
});

describe("function foundation trusted sessions", () => {
  it("uses app metadata and an active matching profile", async () => {
    const request = new Request("https://hwang0310.dpdns.org/api/session", {
      headers: { Cookie: "if_access=valid-access" },
    });

    const session = await getSession(request, validEnv(), sessionDependencies());

    expect(session).toMatchObject({
      id: "user-1",
      name: "王昊",
      role: "user",
      phone: "13800138000",
      usesInitialPassword: false,
      mustChangePassword: false,
    });
  });

  it("rejects an inactive profile", async () => {
    const request = new Request("https://hwang0310.dpdns.org/api/session", {
      headers: { Cookie: "if_access=valid-access" },
    });
    const dependencies = sessionDependencies({
      getProfile: async () => ({ ...activeProfile, isActive: false }),
    });

    await expect(getSession(request, validEnv(), dependencies)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects a profile role that differs from app metadata", async () => {
    const request = new Request("https://hwang0310.dpdns.org/api/session", {
      headers: { Cookie: "if_access=valid-access" },
    });
    const dependencies = sessionDependencies({
      getProfile: async () => ({ ...activeProfile, role: "admin" }),
    });

    await expect(getSession(request, validEnv(), dependencies)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refreshes an invalid access token and exposes tokens only through cookie application", async () => {
    const request = new Request("https://hwang0310.dpdns.org/api/session", {
      headers: {
        Cookie: "if_access=expired-access; if_refresh=valid-refresh",
      },
    });
    const dependencies = sessionDependencies({
      verifyAccessToken: async (accessToken) =>
        accessToken === "rotated-access"
          ? { id: "user-1", appMetadata: { role: "user" } }
          : null,
      refreshSession: async (refreshToken) =>
        refreshToken === "valid-refresh"
          ? {
              accessToken: "rotated-access",
              refreshToken: "rotated-refresh",
            }
          : null,
    });

    const session = await getSession(request, validEnv(), dependencies);
    expect(session).not.toBeNull();
    expect(JSON.stringify(session)).not.toContain("rotated-access");
    expect(JSON.stringify(session)).not.toContain("rotated-refresh");

    const headers = new Headers();
    session?.applyCookies(headers);
    expect(headers.getSetCookie()).toEqual([
      "if_access=rotated-access; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
      "if_refresh=rotated-refresh; HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/",
    ]);
  });

  it("checks mutation origin before an authentication dependency can run", async () => {
    const request = new Request("https://hwang0310.dpdns.org/api/session", {
      method: "DELETE",
      headers: {
        Origin: "https://evil.example",
        Cookie: "if_access=valid-access",
      },
    });
    const dependencies = sessionDependencies({
      verifyAccessToken: async () => {
        throw new Error("authentication must not run");
      },
    });

    await expect(getSession(request, validEnv(), dependencies)).rejects.toMatchObject({
      status: 403,
      message: "请求来源无效",
    });
  });

  it("returns null when no cookies are present", async () => {
    const request = new Request("https://hwang0310.dpdns.org/api/session");
    const dependencies = sessionDependencies({
      verifyAccessToken: async () => {
        throw new Error("authentication must not run");
      },
    });

    await expect(getSession(request, validEnv(), dependencies)).resolves.toBeNull();
  });

  it("requires a user and an administrator at their respective gates", async () => {
    const anonymousRequest = new Request("https://hwang0310.dpdns.org/api/session");
    await expect(
      requireUser(anonymousRequest, validEnv(), sessionDependencies()),
    ).rejects.toMatchObject({ status: 401 });

    const userRequest = new Request("https://hwang0310.dpdns.org/api/session", {
      headers: { Cookie: "if_access=valid-access" },
    });
    await expect(
      requireAdmin(userRequest, validEnv(), sessionDependencies()),
    ).rejects.toMatchObject({ status: 403 });

    const adminDependencies = sessionDependencies({
      verifyAccessToken: async () => ({
        id: "user-1",
        appMetadata: { role: "admin" },
      }),
      getProfile: async () => ({ ...activeProfile, role: "admin" }),
    });
    await expect(
      requireAdmin(userRequest, validEnv(), adminDependencies),
    ).resolves.toMatchObject({ id: "user-1", role: "admin" });
  });
});

describe("function foundation audit boundary", () => {
  it("writes only mapped audit columns and cleaned business metadata", async () => {
    let inserted: AuditInsert | null = null;
    const dependencies: AuditDependencies = {
      insertAudit: async (record) => {
        inserted = record;
      },
    };

    await writeAudit(
      validEnv(),
      {
        action: "report.view",
        actorUserId: "user-1",
        targetType: "report",
        targetId: "2026-07-26",
        result: true,
        requestId: "request-1",
        metadata: { source: "private_gateway", bytes: 1024 },
      },
      dependencies,
    );

    expect(inserted).toEqual({
      event_type: "report.view",
      actor_user_id: "user-1",
      target_type: "report",
      target_id: "2026-07-26",
      success: true,
      metadata: {
        source: "private_gateway",
        bytes: 1024,
        requestId: "request-1",
      },
    });
  });

  it.each(["password", "accessToken", "session_cookie", "clientSecret"])(
    "rejects a sensitive metadata key containing %s",
    async (sensitiveKey) => {
      const dependencies: AuditDependencies = {
        insertAudit: async () => {
          throw new Error("unsafe audit must not be written");
        },
      };

      await expect(
        writeAudit(
          validEnv(),
          {
            action: "login.failure",
            actorUserId: null,
            result: false,
            metadata: { context: { [sensitiveKey]: "sensitive-value" } },
          },
          dependencies,
        ),
      ).rejects.toMatchObject({ status: 400, message: "审计信息包含敏感字段" });
    },
  );

  it("rejects an unexpected top-level field", async () => {
    const event = {
      action: "login.failure",
      actorUserId: null,
      result: false,
      metadata: {},
      debugCookie: "must-not-pass",
    };

    await expect(
      writeAudit(validEnv(), event, {
        insertAudit: async () => {
          throw new Error("unsafe audit must not be written");
        },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("propagates a failed awaited audit write as a safe service error", async () => {
    await expect(
      writeAudit(
        validEnv(),
        { action: "report.view", actorUserId: "user-1", result: true },
        {
          insertAudit: async () => {
            throw new Error("database error containing service-role-key");
          },
        },
      ),
    ).rejects.toMatchObject({ status: 503, message: "审计服务暂不可用" });
  });
});
