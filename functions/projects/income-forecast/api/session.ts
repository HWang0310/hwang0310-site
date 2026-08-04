import type { AppRole } from "../../../../shared/income-forecast/contracts";
import {
  type AuditEventInput,
  writeAudit,
} from "../../../_lib/audit";
import { type Env, requireEnv } from "../../../_lib/env";
import {
  HttpError,
  json,
  normalizePhone,
  requireSameOrigin,
  safeNext,
} from "../../../_lib/http";
import {
  buildLoginLimitTargets,
  checkLoginLimits,
  clearLoginIdentityLimits,
  createRateLimitRpc,
  recordLoginFailures,
  requireCloudflareClientIp,
  type RateLimitRpc,
  type RateLimitRpcClient,
} from "../../../_lib/rate-limit";
import {
  appendSessionCookies,
  buildSessionCookieHeaders,
  getSession,
  revokeSession,
  type ProfileRecord,
  type SessionUser,
} from "../../../_lib/session";
import {
  createPublicSupabaseClient,
  createServiceRoleSupabaseClient,
} from "../../../_lib/supabase";

const MAX_LOGIN_BODY_BYTES = 4_096;
const MAX_PASSWORD_LENGTH = 1_024;
const LOGIN_ERROR = "手机号或密码错误";
const RATE_LIMIT_ERROR = "登录尝试过多，请稍后再试";
const APP_ROLES: ReadonlySet<string> = new Set(["user", "admin", "root_admin"]);

export type SessionResponse = {
  user: {
    id: string;
    name: string;
    role: AppRole;
    usesInitialPassword: boolean;
    mustChangePassword: boolean;
  };
  next: string;
};

export type LoginResult = {
  user: {
    id: string;
    appMetadata: Record<string, unknown>;
  };
  accessToken: string;
  refreshToken: string;
};

export type SessionRouteDependencies = {
  rateLimitRpc: RateLimitRpc;
  now(): Date;
  findProfileByPhone(phone: string): Promise<ProfileRecord | null>;
  signInWithPassword(input: {
    phone: string;
    password: string;
  }): Promise<LoginResult | null>;
  getSession(request: Request): Promise<SessionUser | null>;
  revokeAccessToken(accessToken: string): Promise<void>;
  revokeSession(request: Request, responseHeaders: Headers): Promise<void>;
  writeAudit(event: AuditEventInput): Promise<void>;
};

type LoginBody = {
  phone: unknown;
  password: unknown;
  next: unknown;
};

function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.has(value);
}

function safeSessionResponse(user: SessionUser, next: string): SessionResponse {
  return {
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      usesInitialPassword: user.usesInitialPassword,
      mustChangePassword: user.mustChangePassword,
    },
    next,
  };
}

function profileSessionResponse(
  profile: ProfileRecord,
  next: string,
): SessionResponse {
  return {
    user: {
      id: profile.userId,
      name: profile.fullName,
      role: profile.role,
      usesInitialPassword: profile.usesInitialPassword,
      mustChangePassword: profile.mustChangePassword,
    },
    next,
  };
}

function invalidLogin(): never {
  throw new HttpError(401, LOGIN_ERROR);
}

function invalidRequest(): never {
  throw new HttpError(400, "请求数据无效");
}

async function boundedJson(request: Request): Promise<unknown> {
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
      byteLength > MAX_LOGIN_BODY_BYTES
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
    if (totalBytes > MAX_LOGIN_BODY_BYTES) {
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

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    invalidRequest();
  }
}

async function loginBody(request: Request): Promise<LoginBody> {
  const value = await boundedJson(request);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalidRequest();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "phone" && key !== "password" && key !== "next",
    )
  ) {
    invalidRequest();
  }
  return {
    phone: record.phone,
    password: record.password,
    next: record.next,
  };
}

function responseForError(error: unknown, headers?: Headers): Response {
  if (error instanceof HttpError) {
    return json(
      { error: error.message },
      { status: error.status, headers },
    );
  }
  return json(
    { error: "服务器暂不可用" },
    { status: 500, headers },
  );
}

function defaultDependencies(env: Env): SessionRouteDependencies {
  const config = requireEnv(env);
  const publicClient = createPublicSupabaseClient(config);
  const serviceClient = createServiceRoleSupabaseClient(config);
  const rateLimitClient = serviceClient as typeof serviceClient & RateLimitRpcClient;

  return {
    rateLimitRpc: createRateLimitRpc(rateLimitClient),
    now: () => new Date(),

    async findProfileByPhone(phone) {
      try {
        const response = await serviceClient
          .from("profiles")
          .select(
            "user_id,full_name,employee_no,phone,email,role,is_active,uses_initial_password,must_change_password",
          )
          .eq("phone", phone)
          .maybeSingle();
        if (response.error !== null) {
          throw new HttpError(503, "登录服务暂不可用");
        }
        const found = response.data;
        return found === null
          ? null
          : {
              userId: found.user_id,
              fullName: found.full_name,
              employeeNo: found.employee_no,
              phone: found.phone,
              email: found.email,
              role: found.role,
              isActive: found.is_active,
              usesInitialPassword: found.uses_initial_password,
              mustChangePassword: found.must_change_password,
            };
      } catch {
        throw new HttpError(503, "登录服务暂不可用");
      }
    },

    async signInWithPassword(input) {
      try {
        const response = await publicClient.auth.signInWithPassword(input);
        if (response.error !== null) {
          if ((response.error.status ?? 500) >= 500) {
            throw new HttpError(503, "登录服务暂不可用");
          }
          return null;
        }
        const session = response.data.session;
        const user = response.data.user;
        if (session === null || user === null) {
          throw new HttpError(503, "登录服务暂不可用");
        }
        return {
          user: {
            id: user.id,
            appMetadata: { role: user.app_metadata.role },
          },
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, "登录服务暂不可用");
      }
    },

    getSession: (request) => getSession(request, env),

    async revokeAccessToken(accessToken) {
      try {
        const response = await serviceClient.auth.admin.signOut(
          accessToken,
          "local",
        );
        const status = response.error?.status;
        if (
          response.error !== null &&
          status !== 401 &&
          status !== 403 &&
          status !== 404
        ) {
          throw new HttpError(503, "登录服务暂不可用");
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, "登录服务暂不可用");
      }
    },

    revokeSession: (request, responseHeaders) =>
      revokeSession(request, env, responseHeaders),
    writeAudit: (event) => writeAudit(env, event),
  };
}

async function auditFailedLogin(
  dependencies: SessionRouteDependencies,
  reason: "invalid_credentials" | "rate_limited",
  retryAfterSeconds?: number,
): Promise<void> {
  await dependencies.writeAudit({
    action: reason === "rate_limited" ? "session.login.rate_limited" : "session.login",
    result: false,
    metadata:
      retryAfterSeconds === undefined
        ? { reason }
        : { reason, retryAfterSeconds },
  });
}

async function postSession(
  request: Request,
  config: ReturnType<typeof requireEnv>,
  dependencies: SessionRouteDependencies,
): Promise<Response> {
  requireCloudflareClientIp(request);
  const body = await loginBody(request);
  let phone: string;
  if (
    typeof body.password !== "string" ||
    body.password.length === 0 ||
    body.password.length > MAX_PASSWORD_LENGTH
  ) {
    invalidLogin();
  }
  try {
    phone = normalizePhone(body.phone);
  } catch {
    invalidLogin();
  }

  const foundProfile = await dependencies.findProfileByPhone(phone);
  const profile = foundProfile?.phone === phone ? foundProfile : null;
  const now = dependencies.now();
  const targets = await buildLoginLimitTargets(
    config.rateLimitHmacSecret,
    phone,
    request,
    profile?.role,
  );
  const decision = await checkLoginLimits(
    targets,
    dependencies.rateLimitRpc,
    now,
  );
  if (decision.blocked) {
    await auditFailedLogin(
      dependencies,
      "rate_limited",
      decision.retryAfterSeconds,
    );
    return json(
      { error: RATE_LIMIT_ERROR, retryAfterSeconds: decision.retryAfterSeconds },
      {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) },
      },
    );
  }

  const login = await dependencies.signInWithPassword({
    phone,
    password: body.password,
  });
  if (login === null) {
    await recordLoginFailures(targets, dependencies.rateLimitRpc, now);
    await auditFailedLogin(dependencies, "invalid_credentials");
    invalidLogin();
  }

  const authRole = login.user.appMetadata.role;
  if (
    profile === null ||
    !profile.isActive ||
    profile.userId !== login.user.id ||
    !isAppRole(authRole) ||
    authRole !== profile.role
  ) {
    const results = await Promise.allSettled([
      dependencies.revokeAccessToken(login.accessToken),
      recordLoginFailures(targets, dependencies.rateLimitRpc, now),
    ]);
    await auditFailedLogin(dependencies, "invalid_credentials");
    if (results.some((result) => result.status === "rejected")) {
      throw new HttpError(503, "登录服务暂不可用");
    }
    invalidLogin();
  }

  const cookies = buildSessionCookieHeaders({
    accessToken: login.accessToken,
    refreshToken: login.refreshToken,
  });
  try {
    await clearLoginIdentityLimits(targets, dependencies.rateLimitRpc);
    await dependencies.writeAudit({
      action: "session.login",
      actorUserId: profile.userId,
      targetType: "session",
      result: true,
      metadata: { role: profile.role },
    });
  } catch (error) {
    await dependencies.revokeAccessToken(login.accessToken);
    throw error;
  }

  const headers = new Headers();
  appendSessionCookies(headers, cookies);
  return json(profileSessionResponse(profile, safeNext(body.next)), { headers });
}

async function getCurrentSession(
  request: Request,
  dependencies: SessionRouteDependencies,
): Promise<Response> {
  const session = await dependencies.getSession(request);
  if (session === null) {
    throw new HttpError(401, "请先登录");
  }
  const headers = new Headers();
  session.applyCookies(headers);
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  return json(safeSessionResponse(session, next), { headers });
}

async function deleteSession(
  request: Request,
  dependencies: SessionRouteDependencies,
): Promise<Response> {
  const headers = new Headers();
  try {
    await dependencies.revokeSession(request, headers);
    await dependencies.writeAudit({
      action: "session.logout",
      result: true,
      targetType: "session",
    });
    return json({ ok: true }, { headers });
  } catch (error) {
    try {
      await dependencies.writeAudit({
        action: "session.logout",
        result: false,
        targetType: "session",
        metadata: { reason: "revocation_failed" },
      });
    } catch {
      // The local cookies are already cleared; preserve the revocation failure.
    }
    return responseForError(error, headers);
  }
}

export async function handleSessionRequest(
  request: Request,
  env: Env,
  injectedDependencies?: SessionRouteDependencies,
): Promise<Response> {
  try {
    const config = requireEnv(env);
    requireSameOrigin(request, config.siteOrigin);
    const dependencies = injectedDependencies ?? defaultDependencies(env);
    switch (request.method.toUpperCase()) {
      case "GET":
        return await getCurrentSession(request, dependencies);
      case "POST":
        return await postSession(request, config, dependencies);
      case "DELETE":
        return await deleteSession(request, dependencies);
      default:
        return json(
          { error: "请求方法不允许" },
          { status: 405, headers: { Allow: "GET, POST, DELETE" } },
        );
    }
  } catch (error) {
    return responseForError(error);
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) =>
  handleSessionRequest(request, env);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) =>
  handleSessionRequest(request, env);

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) =>
  handleSessionRequest(request, env);
