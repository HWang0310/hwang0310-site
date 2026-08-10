import type { Env } from "../../../../_lib/env";
import { type AuditEventInput, writeAudit } from "../../../../_lib/audit";
import { type SessionUser, getSession } from "../../../../_lib/session";
import { createServiceRoleSupabaseClient } from "../../../../_lib/supabase";
import {
  adminErrorResponse,
  ensureAdmin,
  sanitizeAuditMetadata,
} from "../../../../_lib/admin";
import { HttpError, json, requireSameOrigin } from "../../../../_lib/http";
import { requireEnv } from "../../../../_lib/env";

export type AdminAuditEvent = Readonly<{
  id: number;
  eventType: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  success: boolean;
  metadata: unknown;
  createdAt: string;
}>;

export type AdminAuditPage = Readonly<{
  events: AdminAuditEvent[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage: number | null;
}>;

export type AdminAuditQuery = Readonly<{
  page: number;
  pageSize: number;
  eventType?: string;
  actorUserId?: string;
  success?: boolean;
}>;

export type AdminAuditDependencies = {
  requireAdmin(request: Request): Promise<SessionUser>;
  listAudit(query: AdminAuditQuery): Promise<AdminAuditPage>;
};

function parsePositive(value: string | null, fallback: number, max: number): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/u.test(value)) throw new HttpError(400, "分页参数无效");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new HttpError(400, "分页参数无效");
  return number;
}

function parseAuditQuery(request: Request): AdminAuditQuery {
  const url = new URL(request.url);
  const allowed = new Set(["page", "pageSize", "eventType", "actorUserId", "success"]);
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new HttpError(400, "筛选参数无效");
  const page = parsePositive(url.searchParams.get("page"), 1, 10_000);
  const pageSize = parsePositive(url.searchParams.get("pageSize"), 50, 100);
  const eventType = url.searchParams.get("eventType") ?? undefined;
  if (eventType !== undefined && (eventType.length === 0 || eventType.length > 100 || /[\u0000-\u001f\u007f]/u.test(eventType))) {
    throw new HttpError(400, "筛选参数无效");
  }
  const actorUserId = url.searchParams.get("actorUserId") ?? undefined;
  if (actorUserId !== undefined && !/^[A-Za-z0-9_-]{1,120}$/u.test(actorUserId)) throw new HttpError(400, "筛选参数无效");
  const successText = url.searchParams.get("success");
  const success = successText === null ? undefined : successText === "true" ? true : successText === "false" ? false : undefined;
  if (successText !== null && success === undefined) throw new HttpError(400, "筛选参数无效");
  return { page, pageSize, ...(eventType === undefined ? {} : { eventType }), ...(actorUserId === undefined ? {} : { actorUserId }), ...(success === undefined ? {} : { success }) };
}

function defaultDependencies(env: Env, config: ReturnType<typeof requireEnv>): AdminAuditDependencies {
  const serviceClient = createServiceRoleSupabaseClient(config);
  return {
    async requireAdmin(request) {
      const session = await getSession(request, env);
      if (session === null) throw new HttpError(401, "请先登录");
      return ensureAdmin(session);
    },
    async listAudit(query) {
      try {
        const offset = (query.page - 1) * query.pageSize;
        let builder = (serviceClient as any)
          .from("audit_events")
          .select("id,event_type,actor_user_id,target_type,target_id,success,metadata,created_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + query.pageSize);
        if (query.eventType !== undefined) builder = builder.eq("event_type", query.eventType);
        if (query.actorUserId !== undefined) builder = builder.eq("actor_user_id", query.actorUserId);
        if (query.success !== undefined) builder = builder.eq("success", query.success);
        const response = await builder;
        if (response.error !== null) throw new Error("audit list failed");
        const rows = Array.isArray(response.data) ? response.data : [];
        const events = rows.slice(0, query.pageSize).map((row: any) => ({
          id: Number(row.id),
          eventType: String(row.event_type),
          actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
          targetType: typeof row.target_type === "string" ? row.target_type : null,
          targetId: typeof row.target_id === "string" ? row.target_id : null,
          success: row.success === true,
          metadata: sanitizeAuditMetadata(row.metadata),
          createdAt: String(row.created_at),
        }));
        const count = typeof response.count === "number" ? response.count : offset + rows.length;
        const hasMore = offset + rows.length < count;
        return { events, page: query.page, pageSize: query.pageSize, hasMore, nextPage: hasMore ? query.page + 1 : null };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, "审计服务暂不可用");
      }
    },
  };
}

export async function handleAdminAuditRequest(
  request: Request,
  env: Env,
  injectedDependencies?: AdminAuditDependencies,
): Promise<Response> {
  try {
    const config = requireEnv(env);
    requireSameOrigin(request, config.siteOrigin);
    if (request.method.toUpperCase() !== "GET") return json({ error: "请求方法不允许" }, { status: 405, headers: { Allow: "GET" } });
    const dependencies = injectedDependencies ?? defaultDependencies(env, config);
    ensureAdmin(await dependencies.requireAdmin(request));
    const result = await dependencies.listAudit(parseAuditQuery(request));
    return json({
      ...result,
      events: result.events.map((event) => ({
        ...event,
        metadata: sanitizeAuditMetadata(event.metadata),
      })),
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) =>
  handleAdminAuditRequest(context.request, context.env);
