import type { AppRole } from "../../shared/income-forecast/contracts";
import { HttpError, json } from "./http";
import {
  appendSessionCookies,
  buildSessionCookieHeaders,
  clearSessionCookieHeaders,
  type RefreshedSession,
} from "./session";

const MAX_PASSWORD_BODY_BYTES = 4_096;
const MAX_CURRENT_PASSWORD_BYTES = 1_024;
const APP_ROLES: ReadonlySet<string> = new Set(["user", "admin", "root_admin"]);

function invalidRequest(): never {
  throw new HttpError(400, "请求数据无效");
}

export async function readPasswordJson(
  request: Request,
  allowedKeys: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json" || request.body === null) {
    invalidRequest();
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const byteLength = Number(declaredLength);
    if (
      !Number.isInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > MAX_PASSWORD_BODY_BYTES
    ) {
      invalidRequest();
    }
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > MAX_PASSWORD_BODY_BYTES) {
      await reader.cancel();
      invalidRequest();
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalidRequest();
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalidRequest();
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    invalidRequest();
  }
  return record;
}

export function newPassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "新密码须为 8–72 个 UTF-8 字节");
  }
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength < 8 || byteLength > 72) {
    throw new HttpError(400, "新密码须为 8–72 个 UTF-8 字节");
  }
  return value;
}

export function currentPassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(401, "当前密码错误");
  }
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength === 0 || byteLength > MAX_CURRENT_PASSWORD_BYTES) {
    throw new HttpError(401, "当前密码错误");
  }
  return value;
}

export function recoveryTokenHash(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 1_024 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new HttpError(400, "重置链接无效或已过期");
  }
  return value;
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.has(value);
}

export function errorResponse(error: unknown, headers?: Headers): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, { status: error.status, headers });
  }
  return json({ error: "密码服务暂不可用" }, { status: 503, headers });
}

export function sessionResponse(tokens: RefreshedSession): Response {
  const headers = new Headers();
  appendSessionCookies(headers, buildSessionCookieHeaders(tokens));
  return json({ ok: true }, { headers });
}

export function clearedCookieHeaders(): Headers {
  const headers = new Headers();
  appendSessionCookies(headers, clearSessionCookieHeaders());
  return headers;
}
