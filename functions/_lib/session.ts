import type { AppRole } from "../../shared/income-forecast/contracts";
import { type Env, requireEnv, type RuntimeConfig } from "./env";
import { HttpError, requireSameOrigin } from "./http";
import {
  createPublicSupabaseClient,
  createServiceRoleSupabaseClient,
} from "./supabase";

export const ACCESS_COOKIE_NAME = "if_access";
export const REFRESH_COOKIE_NAME = "if_refresh";

const COOKIE_ATTRIBUTES =
  "HttpOnly; Secure; SameSite=Lax; Path=/projects/income-forecast/";
const MAX_COOKIE_HEADER_LENGTH = 16_384;
const APP_ROLES: ReadonlySet<string> = new Set(["user", "admin", "root_admin"]);

export type VerifiedAuthUser = {
  id: string;
  appMetadata: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
};

export type RefreshedSession = {
  accessToken: string;
  refreshToken: string;
};

export type ProfileRecord = {
  userId: string;
  fullName: string;
  employeeNo: string;
  phone: string;
  email: string;
  role: AppRole;
  isActive: boolean;
  usesInitialPassword: boolean;
  mustChangePassword: boolean;
};

export type SessionDependencies = {
  verifyAccessToken(accessToken: string): Promise<VerifiedAuthUser | null>;
  refreshSession(refreshToken: string): Promise<RefreshedSession | null>;
  getProfile(userId: string): Promise<ProfileRecord | null>;
};

export type RevokeSessionDependencies = {
  refreshSession(refreshToken: string): Promise<RefreshedSession | null>;
  revokeAccessToken(accessToken: string): Promise<void>;
};

type DefaultSessionDependencies = SessionDependencies & RevokeSessionDependencies;

export type SessionUser = {
  id: string;
  name: string;
  employeeNo: string;
  phone: string;
  email: string;
  role: AppRole;
  usesInitialPassword: boolean;
  mustChangePassword: boolean;
  applyCookies(headers: Headers): void;
};

type AuthCookies = {
  accessToken: string | null;
  refreshToken: string | null;
};

function cookieValue(value: string): string {
  if (!/^[A-Za-z0-9._~-]+$/u.test(value)) {
    throw new HttpError(500, "会话令牌无效");
  }
  return value;
}

export function buildSessionCookieHeaders(tokens: RefreshedSession): string[] {
  return [
    `${ACCESS_COOKIE_NAME}=${cookieValue(tokens.accessToken)}; ${COOKIE_ATTRIBUTES}`,
    `${REFRESH_COOKIE_NAME}=${cookieValue(tokens.refreshToken)}; ${COOKIE_ATTRIBUTES}`,
  ];
}

export function clearSessionCookieHeaders(): string[] {
  return [
    `${ACCESS_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`,
    `${REFRESH_COOKIE_NAME}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`,
  ];
}

export function appendSessionCookies(headers: Headers, cookies: readonly string[]): void {
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
}

function readAuthCookies(request: Request): AuthCookies {
  const header = request.headers.get("Cookie");
  if (header === null || header.length === 0 || header.length > MAX_COOKIE_HEADER_LENGTH) {
    return { accessToken: null, refreshToken: null };
  }

  const values = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== ACCESS_COOKIE_NAME && name !== REFRESH_COOKIE_NAME) continue;
    if (values.has(name)) {
      duplicates.add(name);
      continue;
    }
    values.set(name, part.slice(separator + 1).trim());
  }

  const value = (name: string): string | null => {
    if (duplicates.has(name)) return null;
    const candidate = values.get(name);
    return candidate && /^[A-Za-z0-9._~-]+$/u.test(candidate) ? candidate : null;
  };

  return {
    accessToken: value(ACCESS_COOKIE_NAME),
    refreshToken: value(REFRESH_COOKIE_NAME),
  };
}

function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && APP_ROLES.has(value);
}

function defaultDependencies(env: Env): DefaultSessionDependencies {
  const config = requireEnv(env);
  const publicClient = createPublicSupabaseClient(config);
  const serviceClient = createServiceRoleSupabaseClient(config);

  return {
    async verifyAccessToken(accessToken) {
      try {
        const response = await publicClient.auth.getUser(accessToken);
        if (response.error !== null) {
          if ((response.error.status ?? 500) >= 500) {
            throw new HttpError(503, "登录服务暂不可用");
          }
          return null;
        }
        return {
          id: response.data.user.id,
          appMetadata: response.data.user.app_metadata,
        };
      } catch {
        throw new HttpError(503, "登录服务暂不可用");
      }
    },

    async refreshSession(refreshToken) {
      try {
        const response = await publicClient.auth.refreshSession({
          refresh_token: refreshToken,
        });
        if (response.error !== null) {
          if ((response.error.status ?? 500) >= 500) {
            throw new HttpError(503, "登录服务暂不可用");
          }
          return null;
        }
        const session = response.data.session;
        if (session === null) return null;
        return {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        };
      } catch {
        throw new HttpError(503, "登录服务暂不可用");
      }
    },

    async getProfile(userId) {
      try {
        const response = await serviceClient
          .from("profiles")
          .select(
            "user_id,full_name,employee_no,phone,email,role,is_active,uses_initial_password,must_change_password",
          )
          .eq("user_id", userId)
          .maybeSingle();
        if (response.error !== null) {
          throw new HttpError(503, "登录服务暂不可用");
        }
        const profile = response.data;
        return profile === null
          ? null
          : {
              userId: profile.user_id,
              fullName: profile.full_name,
              employeeNo: profile.employee_no,
              phone: profile.phone,
              email: profile.email,
              role: profile.role,
              isActive: profile.is_active,
              usesInitialPassword: profile.uses_initial_password,
              mustChangePassword: profile.must_change_password,
            };
      } catch {
        throw new HttpError(503, "登录服务暂不可用");
      }
    },

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
      } catch {
        throw new HttpError(503, "登录服务暂不可用");
      }
    },
  };
}

export function createRevokeSessionDependencies(
  config: RuntimeConfig,
): RevokeSessionDependencies {
  const publicClient = createPublicSupabaseClient(config);
  const serviceClient = createServiceRoleSupabaseClient(config);
  return {
    async refreshSession(refreshToken) {
      try {
        const response = await publicClient.auth.refreshSession({
          refresh_token: refreshToken,
        });
        if (response.error !== null) {
          if ((response.error.status ?? 500) >= 500) {
            throw new HttpError(503, "登录服务暂不可用");
          }
          return null;
        }
        const session = response.data.session;
        return session === null
          ? null
          : {
              accessToken: session.access_token,
              refreshToken: session.refresh_token,
            };
      } catch {
        throw new HttpError(503, "登录服务暂不可用");
      }
    },

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
      } catch {
        throw new HttpError(503, "登录服务暂不可用");
      }
    },
  };
}

export async function revokeSession(
  request: Request,
  siteOrigin: string,
  dependencies: RevokeSessionDependencies,
): Promise<void> {
  requireSameOrigin(request, siteOrigin);

  const cookies = readAuthCookies(request);
  if (cookies.accessToken === null && cookies.refreshToken === null) return;

  try {
    let accessToken = cookies.accessToken;
    if (cookies.refreshToken !== null) {
      const refreshed = await dependencies.refreshSession(
        cookies.refreshToken,
      );
      if (refreshed !== null) {
        accessToken = refreshed.accessToken;
      }
    }
    if (accessToken !== null) {
      await dependencies.revokeAccessToken(accessToken);
    }
  } catch {
    throw new HttpError(503, "登录服务暂不可用");
  }
}

export async function getSession(
  request: Request,
  env: Env,
  dependencies?: SessionDependencies,
): Promise<SessionUser | null> {
  const config = requireEnv(env);
  requireSameOrigin(request, config.siteOrigin);
  const cookies = readAuthCookies(request);
  if (cookies.accessToken === null && cookies.refreshToken === null) return null;
  const sessionDependencies = dependencies ?? defaultDependencies(env);

  let user =
    cookies.accessToken === null
      ? null
      : await sessionDependencies.verifyAccessToken(cookies.accessToken);
  let refreshedCookies: string[] = [];

  if (user === null && cookies.refreshToken !== null) {
    const refreshed = await sessionDependencies.refreshSession(cookies.refreshToken);
    if (refreshed !== null) {
      user = await sessionDependencies.verifyAccessToken(refreshed.accessToken);
      if (user !== null) {
        refreshedCookies = buildSessionCookieHeaders(refreshed);
      }
    }
  }
  if (user === null) return null;

  const role = user.appMetadata.role;
  if (!isAppRole(role)) {
    throw new HttpError(403, "账号权限无效");
  }

  const profile = await sessionDependencies.getProfile(user.id);
  if (
    profile === null ||
    !profile.isActive ||
    profile.userId !== user.id ||
    profile.role !== role
  ) {
    throw new HttpError(403, "账号不可用");
  }

  return {
    id: user.id,
    name: profile.fullName,
    employeeNo: profile.employeeNo,
    phone: profile.phone,
    email: profile.email,
    role,
    usesInitialPassword: profile.usesInitialPassword,
    mustChangePassword: profile.mustChangePassword,
    applyCookies(headers) {
      appendSessionCookies(headers, refreshedCookies);
    },
  };
}

export async function requireUser(
  request: Request,
  env: Env,
  dependencies?: SessionDependencies,
): Promise<SessionUser> {
  const session = await getSession(request, env, dependencies);
  if (session === null) {
    throw new HttpError(401, "请先登录");
  }
  return session;
}

export async function requireAdmin(
  request: Request,
  env: Env,
  dependencies?: SessionDependencies,
): Promise<SessionUser> {
  const session = await requireUser(request, env, dependencies);
  if (session.role !== "admin" && session.role !== "root_admin") {
    throw new HttpError(403, "无管理员权限");
  }
  return session;
}
