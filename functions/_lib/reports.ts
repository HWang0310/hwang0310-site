import type {
  ReportSummary,
  ReportVisibility,
} from "../../shared/income-forecast/contracts";
import { PUBLIC_REPORT_DATES } from "../../shared/income-forecast/contracts";
import { type Env, requireEnv } from "./env";
import { HttpError, json } from "./http";
import {
  getSession,
  type SessionUser,
} from "./session";
import { createServiceRoleSupabaseClient } from "./supabase";

const REPORT_ROOT = "/projects/income-forecast/reports/";
const REPORT_PATH_MAX_BYTES = 8_192;
const OBJECT_PATH_MAX_BYTES = 2_048;
const DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/u;
const PUBLIC_DATE_SET: ReadonlySet<string> = new Set(PUBLIC_REPORT_DATES);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type ReportStatus = "staging" | "online" | "offline";

export type ReportRecord = Readonly<{
  date: string;
  title: string;
  releaseId: string | null;
  storagePrefix: string | null;
  visibility: ReportVisibility;
  pinned: boolean;
  status: ReportStatus;
  sizeBytes: number;
  fileCount: number;
  publishedAt: string | null;
}>;

export type DownloadedReportObject =
  | Readonly<{ kind: "ok"; data: Blob }>
  | Readonly<{ kind: "not_found" }>;

export type ReportDependencies = {
  getSession(request: Request): Promise<SessionUser | null>;
  listOnlineReports(): Promise<ReportRecord[]>;
  getOnlineReport(date: string): Promise<ReportRecord | null>;
  downloadObject(
    report: ReportRecord,
    objectPath: string,
  ): Promise<DownloadedReportObject>;
  fetchPublic(request: Request): Promise<Response>;
};

export type ParsedReportObjectPath = Readonly<{
  date: string;
  objectPath: string;
}>;

function invalidReportPath(): never {
  throw new HttpError(400, "报告路径无效");
}

function unavailable(): never {
  throw new HttpError(503, "报告服务暂不可用");
}

function validDate(date: string): boolean {
  const match = DATE_PATTERN.exec(date);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function decodePath(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      invalidReportPath();
    }
    if (next === decoded) break;
    decoded = next;
  }

  // A further encoded traversal after the bounded decode is still unsafe.
  if (/%(?:25|2e|2f|5c|00)/iu.test(decoded)) invalidReportPath();
  return decoded;
}

function ensureSafePathPart(value: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalidReportPath();
  }
}

/**
 * Parse a full income-forecast report URL pathname. The path is decoded a
 * bounded number of times so `%252e%252e` cannot be used as a second-pass
 * traversal. Storage keys are never resolved through the local filesystem.
 */
export function parseReportObjectPath(pathname: string): ParsedReportObjectPath {
  if (
    typeof pathname !== "string" ||
    pathname.length === 0 ||
    new TextEncoder().encode(pathname).byteLength > REPORT_PATH_MAX_BYTES ||
    !pathname.startsWith(REPORT_ROOT)
  ) {
    invalidReportPath();
  }

  const decodedTail = decodePath(pathname.slice(REPORT_ROOT.length));
  const parts = decodedTail.split("/");
  if (parts.length < 3) invalidReportPath();
  const date = `${parts[0]}${parts[1]}${parts[2]}`;
  if (
    parts[0].length !== 4 ||
    parts[1].length !== 2 ||
    parts[2].length !== 2 ||
    !validDate(date)
  ) {
    invalidReportPath();
  }

  let objectParts = parts.slice(3);
  if (objectParts.at(-1) === "") objectParts = objectParts.slice(0, -1);
  if (objectParts.length === 0) objectParts = ["index.html"];
  objectParts.forEach(ensureSafePathPart);

  const objectPath = objectParts.join("/");
  if (
    new TextEncoder().encode(objectPath).byteLength > OBJECT_PATH_MAX_BYTES ||
    objectPath.includes("//")
  ) {
    invalidReportPath();
  }
  return { date, objectPath };
}

export function reportWebPath(date: string): string {
  if (!/^\d{8}$/u.test(date) || !validDate(date)) invalidReportPath();
  return `${REPORT_ROOT}${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}/`;
}

export function isPublicReportDate(date: string): boolean {
  return PUBLIC_DATE_SET.has(date);
}

export function contentTypeForReportObject(objectPath: string): string {
  const dot = objectPath.lastIndexOf(".");
  const extension = dot < 0 ? "" : objectPath.slice(dot).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

function publicReportSummary(date: (typeof PUBLIC_REPORT_DATES)[number]): ReportSummary {
  return {
    date,
    webPath: reportWebPath(date),
    visibility: "public",
    pinned: true,
    sizeBytes: 0,
    online: true,
  };
}

export function publicReportSummaries(): ReportSummary[] {
  return PUBLIC_REPORT_DATES.map(publicReportSummary);
}

function dateFromDatabaseValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.replaceAll("-", "");
  return /^\d{8}$/u.test(date) && validDate(date) ? date : null;
}

export function reportSummary(record: ReportRecord): ReportSummary | null {
  const date = dateFromDatabaseValue(record.date);
  if (date === null || record.status !== "online") return null;
  const isPublic = isPublicReportDate(date);
  return {
    date,
    webPath: reportWebPath(date),
    visibility: isPublic ? "public" : record.visibility,
    pinned: isPublic ? true : record.pinned,
    sizeBytes: Number.isSafeInteger(record.sizeBytes) ? record.sizeBytes : 0,
    online: true,
  };
}

export function visibleReportSummaries(records: readonly ReportRecord[]): ReportSummary[] {
  const byDate = new Map<string, ReportSummary>();
  for (const summary of publicReportSummaries()) byDate.set(summary.date, summary);
  for (const record of records) {
    const summary = reportSummary(record);
    if (summary !== null) byDate.set(summary.date, summary);
  }
  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

export function archiveManifestText(records: readonly ReportRecord[]): string {
  const manifest = visibleReportSummaries(records).map(({ date, webPath }) => ({
    date,
    webPath,
  }));
  return `window.INCOME_FORECAST_ARCHIVE = ${JSON.stringify(manifest)};\n`;
}

function reportFromRow(row: {
  report_date: string;
  title: string;
  release_id: string | null;
  storage_prefix: string | null;
  visibility: ReportVisibility;
  pinned: boolean;
  status: ReportStatus;
  size_bytes: number;
  file_count: number;
  published_at: string | null;
}): ReportRecord {
  return {
    date: row.report_date,
    title: row.title,
    releaseId: row.release_id,
    storagePrefix: row.storage_prefix,
    visibility: row.visibility,
    pinned: row.pinned,
    status: row.status,
    sizeBytes: row.size_bytes,
    fileCount: row.file_count,
    publishedAt: row.published_at,
  };
}

const REPORT_SELECT =
  "report_date,title,release_id,storage_prefix,visibility,pinned,status,size_bytes,file_count,published_at";

function safeStoragePrefix(prefix: string | null, date: string): string {
  if (
    prefix === null ||
    prefix.length === 0 ||
    prefix.length > 512 ||
    prefix.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(prefix)
  ) {
    unavailable();
  }
  const expected = `reports/${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)}/`;
  if (!prefix.startsWith(expected) || !prefix.endsWith("/")) unavailable();
  const parts = prefix.split("/");
  if (
    parts.some(
      (part, index) =>
        part === "." ||
        part === ".." ||
        (index < parts.length - 1 && part.length === 0),
    )
  ) {
    unavailable();
  }
  return prefix;
}

function defaultDependencies(env: Env): ReportDependencies {
  const config = requireEnv(env);
  const serviceClient = createServiceRoleSupabaseClient(config);
  return {
    getSession: (request) => getSession(request, env),

    async listOnlineReports() {
      try {
        const response = await serviceClient
          .from("reports")
          .select(REPORT_SELECT)
          .eq("status", "online")
          .order("report_date", { ascending: true });
        if (response.error !== null) unavailable();
        return response.data.map(reportFromRow);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable();
      }
    },

    async getOnlineReport(date) {
      try {
        const response = await serviceClient
          .from("reports")
          .select(REPORT_SELECT)
          .eq("report_date", `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`)
          .eq("status", "online")
          .maybeSingle();
        if (response.error !== null) unavailable();
        return response.data === null ? null : reportFromRow(response.data);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable();
      }
    },

    async downloadObject(report, objectPath) {
      const date = dateFromDatabaseValue(report.date);
      if (date === null) unavailable();
      const prefix = safeStoragePrefix(report.storagePrefix, date);
      try {
        const response = await serviceClient.storage
          .from(config.supabaseStorageBucket)
          .download(`${prefix}${objectPath}`);
        if (response.error !== null) {
          const status =
            (response.error as { status?: number; statusCode?: number }).status ??
            (response.error as { statusCode?: number }).statusCode;
          if (
            status === 404 ||
            /(?:not found|no such object|404)/iu.test(response.error.message)
          ) {
            return { kind: "not_found" };
          }
          unavailable();
        }
        if (!(response.data instanceof Blob)) unavailable();
        return { kind: "ok", data: response.data };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable();
      }
    },

    fetchPublic: (request) => config.assets.fetch(request),
  };
}

function hasAuthCookie(request: Request): boolean {
  const cookie = request.headers.get("Cookie");
  return cookie !== null && /(?:^|;)\s*if_(?:access|refresh)=/u.test(cookie);
}

function responseForError(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
  return json({ error: "报告服务暂不可用" }, { status: 503 });
}

async function resolveDependencies(
  env: Env,
  injected: ReportDependencies | undefined,
): Promise<ReportDependencies> {
  return injected ?? defaultDependencies(env);
}

function loginRedirect(request: Request): Response {
  const pathname = new URL(request.url).pathname;
  const location = `/projects/income-forecast/?next=${encodeURIComponent(pathname)}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
    },
  });
}

function noStoreHeaders(contentType?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (contentType !== undefined) headers.set("Content-Type", contentType);
  return headers;
}

/**
 * Shared report object gateway. Public allowlisted dates are served from the
 * static Pages asset binding; every other date requires a trusted session and
 * is streamed from the private Storage bucket.
 */
export async function handleReportRequest(
  request: Request,
  env: Env,
  injectedDependencies?: ReportDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
      return json(
        { error: "请求方法不允许" },
        { status: 405, headers: { Allow: "GET, HEAD" } },
      );
    }
    const parsed = parseReportObjectPath(new URL(request.url).pathname);
    const dependencies = injectedDependencies;
    if (isPublicReportDate(parsed.date)) {
      const response = await (dependencies?.fetchPublic ?? ((input) => env.ASSETS.fetch(input)))(request);
      return response;
    }

    const resolved = await resolveDependencies(env, dependencies);
    const user = await resolved.getSession(request);
    if (user === null) return loginRedirect(request);
    if (user.mustChangePassword) {
      return json({ error: "请先完成密码设置" }, { status: 403 });
    }

    const report = await resolved.getOnlineReport(parsed.date);
    if (
      report === null ||
      report.status !== "online" ||
      report.visibility !== "private" ||
      report.storagePrefix === null
    ) {
      return json({ error: "报告不存在" }, { status: 404 });
    }

    if (parsed.objectPath === "assets/archive-manifest.js") {
      const records = await resolved.listOnlineReports();
      const body = archiveManifestText(records);
      const headers = noStoreHeaders("text/javascript; charset=utf-8");
      user.applyCookies(headers);
      return request.method.toUpperCase() === "HEAD"
        ? new Response(null, { status: 200, headers })
        : new Response(body, { status: 200, headers });
    }

    const downloaded = await resolved.downloadObject(report, parsed.objectPath);
    if (downloaded.kind === "not_found") {
      return json({ error: "报告文件不存在" }, { status: 404 });
    }
    const headers = noStoreHeaders(contentTypeForReportObject(parsed.objectPath));
    user.applyCookies(headers);
    return request.method.toUpperCase() === "HEAD"
      ? new Response(null, { status: 200, headers })
      : new Response(downloaded.data, { status: 200, headers });
  } catch (error) {
    return responseForError(error);
  }
}

/** Returns the public or authenticated report archive for the entry page. */
export async function handleReportListRequest(
  request: Request,
  env: Env,
  injectedDependencies?: ReportDependencies,
): Promise<Response> {
  try {
    if (request.method.toUpperCase() !== "GET") {
      return json(
        { error: "请求方法不允许" },
        { status: 405, headers: { Allow: "GET" } },
      );
    }

    // The public archive must remain usable if Supabase is paused or
    // misconfigured. Only a request carrying an auth cookie needs Supabase.
    if (!hasAuthCookie(request) && injectedDependencies === undefined) {
      return json({ reports: publicReportSummaries() });
    }

    const resolved = await resolveDependencies(env, injectedDependencies);
    const user = await resolved.getSession(request);
    if (user === null) return json({ reports: publicReportSummaries() });
    if (user.mustChangePassword) {
      return json({ error: "请先完成密码设置" }, { status: 403 });
    }
    const reports = await resolved.listOnlineReports();
    const headers = new Headers();
    user.applyCookies(headers);
    return json(
      { reports: visibleReportSummaries(reports) },
      { headers },
    );
  } catch (error) {
    return responseForError(error);
  }
}
