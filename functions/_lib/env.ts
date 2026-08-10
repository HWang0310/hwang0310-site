import { HttpError } from "./http";

export type Env = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RATE_LIMIT_HMAC_SECRET: string;
  SITE_ORIGIN: string;
  SUPABASE_STORAGE_BUCKET: string;
  ASSETS: Fetcher;
};

export type RuntimeConfig = Readonly<{
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  rateLimitHmacSecret: string;
  siteOrigin: string;
  supabaseStorageBucket: string;
  assets: Fetcher;
}>;

function requiredString(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new HttpError(500, "服务器配置不可用");
  }
  return normalized;
}

function absoluteOrigin(value: string): string {
  try {
    const url = new URL(requiredString(value));
    if (
      !new Set(["http:", "https:"]).has(url.protocol) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("not an origin");
    }
    return url.origin;
  } catch {
    throw new HttpError(500, "服务器配置不可用");
  }
}

export function requireEnv(env: Env): RuntimeConfig {
  if (typeof env.ASSETS?.fetch !== "function") {
    throw new HttpError(500, "服务器配置不可用");
  }

  return Object.freeze({
    supabaseUrl: absoluteOrigin(env.SUPABASE_URL),
    supabasePublishableKey: requiredString(env.SUPABASE_PUBLISHABLE_KEY),
    supabaseServiceRoleKey: requiredString(env.SUPABASE_SERVICE_ROLE_KEY),
    rateLimitHmacSecret: requiredString(env.RATE_LIMIT_HMAC_SECRET),
    siteOrigin: absoluteOrigin(env.SITE_ORIGIN),
    supabaseStorageBucket: requiredString(env.SUPABASE_STORAGE_BUCKET),
    assets: env.ASSETS,
  });
}
