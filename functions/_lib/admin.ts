import type { AppRole, ReportVisibility } from "../../shared/income-forecast/contracts";
import { PUBLIC_REPORT_DATES } from "../../shared/income-forecast/contracts";
import { HttpError } from "./http";
import type { ProfileRecord, SessionUser } from "./session";

export type AdminProfile = ProfileRecord & Readonly<{
  updatedAt: string | null;
}>;

export type AdminReportRecord = Readonly<{
  reportDate: string;
  title: string;
  releaseId: string | null;
  storagePrefix: string | null;
  visibility: ReportVisibility;
  pinned: boolean;
  status: "staging" | "online" | "offline";
  sizeBytes: number;
  fileCount: number;
  publishedAt: string | null;
  cleanedAt: string | null;
  updatedAt: string | null;
}>;

export const ADMIN_PATH = "/projects/income-forecast/admin/";
export const RECOVERY_REDIRECT =
  "https://hwang0310.dpdns.org/projects/income-forecast/reset-password/";
export const SOFT_LIMIT_BYTES = 850 * 1024 * 1024;
export const FREE_TIER_REFERENCE_BYTES = 1_000_000_000;

const PROTECTED_DATE_SET: ReadonlySet<string> = new Set(PUBLIC_REPORT_DATES);
const ADMIN_ROLES: ReadonlySet<AppRole> = new Set(["admin", "root_admin"]);
const BODY_LIMIT_BYTES = 16_384;

export function isAdminRole(role: unknown): role is "admin" | "root_admin" {
  return typeof role === "string" && ADMIN_ROLES.has(role as AppRole);
}

export function ensureAdmin(session: SessionUser): SessionUser {
  if (!isAdminRole(session.role)) throw new HttpError(403, "无管理员权限");
  return session;
}

export function isProtectedReportDate(value: string): boolean {
  return PROTECTED_DATE_SET.has(value.replaceAll("-", ""));
}

export function normalizeReportDate(value: string): string {
  const date = value.replaceAll("-", "");
  if (!/^\d{8}$/u.test(date)) throw new HttpError(400, "报告日期无效");
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) throw new HttpError(400, "报告日期无效");
  return date;
}

export function maskPhone(value: string): string {
  if (!/^1\d{10}$/u.test(value)) return "***";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export function maskEmployeeNo(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(1, value.length - 4))}${value.slice(-4)}`;
}

export function maskEmailForAdmin(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visibleStart = local.slice(0, Math.min(2, local.length));
  return `${visibleStart}***@${domain}`;
}

export type AdminUserView = Readonly<{
  id: string;
  fullName: string;
  employeeNo: string;
  phone: string;
  email: string;
  role: AppRole;
  active: boolean;
  isActive: boolean;
  usesInitialPassword: boolean;
  mustChangePassword: boolean;
  updatedAt: string | null;
}>;

export function adminUserView(profile: AdminProfile): AdminUserView {
  return {
    id: profile.userId,
    fullName: profile.fullName,
    employeeNo: maskEmployeeNo(profile.employeeNo),
    phone: maskPhone(profile.phone),
    email: maskEmailForAdmin(profile.email),
    role: profile.role,
    active: profile.isActive,
    isActive: profile.isActive,
    usesInitialPassword: profile.usesInitialPassword,
    mustChangePassword: profile.mustChangePassword,
    updatedAt: profile.updatedAt,
  };
}

export function profileFromRow(row: {
  user_id: string;
  full_name: string;
  employee_no: string;
  phone: string;
  email: string;
  role: AppRole;
  is_active: boolean;
  uses_initial_password: boolean;
  must_change_password: boolean;
  updated_at?: string | null;
}): AdminProfile {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    employeeNo: row.employee_no,
    phone: row.phone,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    usesInitialPassword: row.uses_initial_password,
    mustChangePassword: row.must_change_password,
    updatedAt: row.updated_at ?? null,
  };
}

export function reportFromRow(row: {
  report_date: string;
  title: string;
  release_id: string | null;
  storage_prefix: string | null;
  visibility: ReportVisibility;
  pinned: boolean;
  status: "staging" | "online" | "offline";
  size_bytes: number;
  file_count: number;
  published_at: string | null;
  cleaned_at: string | null;
  updated_at?: string | null;
}): AdminReportRecord {
  return {
    reportDate: row.report_date.replaceAll("-", ""),
    title: row.title,
    releaseId: row.release_id,
    storagePrefix: row.storage_prefix,
    visibility: row.visibility,
    pinned: row.pinned,
    status: row.status,
    sizeBytes: Number.isSafeInteger(row.size_bytes) ? row.size_bytes : 0,
    fileCount: Number.isSafeInteger(row.file_count) ? row.file_count : 0,
    publishedAt: row.published_at,
    cleanedAt: row.cleaned_at,
    updatedAt: row.updated_at ?? null,
  };
}

export type AdminReportView = Readonly<{
  date: string;
  title: string;
  visibility: ReportVisibility;
  pinned: boolean;
  status: AdminReportRecord["status"];
  sizeBytes: number;
  fileCount: number;
  online: boolean;
  publishedAt: string | null;
  cleanedAt: string | null;
  updatedAt: string | null;
}>;

export function adminReportView(report: AdminReportRecord): AdminReportView {
  return {
    date: report.reportDate,
    title: report.title,
    visibility: report.visibility,
    pinned: isProtectedReportDate(report.reportDate) ? true : report.pinned,
    status: report.status,
    sizeBytes: report.sizeBytes,
    fileCount: report.fileCount,
    online: report.status === "online",
    publishedAt: report.publishedAt,
    cleanedAt: report.cleanedAt,
    updatedAt: report.updatedAt,
  };
}

export async function readAdminJson(request: Request): Promise<Record<string, unknown>> {
  if (request.body === null) throw new HttpError(400, "请求数据无效");
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new HttpError(400, "请求数据无效");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > BODY_LIMIT_BYTES)) {
    throw new HttpError(400, "请求数据无效");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > BODY_LIMIT_BYTES) {
      await reader.cancel();
      throw new HttpError(400, "请求数据无效");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, "请求数据无效");
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) throw new HttpError(400, "请求数据无效");
  return parsed as Record<string, unknown>;
}

export function adminErrorResponse(error: unknown, headers?: Headers): Response {
  const status = error instanceof HttpError
    ? error.status
    : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : 503;
  const message = error instanceof HttpError
    ? error.message
    : status === 403
      ? "无管理员权限"
      : status === 404
        ? "记录不存在"
        : status === 409
          ? "该记录受保护，无法修改"
          : status === 400
            ? "请求数据无效"
            : "管理服务暂不可用";
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...Object.fromEntries(responseHeaders.entries()),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function isSensitiveKey(key: string): boolean {
  return /(?:password|passwd|hash|token|jwt|cookie|secret|authorization)/iu.test(key);
}

export function sanitizeAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[已隐藏]";
  if (value === null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "string" && /^(?:eyJ|[A-Fa-f0-9]{32,})/u.test(value)) return "[已隐藏]";
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditMetadata(item, depth + 1));
  if (typeof value !== "object") return null;
  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    cleaned[key] = sanitizeAuditMetadata(child, depth + 1);
  }
  return cleaned;
}
