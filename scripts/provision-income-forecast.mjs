import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const PRIVATE_REPORT_BUCKET = "income-forecast-reports";
export const REPORT_FILE_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;
export const ALLOWED_REPORT_MIME_TYPES = Object.freeze([
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "font/woff",
  "font/woff2",
]);

const BUCKET_POLICY = Object.freeze({
  public: false,
  fileSizeLimit: REPORT_FILE_SIZE_LIMIT_BYTES,
  allowedMimeTypes: ALLOWED_REPORT_MIME_TYPES,
});

function serviceError(message) {
  const error = new Error(message);
  error.name = "IncomeForecastProvisionError";
  return error;
}

function hasSameMimePolicy(value) {
  if (!Array.isArray(value)) return false;
  return value.length === ALLOWED_REPORT_MIME_TYPES.length &&
    ALLOWED_REPORT_MIME_TYPES.every((mime) => value.includes(mime));
}

function hasSameFileLimit(value) {
  return Number(value) === REPORT_FILE_SIZE_LIMIT_BYTES;
}

/**
 * Idempotently provisions the private report bucket through Storage API.
 * Existing public buckets are never changed automatically.
 */
export async function provisionIncomeForecast(client) {
  if (client === null || typeof client !== "object" || client.storage === undefined) {
    throw serviceError("Storage 客户端不可用");
  }
  const listed = await client.storage.listBuckets();
  if (listed?.error !== null) throw serviceError("无法检查报告存储桶");
  const buckets = Array.isArray(listed?.data) ? listed.data : [];
  const existing = buckets.find((bucket) => bucket?.name === PRIVATE_REPORT_BUCKET);
  if (existing === undefined) {
    const created = await client.storage.createBucket(PRIVATE_REPORT_BUCKET, BUCKET_POLICY);
    if (created?.error !== null) throw serviceError("无法创建私有报告存储桶");
    return;
  }
  if (existing.public === true) {
    throw serviceError("报告存储桶当前为公共桶，请先在官方后台人工核查");
  }
  if (
    !hasSameFileLimit(existing.file_size_limit) ||
    !hasSameMimePolicy(existing.allowed_mime_types)
  ) {
    if (typeof client.storage.updateBucket !== "function") {
      throw serviceError("报告存储桶策略不符合要求，且客户端不支持安全更新");
    }
    const updated = await client.storage.updateBucket(PRIVATE_REPORT_BUCKET, BUCKET_POLICY);
    if (updated?.error !== null) throw serviceError("无法更新私有报告存储桶策略");
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw serviceError("缺少必要的 Supabase 服务配置");
  }
  return value.trim();
}

export function createProvisionClientFromEnv() {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  provisionIncomeForecast(createProvisionClientFromEnv())
    .then(() => {
      process.stdout.write(`已确认私有报告存储桶：${PRIVATE_REPORT_BUCKET}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "私有报告存储桶初始化失败"}\n`);
      process.exitCode = 1;
    });
}
