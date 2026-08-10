import type { AuditEventInput } from "../../../../../_lib/audit";
import { type Env, requireEnv } from "../../../../../_lib/env";
import {
  adminErrorResponse,
  adminReportView,
  ensureAdmin,
  isProtectedReportDate,
  normalizeReportDate,
  readAdminJson,
  type AdminReportRecord,
} from "../../../../../_lib/admin";
import { HttpError, json, requireSameOrigin } from "../../../../../_lib/http";
import { getSession, type SessionUser } from "../../../../../_lib/session";
import {
  createAdminReportDependencies,
  handleAdminReportsRequest,
  type AdminReportDependencies,
} from "../reports";

export { handleAdminReportsRequest } from "../reports";
export type { AdminReportDependencies } from "../reports";

type ReportAction =
  | Readonly<{ action: "set_pinned"; pinned: boolean }>
  | Readonly<{ action: "set_offline" }>;

function actionFromBody(body: Record<string, unknown>): ReportAction {
  if (
    body.action === "set_pinned" &&
    typeof body.pinned === "boolean" &&
    Object.keys(body).every((key) => key === "action" || key === "pinned")
  ) return { action: "set_pinned", pinned: body.pinned };
  if (body.action === "set_offline" && Object.keys(body).every((key) => key === "action")) {
    return { action: "set_offline" };
  }
  throw new HttpError(400, "请求数据无效");
}

export type AdminReportDetailDependencies = AdminReportDependencies & {
  getReport?(date: string): Promise<AdminReportRecord | null>;
};

export async function handleAdminReportRequest(
  request: Request,
  env: Env,
  dateValue: string,
  injectedDependencies?: AdminReportDetailDependencies,
): Promise<Response> {
  try {
    const config = requireEnv(env);
    requireSameOrigin(request, config.siteOrigin);
    if (request.method.toUpperCase() !== "PATCH") {
      return json({ error: "请求方法不允许" }, { status: 405, headers: { Allow: "PATCH" } });
    }
    const date = normalizeReportDate(dateValue);
    const dependencies = injectedDependencies ?? createAdminReportDependencies(env, config);
    const actor = ensureAdmin(await dependencies.requireAdmin(request));
    if (isProtectedReportDate(date)) throw new HttpError(409, "公开示例不可修改");
    const reports = await dependencies.listReports();
    const target = dependencies.getReport
      ? await dependencies.getReport(date)
      : reports.find((report) => report.reportDate === date) ?? null;
    if (target === null) throw new HttpError(404, "报告不存在");
    const action = actionFromBody(await readAdminJson(request));
    if (target.visibility !== "private") throw new HttpError(409, "仅私有报告可由管理员下线或置顶");
    let cleanedAt: string | null = target.cleanedAt;
    if (action.action === "set_pinned") {
      await dependencies.updateReport(date, { pinned: action.pinned });
    } else {
      cleanedAt = new Date().toISOString();
      try {
        await dependencies.removeReportObjects(target);
      } catch (error) {
        // Keep the failure response generic and record only a stable reason;
        // the error may contain provider paths or other implementation data.
        try {
          await dependencies.writeAudit({
            action: "admin.report.set_offline",
            actorUserId: actor.id,
            targetType: "report",
            targetId: date,
            result: false,
            metadata: { reason: "storage_cleanup_failed" },
          });
        } catch {
          // Preserve the original cleanup failure if the audit sink is down.
        }
        throw error;
      }
      await dependencies.updateReport(date, { status: "offline", cleanedAt });
    }
    const audit: AuditEventInput = {
      action: `admin.report.${action.action}`,
      actorUserId: actor.id,
      targetType: "report",
      targetId: date,
      result: true,
      metadata: action.action === "set_pinned" ? { pinned: action.pinned } : {},
    };
    await dependencies.writeAudit(audit);
    return json({ action: action.action, report: adminReportView({
      ...target,
      pinned: action.action === "set_pinned" ? action.pinned : target.pinned,
      status: action.action === "set_offline" ? "offline" : target.status,
      cleanedAt,
    }) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const date = typeof context.params.date === "string" ? context.params.date : "";
  return handleAdminReportRequest(context.request, context.env, date);
};
