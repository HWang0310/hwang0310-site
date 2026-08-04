import { type Env, requireEnv } from "./env";
import { HttpError } from "./http";
import {
  createServiceRoleSupabaseClient,
  type Json,
} from "./supabase";

const ALLOWED_EVENT_KEYS = new Set([
  "action",
  "actorUserId",
  "targetType",
  "targetId",
  "result",
  "requestId",
  "metadata",
]);
const SENSITIVE_KEY = /(password|token|cookie|secret)/iu;
const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_ENTRIES = 100;
const MAX_METADATA_STRING_LENGTH = 2_000;
const MAX_METADATA_BYTES = 8_192;

export type AuditMetadata = { [key: string]: Json | undefined };

export type AuditEventInput = {
  action: string;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  result: boolean;
  requestId?: string;
  metadata?: unknown;
};

export type AuditInsert = {
  event_type: string;
  actor_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  success: boolean;
  metadata: AuditMetadata;
};

export type AuditDependencies = {
  insertAudit(record: AuditInsert): Promise<void>;
};

function cleanText(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, "审计信息无效");
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "审计信息无效");
  }
  const cleaned = value.trim();
  if (
    cleaned.length === 0 ||
    cleaned.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(cleaned)
  ) {
    throw new HttpError(400, "审计信息无效");
  }
  return cleaned;
}

function cleanMetadataValue(value: unknown, depth: number): Json {
  if (depth > MAX_METADATA_DEPTH) {
    throw new HttpError(400, "审计信息无效");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_METADATA_STRING_LENGTH) {
      throw new HttpError(400, "审计信息无效");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ENTRIES) {
      throw new HttpError(400, "审计信息无效");
    }
    return value.map((entry) => cleanMetadataValue(entry, depth + 1));
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new HttpError(400, "审计信息无效");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_ENTRIES) {
    throw new HttpError(400, "审计信息无效");
  }
  const cleaned: AuditMetadata = {};
  for (const [key, entry] of entries) {
    if (SENSITIVE_KEY.test(key)) {
      throw new HttpError(400, "审计信息包含敏感字段");
    }
    if (
      key.length === 0 ||
      key.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(key)
    ) {
      throw new HttpError(400, "审计信息无效");
    }
    cleaned[key] = cleanMetadataValue(entry, depth + 1);
  }
  return cleaned;
}

function cleanMetadata(value: unknown): AuditMetadata {
  const cleaned = cleanMetadataValue(value ?? {}, 0);
  if (Array.isArray(cleaned) || cleaned === null || typeof cleaned !== "object") {
    throw new HttpError(400, "审计信息无效");
  }
  if (new TextEncoder().encode(JSON.stringify(cleaned)).byteLength > MAX_METADATA_BYTES) {
    throw new HttpError(400, "审计信息无效");
  }
  return cleaned;
}

function defaultAuditDependencies(env: Env): AuditDependencies {
  const client = createServiceRoleSupabaseClient(requireEnv(env));
  return {
    async insertAudit(record) {
      const { error } = await client.from("audit_events").insert(record);
      if (error !== null) throw new Error("audit insert failed");
    },
  };
}

export async function writeAudit(
  env: Env,
  event: AuditEventInput,
  dependencies?: AuditDependencies,
): Promise<void> {
  requireEnv(env);
  if (
    event === null ||
    typeof event !== "object" ||
    Object.keys(event).some((key) => !ALLOWED_EVENT_KEYS.has(key))
  ) {
    throw new HttpError(400, "审计信息无效");
  }

  const action = cleanText(event.action, true);
  const actorUserId = cleanText(event.actorUserId, false);
  const targetType = cleanText(event.targetType, false);
  const targetId = cleanText(event.targetId, false);
  const requestId = cleanText(event.requestId, false);
  if (typeof event.result !== "boolean" || action === null) {
    throw new HttpError(400, "审计信息无效");
  }

  const metadata = cleanMetadata(event.metadata);
  if (requestId !== null) metadata.requestId = requestId;
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > MAX_METADATA_BYTES) {
    throw new HttpError(400, "审计信息无效");
  }

  const record: AuditInsert = {
    event_type: action,
    actor_user_id: actorUserId,
    target_type: targetType,
    target_id: targetId,
    success: event.result,
    metadata,
  };

  try {
    await (dependencies ?? defaultAuditDependencies(env)).insertAudit(record);
  } catch {
    throw new HttpError(503, "审计服务暂不可用");
  }
}
