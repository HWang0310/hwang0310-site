import { describe, expect, it, vi } from "vitest";

import type { Env } from "../functions/_lib/env";
import type { ProfileRecord, SessionUser } from "../functions/_lib/session";
import {
  handleAdminUsersRequest,
  handleAdminUserRequest,
  type AdminUserDependencies,
} from "../functions/projects/income-forecast/api/admin/users";
import {
  handleAdminUserDetailRequest,
} from "../functions/projects/income-forecast/api/admin/users/[id]";
import {
  handleAdminReportsRequest,
  type AdminReportDependencies,
} from "../functions/projects/income-forecast/api/admin/reports";
import {
  handleAdminReportRequest,
} from "../functions/projects/income-forecast/api/admin/reports/[date]";
import {
  handleAdminAuditRequest,
  type AdminAuditDependencies,
} from "../functions/projects/income-forecast/api/admin/audit";

const ORIGIN = "https://hwang0310.dpdns.org";
const assets: Fetcher = {
  fetch: async () => new Response("asset"),
  connect: () => {
    throw new Error("connect is not used in admin tests");
  },
};

function env(): Env {
  return {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    RATE_LIMIT_HMAC_SECRET: "rate-limit-secret",
    SITE_ORIGIN: ORIGIN,
    SUPABASE_STORAGE_BUCKET: "income-forecast-reports",
    ASSETS: assets,
  };
}

const rootProfile: ProfileRecord = {
  userId: "root-1",
  fullName: "王昊",
  employeeNo: "000001",
  phone: "13800138000",
  email: "wanghao@chinatelecom.cn",
  role: "root_admin",
  isActive: true,
  usesInitialPassword: false,
  mustChangePassword: false,
};

const ordinaryProfile: ProfileRecord = {
  userId: "user-1",
  fullName: "李四",
  employeeNo: "000002",
  phone: "13900139000",
  email: "lisi@chinatelecom.cn",
  role: "user",
  isActive: true,
  usesInitialPassword: true,
  mustChangePassword: false,
};

const adminProfile = (profile: ProfileRecord) => ({ ...profile, updatedAt: null });

function session(role: SessionUser["role"]): SessionUser {
  const profile = role === "root_admin" ? rootProfile : ordinaryProfile;
  return {
    id: profile.userId,
    name: profile.fullName,
    employeeNo: profile.employeeNo,
    phone: profile.phone,
    email: profile.email,
    role,
    usesInitialPassword: profile.usesInitialPassword,
    mustChangePassword: profile.mustChangePassword,
    applyCookies: () => undefined,
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      ...(init.headers ?? {}),
    },
  });
}

function jsonRequest(path: string, body: unknown): Request {
  return request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function userDeps(
  overrides: Partial<AdminUserDependencies> = {},
): AdminUserDependencies {
  return {
    requireAdmin: async () => session("admin"),
    listProfiles: async () => [adminProfile(rootProfile), adminProfile(ordinaryProfile)],
    getProfile: async (id) => id === rootProfile.userId ? adminProfile(rootProfile) : adminProfile(ordinaryProfile),
    setActive: async () => undefined,
    setRequirePasswordChange: async () => undefined,
    sendReset: async () => undefined,
    revokeUserSessions: async () => undefined,
    writeAudit: async () => undefined,
    ...overrides,
  };
}

describe("income forecast administration authorization", () => {
  it("returns 403 for an ordinary user on every admin API", async () => {
    const deps = userDeps({ requireAdmin: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } });
    const paths = [
      handleAdminUsersRequest(request("/projects/income-forecast/api/admin/users"), env(), deps),
      handleAdminUserRequest(request("/projects/income-forecast/api/admin/users/user-1", { method: "PATCH" }), env(), "user-1", deps),
      handleAdminReportsRequest(request("/projects/income-forecast/api/admin/reports"), env(), reportDeps({ requireAdmin: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } })),
      handleAdminReportRequest(request("/projects/income-forecast/api/admin/reports/20260724", { method: "PATCH" }), env(), "20260724", reportDeps({ requireAdmin: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } })),
      handleAdminAuditRequest(request("/projects/income-forecast/api/admin/audit"), env(), auditDeps({ requireAdmin: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } })),
    ];
    const responses = await Promise.all(paths);
    for (const response of responses) expect(response.status).toBe(403);
  });

  it("does not allow a non-root administrator to deactivate the root administrator", async () => {
    const setActive = vi.fn(async () => undefined);
    const response = await handleAdminUserDetailRequest(
      jsonRequest("/projects/income-forecast/api/admin/users/root-1", { action: "set_active", active: false }),
      env(),
      "root-1",
      userDeps({ setActive }),
    );
    expect(response.status).toBe(409);
    expect(setActive).not.toHaveBeenCalled();
  });

  it("does not allow Wang Hao to deactivate himself", async () => {
    const setActive = vi.fn(async () => undefined);
    const response = await handleAdminUserRequest(
      jsonRequest("/projects/income-forecast/api/admin/users/root-1", { action: "set_active", active: false }),
      env(),
      "root-1",
      userDeps({ requireAdmin: async () => session("root_admin"), setActive }),
    );
    expect(response.status).toBe(409);
    expect(setActive).not.toHaveBeenCalled();
  });

  it("revokes sessions before deactivating a user", async () => {
    const order: string[] = [];
    const response = await handleAdminUserRequest(
      jsonRequest("/projects/income-forecast/api/admin/users/user-1", { action: "set_active", active: false }),
      env(),
      "user-1",
      userDeps({
        requireAdmin: async () => ({ ...session("admin"), id: "admin-actor" }),
        revokeUserSessions: async () => { order.push("revoke"); },
        setActive: async () => { order.push("deactivate"); },
      }),
    );
    expect(response.status).toBe(200);
    expect(order).toEqual(["revoke", "deactivate"]);
  });

  it("restores Auth access before reactivating a user", async () => {
    const order: string[] = [];
    const response = await handleAdminUserRequest(
      jsonRequest("/projects/income-forecast/api/admin/users/user-1", { action: "set_active", active: true }),
      env(),
      "user-1",
      userDeps({
        requireAdmin: async () => ({ ...session("admin"), id: "admin-actor" }),
        restoreUserSessions: async () => { order.push("restore"); },
        setActive: async () => { order.push("activate"); },
      }),
    );
    expect(response.status).toBe(200);
    expect(order).toEqual(["restore", "activate"]);
  });

  it("returns a safe user projection without password hashes or tokens", async () => {
    const response = await handleAdminUsersRequest(request("/projects/income-forecast/api/admin/users"), env(), userDeps());
    expect(response.status).toBe(200);
    const body = await response.json() as { users: Array<Record<string, unknown>> };
    expect(body.users).toHaveLength(2);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/encrypted_password|password_hash|access_token|refresh_token|jwt/iu);
    expect(body.users[1]).toMatchObject({ fullName: "李四", role: "user", active: true });
    expect(body.users[1].phone).toBe("139****9000");
  });
});

type AdminReport = {
  reportDate: string;
  title: string;
  releaseId: string | null;
  storagePrefix: string | null;
  visibility: "public" | "private";
  pinned: boolean;
  status: "staging" | "online" | "offline";
  sizeBytes: number;
  fileCount: number;
  publishedAt: string | null;
  cleanedAt: string | null;
  updatedAt: string | null;
};

function reportDeps(overrides: Partial<AdminReportDependencies> = {}): AdminReportDependencies {
  const rows: AdminReport[] = [
    { reportDate: "20260720", title: "公开例", releaseId: null, storagePrefix: null, visibility: "public", pinned: true, status: "online", sizeBytes: 100, fileCount: 1, publishedAt: "2026-07-20T00:00:00Z", cleanedAt: null, updatedAt: null },
    { reportDate: "20260724", title: "私有例", releaseId: "release-1", storagePrefix: "reports/2026/07/24/", visibility: "private", pinned: false, status: "online", sizeBytes: 2_000, fileCount: 1, publishedAt: "2026-07-24T00:00:00Z", cleanedAt: null, updatedAt: null },
  ];
  return {
    requireAdmin: async () => session("admin"),
    listReports: async () => rows,
    updateReport: async () => undefined,
    removeReportObjects: async () => undefined,
    writeAudit: async () => undefined,
    ...overrides,
  };
}

describe("income forecast report administration", () => {
  it("returns capacity and next eviction information", async () => {
    const response = await handleAdminReportsRequest(request("/projects/income-forecast/api/admin/reports"), env(), reportDeps());
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      softLimitBytes: 850 * 1024 * 1024,
      freeTierReferenceBytes: 1_000_000_000,
      privateUsedBytes: 2_000,
      onlineTotalBytes: 2_100,
      nextEvictionDate: null,
    });
    expect(body.reports).toBeInstanceOf(Array);
  });

  it("protects both public dates from mutation", async () => {
    const updateReport = vi.fn(async () => undefined);
    for (const date of ["20260720", "20260725"]) {
      const response = await handleAdminReportRequest(
        jsonRequest(`/projects/income-forecast/api/admin/reports/${date}`, { action: "set_pinned", pinned: false }),
        env(), date, reportDeps({ updateReport }),
      );
      expect(response.status).toBe(409);
    }
    expect(updateReport).not.toHaveBeenCalled();
  });

  it("supports pinning and explicit offline operations for private reports", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const response = await handleAdminReportRequest(
      jsonRequest("/projects/income-forecast/api/admin/reports/20260724", { action: "set_pinned", pinned: true }),
      env(), "20260724", reportDeps({ updateReport: async (date, patch) => { updates.push({ date, ...patch }); } }),
    );
    expect(response.status).toBe(200);
    expect(updates).toEqual([{ date: "20260724", pinned: true }]);
  });
});

function auditDeps(overrides: Partial<AdminAuditDependencies> = {}): AdminAuditDependencies {
  return {
    requireAdmin: async () => session("admin"),
    listAudit: async () => ({
      events: [{ id: 1, eventType: "user.set_active", actorUserId: "user-1", targetType: "profile", targetId: "user-2", success: true, metadata: { ok: true, token: "must-not-show" }, createdAt: "2026-08-01T00:00:00Z" }],
      page: 1,
      pageSize: 50,
      hasMore: false,
      nextPage: null,
    }),
    ...overrides,
  };
}

describe("income forecast audit administration", () => {
  it("sanitizes sensitive audit metadata and bounds pagination", async () => {
    const response = await handleAdminAuditRequest(
      request("/projects/income-forecast/api/admin/audit?page=1&pageSize=50"),
      env(), auditDeps(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/must-not-show|token/iu);
  });

  it("rejects an unbounded audit page size", async () => {
    const response = await handleAdminAuditRequest(
      request("/projects/income-forecast/api/admin/audit?pageSize=1000"),
      env(), auditDeps(),
    );
    expect(response.status).toBe(400);
  });
});
