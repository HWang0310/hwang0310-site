import type { AuditEventInput } from "../../../../_lib/audit";
import { writeAudit } from "../../../../_lib/audit";
import { type Env, requireEnv } from "../../../../_lib/env";
import {
  adminErrorResponse,
  adminReportView,
  ensureAdmin,
  isProtectedReportDate,
  reportFromRow,
  type AdminReportRecord,
} from "../../../../_lib/admin";
import { HttpError, json, requireSameOrigin } from "../../../../_lib/http";
import { getSession, type SessionUser } from "../../../../_lib/session";
import {
  removeReportStorageObjects,
  type ReportStorageAdapter,
} from "../../../../_lib/report-storage";
import { createServiceRoleSupabaseClient } from "../../../../_lib/supabase";

const REPORT_SELECT =
  "report_date,title,release_id,storage_prefix,visibility,pinned,status,size_bytes,file_count,published_at,cleaned_at,updated_at";

export type AdminReportDependencies = {
  requireAdmin(request: Request): Promise<SessionUser>;
  listReports(): Promise<AdminReportRecord[]>;
  getReport?(date: string): Promise<AdminReportRecord | null>;
  updateReport(date: string, patch: { pinned?: boolean; status?: "offline"; cleanedAt?: string }): Promise<void>;
  removeReportObjects(report: AdminReportRecord): Promise<void>;
  writeAudit(event: AuditEventInput): Promise<void>;
};

export function createAdminReportDependencies(
  env: Env,
  config: ReturnType<typeof requireEnv>,
): AdminReportDependencies {
  const serviceClient = createServiceRoleSupabaseClient(config);
  const storage = serviceClient.storage.from(config.supabaseStorageBucket);
  const storageAdapter: ReportStorageAdapter = {
    list: (path, options) => storage.list(path, options),
    remove: (paths) => storage.remove(paths),
  };
  return {
    async requireAdmin(request) {
      const session = await getSession(request, env);
      if (session === null) throw new HttpError(401, "请先登录");
      return ensureAdmin(session);
    },
    async listReports() {
      try {
        const response = await serviceClient
          .from("reports")
          .select(REPORT_SELECT)
          .order("report_date", { ascending: false });
        if (response.error !== null) throw new Error("report list failed");
        return response.data.map(reportFromRow);
      } catch {
        throw new HttpError(503, "管理服务暂不可用");
      }
    },
    async getReport(date) {
      try {
        const response = await serviceClient
          .from("reports")
          .select(REPORT_SELECT)
          .eq("report_date", `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`)
          .maybeSingle();
        if (response.error !== null) throw new Error("report lookup failed");
        return response.data === null ? null : reportFromRow(response.data);
      } catch {
        throw new HttpError(503, "管理服务暂不可用");
      }
    },
    async updateReport(date, patch) {
      try {
        const dbPatch = patch.pinned !== undefined
          ? { pinned: patch.pinned }
          : patch.status !== undefined
            ? { status: patch.status, ...(patch.cleanedAt === undefined ? {} : { cleaned_at: patch.cleanedAt }) }
            : { cleaned_at: patch.cleanedAt ?? new Date().toISOString() };
        const response = await serviceClient
          .from("reports")
          .update(dbPatch)
          .eq("report_date", `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`)
          .select("report_date")
          .maybeSingle();
        if (response.error !== null || response.data === null) throw new Error("report update failed");
      } catch {
        throw new HttpError(503, "管理服务暂不可用");
      }
    },
    async removeReportObjects(report) {
      await removeReportStorageObjects(report, storageAdapter);
    },
    writeAudit: (event) => writeAudit(env, event),
  };
}

function capacity(reports: readonly AdminReportRecord[]) {
  const online = reports.filter((report) => report.status === "online");
  const privateOnline = online.filter((report) => report.visibility === "private");
  const evictable = privateOnline
    .filter((report) => !report.pinned)
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate));
  const cleanupDates = reports
    .map((report) => report.cleanedAt)
    .filter((value): value is string => value !== null)
    .sort();
  return {
    privateUsedBytes: privateOnline.reduce((total, report) => total + report.sizeBytes, 0),
    onlineTotalBytes: online.reduce((total, report) => total + report.sizeBytes, 0),
    softLimitBytes: 850 * 1024 * 1024,
    freeTierReferenceBytes: 1_000_000_000,
    nextEvictionDate: privateOnline.reduce((total, report) => total + report.sizeBytes, 0) > 850 * 1024 * 1024
      ? evictable[0]?.reportDate ?? null
      : null,
    lastCleanup: cleanupDates.at(-1) ?? null,
  };
}

export async function handleAdminReportsRequest(
  request: Request,
  env: Env,
  injectedDependencies?: AdminReportDependencies,
): Promise<Response> {
  try {
    const config = requireEnv(env);
    requireSameOrigin(request, config.siteOrigin);
    if (request.method.toUpperCase() !== "GET") {
      return json({ error: "请求方法不允许" }, { status: 405, headers: { Allow: "GET" } });
    }
    const dependencies = injectedDependencies ?? createAdminReportDependencies(env, config);
    ensureAdmin(await dependencies.requireAdmin(request));
    const reports = await dependencies.listReports();
    return json({ ...capacity(reports), reports: reports.map(adminReportView) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) =>
  handleAdminReportsRequest(context.request, context.env);
