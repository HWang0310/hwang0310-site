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
const MAX_METADATA_NODES = 512;
const MAX_METADATA_STRING_LENGTH = 2_000;
const MAX_METADATA_BYTES = 8_192;

type MetadataBudget = {
  remainingNodes: number;
  remainingBytes: number;
};

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

function invalidMetadata(): never {
  throw new HttpError(400, "审计信息无效");
}

function consumeNode(budget: MetadataBudget): void {
  budget.remainingNodes -= 1;
  if (budget.remainingNodes < 0) invalidMetadata();
}

function consumeBytes(budget: MetadataBudget, byteLength: number): void {
  budget.remainingBytes -= byteLength;
  if (budget.remainingBytes < 0) invalidMetadata();
}

function jsonByteLength(value: string | number | boolean | null): number {
  const serialized = JSON.stringify(value);
  return new TextEncoder().encode(serialized).byteLength;
}

function cleanChargedMetadataValue(
  value: unknown,
  depth: number,
  budget: MetadataBudget,
): Json {
  if (depth > MAX_METADATA_DEPTH) {
    invalidMetadata();
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    consumeBytes(budget, jsonByteLength(value));
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_METADATA_STRING_LENGTH) {
      invalidMetadata();
    }
    consumeBytes(budget, jsonByteLength(value));
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ENTRIES) {
      invalidMetadata();
    }
    consumeBytes(budget, 2 + Math.max(0, value.length - 1));
    const cleaned: Json[] = [];
    for (let index = 0; index < value.length; index += 1) {
      consumeNode(budget);
      if (!Object.hasOwn(value, index)) invalidMetadata();
      cleaned.push(cleanChargedMetadataValue(value[index], depth + 1, budget));
    }
    return cleaned;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    invalidMetadata();
  }

  const keys = Object.keys(value);
  if (keys.length > MAX_METADATA_ENTRIES) {
    invalidMetadata();
  }
  consumeBytes(budget, 2 + Math.max(0, keys.length - 1));
  const cleaned: AuditMetadata = {};
  for (const key of keys) {
    if (SENSITIVE_KEY.test(key)) {
      throw new HttpError(400, "审计信息包含敏感字段");
    }
    if (
      key.length === 0 ||
      key.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(key)
    ) {
      invalidMetadata();
    }
    consumeBytes(budget, jsonByteLength(key) + 1);
    consumeNode(budget);
    const entry = Reflect.get(value, key);
    Object.defineProperty(cleaned, key, {
      configurable: true,
      enumerable: true,
      value: cleanChargedMetadataValue(entry, depth + 1, budget),
      writable: true,
    });
  }
  return cleaned;
}

function cleanMetadata(
  value: unknown,
  requestId: string | null,
): AuditMetadata {
  const budget: MetadataBudget = {
    remainingNodes: MAX_METADATA_NODES,
    remainingBytes: MAX_METADATA_BYTES,
  };
  consumeNode(budget);
  const cleaned = cleanChargedMetadataValue(value ?? {}, 0, budget);
  if (Array.isArray(cleaned) || cleaned === null || typeof cleaned !== "object") {
    invalidMetadata();
  }

  if (requestId !== null) {
    if (Object.hasOwn(cleaned, "requestId")) invalidMetadata();
    consumeNode(budget);
    consumeBytes(
      budget,
      (Object.keys(cleaned).length === 0 ? 0 : 1) +
        jsonByteLength("requestId") +
        1 +
        jsonByteLength(requestId),
    );
    Object.defineProperty(cleaned, "requestId", {
      configurable: true,
      enumerable: true,
      value: requestId,
      writable: true,
    });
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

  const metadata = cleanMetadata(event.metadata, requestId);

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
