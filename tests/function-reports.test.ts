import { describe, expect, it, vi } from "vitest";

import type { Env } from "../functions/_lib/env";
import type { ProfileRecord, SessionUser } from "../functions/_lib/session";
import {
  type DownloadedReportObject,
  type ReportDependencies,
  type ReportRecord,
  handleReportRequest,
  parseReportObjectPath,
} from "../functions/_lib/reports";
import {
  handleReportsRequest,
} from "../functions/projects/income-forecast/api/reports";

const ORIGIN = "https://hwang0310.dpdns.org";

const assets: Fetcher = {
  fetch: vi.fn(async () =>
    new Response("public asset", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  ),
  connect: () => {
    throw new Error("connect is not used in report tests");
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

const userProfile: ProfileRecord = {
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

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: userProfile.userId,
    name: userProfile.fullName,
    employeeNo: userProfile.employeeNo,
    phone: userProfile.phone,
    email: userProfile.email,
    role: userProfile.role,
    usesInitialPassword: userProfile.usesInitialPassword,
    mustChangePassword: userProfile.mustChangePassword,
    applyCookies: () => undefined,
    ...overrides,
  };
}

function report(date: string, overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    date,
    title: `收入预估报告-${date}`,
    releaseId: `release-${date}`,
    storagePrefix: `reports/${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}/release-${date}/`,
    visibility: "private",
    pinned: false,
    status: "online",
    sizeBytes: 1024,
    fileCount: 3,
    publishedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

function dependencies(overrides: Partial<ReportDependencies> = {}): ReportDependencies {
  return {
    getSession: async () => null,
    listOnlineReports: async () => [
      report("20260724"),
      report("20260726"),
    ],
    getOnlineReport: async (date) =>
      date === "20260724" ? report(date) : null,
    downloadObject: async () => ({
      kind: "ok",
      data: new Blob(["private report"]),
    }),
    fetchPublic: async () => new Response("public asset"),
    ...overrides,
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

describe("income forecast report path policy", () => {
  it("maps a report directory to index.html and exposes a canonical date", () => {
    expect(
      parseReportObjectPath(
        "/projects/income-forecast/reports/2026/07/24/",
      ),
    ).toEqual({ date: "20260724", objectPath: "index.html" });
  });

  it.each([
    "/projects/income-forecast/reports/2026/07/24/%2e%2e/secret",
    "/projects/income-forecast/reports/2026/07/24/%252e%252e/secret",
    "/projects/income-forecast/reports/2026/07/24/%5csecret",
    "/projects/income-forecast/reports/2026/07/24/%00secret",
    "/projects/income-forecast/reports/2026/07/24/./secret",
    "/projects/income-forecast/reports/2026/07/24/../secret",
  ])("rejects an unsafe report path: %s", (path) => {
    expect(() => parseReportObjectPath(path)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe("income forecast report list", () => {
  it("returns only the two public examples without touching Supabase", async () => {
    const listOnlineReports = vi.fn(async () => []);
    const response = await handleReportsRequest(
      request("/projects/income-forecast/api/reports"),
      env(),
      dependencies({ listOnlineReports }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reports: [
        {
          date: "20260720",
          webPath: "/projects/income-forecast/reports/2026/07/20/",
          visibility: "public",
          pinned: true,
          sizeBytes: 0,
          online: true,
        },
        {
          date: "20260725",
          webPath: "/projects/income-forecast/reports/2026/07/25/",
          visibility: "public",
          pinned: true,
          sizeBytes: 0,
          online: true,
        },
      ],
    });
    expect(listOnlineReports).not.toHaveBeenCalled();
  });

  it("returns all online reports to a normal session", async () => {
    const response = await handleReportsRequest(
      request("/projects/income-forecast/api/reports", {
        headers: { Cookie: "if_access=valid-access" },
      }),
      env(),
      dependencies({ getSession: async () => session() }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { reports: unknown[] };
    expect(body.reports.map((item: any) => item.date)).toEqual([
      "20260720",
      "20260724",
      "20260725",
      "20260726",
    ]);
  });

  it("blocks report lists while a password change is required", async () => {
    const response = await handleReportsRequest(
      request("/projects/income-forecast/api/reports"),
      env(),
      dependencies({
        getSession: async () => session({ mustChangePassword: true }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "请先完成密码设置" });
  });

  it("keeps public listing available when the private database is unavailable", async () => {
    const response = await handleReportsRequest(
      request("/projects/income-forecast/api/reports"),
      env(),
      dependencies({
        getSession: async () => session(),
        listOnlineReports: async () => {
          throw new Error("database unavailable");
        },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "报告服务暂不可用" });
  });
});

describe("income forecast report gateway", () => {
  it("serves an allowlisted public report from static assets", async () => {
    const fetchPublic = vi.fn(async () =>
      new Response("public html", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    const response = await handleReportRequest(
      request("/projects/income-forecast/reports/2026/07/20/index.html"),
      env(),
      dependencies({ fetchPublic }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("public html");
    expect(fetchPublic).toHaveBeenCalledTimes(1);
  });

  it("redirects anonymous users away from a private report", async () => {
    const response = await handleReportRequest(
      request("/projects/income-forecast/reports/2026/07/24/index.html"),
      env(),
      dependencies(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/projects/income-forecast/?next=%2Fprojects%2Fincome-forecast%2Freports%2F2026%2F07%2F24%2Findex.html",
    );
  });

  it("streams a private object with private no-store caching", async () => {
    const downloadObject = vi.fn(async () => ({
      kind: "ok" as const,
      data: new Blob(["private html"]),
    }));
    const response = await handleReportRequest(
      request("/projects/income-forecast/reports/2026/07/24/index.html"),
      env(),
      dependencies({
        getSession: async () => session(),
        downloadObject,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("private html");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(downloadObject).toHaveBeenCalledWith(
      expect.objectContaining({ date: "20260724" }),
      "index.html",
    );
  });

  it("forwards refreshed session cookies on authenticated private responses", async () => {
    const response = await handleReportRequest(
      request("/projects/income-forecast/reports/2026/07/24/index.html"),
      env(),
      dependencies({
        getSession: async () =>
          session({
            applyCookies: (headers) => headers.append("Set-Cookie", "if_access=rotated"),
          }),
      }),
    );

    expect(response.headers.get("Set-Cookie")).toBe("if_access=rotated");
  });

  it("does not fall back to a public same-name asset when private storage misses", async () => {
    const fetchPublic = vi.fn(async () => new Response("leak"));
    const response = await handleReportRequest(
      request("/projects/income-forecast/reports/2026/07/24/index.html"),
      env(),
      dependencies({
        getSession: async () => session(),
        fetchPublic,
        downloadObject: async (): Promise<DownloadedReportObject> => ({
          kind: "not_found",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(fetchPublic).not.toHaveBeenCalled();
  });

  it("generates a visible archive manifest instead of returning the stored file", async () => {
    const downloadObject = vi.fn(async () => ({
      kind: "ok" as const,
      data: new Blob(["stored manifest should not be used"]),
    }));
    const response = await handleReportRequest(
      request(
        "/projects/income-forecast/reports/2026/07/24/assets/archive-manifest.js",
      ),
      env(),
      dependencies({
        getSession: async () => session(),
        downloadObject,
      }),
    );

    expect(response.status).toBe(200);
    const manifest = await response.text();
    expect(manifest).toContain("window.INCOME_FORECAST_ARCHIVE");
    expect(manifest).not.toContain("stored manifest");
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("returns maintenance without serving private content when Supabase is unavailable", async () => {
    const fetchPublic = vi.fn(async () => new Response("leak"));
    const response = await handleReportRequest(
      request("/projects/income-forecast/reports/2026/07/24/index.html"),
      env(),
      dependencies({
        getSession: async () => session(),
        getOnlineReport: async () => {
          throw new Error("database unavailable");
        },
        fetchPublic,
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "报告服务暂不可用" });
    expect(fetchPublic).not.toHaveBeenCalled();
  });
});

describe("Cloudflare report routing", () => {
  it("only invokes Functions for API/private report paths", async () => {
    const routes = await import("../public/_routes.json");
    expect(routes.default).toEqual({
      version: 1,
      include: [
        "/projects/income-forecast/api/*",
        "/projects/income-forecast/reports/*",
      ],
      exclude: [
        "/projects/income-forecast/reports/2026/07/20/*",
        "/projects/income-forecast/reports/2026/07/25/*",
      ],
    });
  });
});
