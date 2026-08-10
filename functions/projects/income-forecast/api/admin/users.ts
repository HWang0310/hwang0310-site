import type { AuditEventInput } from "../../../../_lib/audit";
import { writeAudit } from "../../../../_lib/audit";
import { type Env, requireEnv } from "../../../../_lib/env";
import {
  adminErrorResponse,
  adminUserView,
  ensureAdmin,
  profileFromRow,
  readAdminJson,
  RECOVERY_REDIRECT,
  type AdminProfile,
} from "../../../../_lib/admin";
import { HttpError, json, requireSameOrigin } from "../../../../_lib/http";
import { getSession, type SessionUser } from "../../../../_lib/session";
import {
  createPublicSupabaseClient,
  createServiceRoleSupabaseClient,
} from "../../../../_lib/supabase";

const PROFILE_SELECT =
  "user_id,full_name,employee_no,phone,email,role,is_active,uses_initial_password,must_change_password,updated_at";

export type AdminUserAction =
  | Readonly<{ action: "set_active"; active: boolean }>
  | Readonly<{ action: "send_reset" }>
  | Readonly<{ action: "require_password_change"; required: boolean }>;

export type AdminUserDependencies = {
  requireAdmin(request: Request): Promise<SessionUser>;
  listProfiles(): Promise<AdminProfile[]>;
  getProfile(userId: string): Promise<AdminProfile | null>;
  setActive(userId: string, active: boolean): Promise<void>;
  setRequirePasswordChange(userId: string, required: boolean): Promise<void>;
  sendReset(email: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<void>;
  restoreUserSessions?(userId: string): Promise<void>;
  writeAudit(event: AuditEventInput): Promise<void>;
};

function invalidAction(): never {
  throw new HttpError(400, "请求数据无效");
}

function parseAction(body: Record<string, unknown>): AdminUserAction {
  const action = body.action;
  if (action === "send_reset" && Object.keys(body).every((key) => key === "action")) {
    return { action };
  }
  if (
    action === "set_active" &&
    typeof body.active === "boolean" &&
    Object.keys(body).every((key) => key === "action" || key === "active")
  ) {
    return { action, active: body.active };
  }
  if (
    action === "require_password_change" &&
    typeof body.required === "boolean" &&
    Object.keys(body).every((key) => key === "action" || key === "required")
  ) {
    return { action, required: body.required };
  }
  invalidAction();
}

function profileById(profiles: readonly AdminProfile[], userId: string): AdminProfile | null {
  return profiles.find((profile) => profile.userId === userId) ?? null;
}

function defaultDependencies(
  env: Env,
  config: ReturnType<typeof requireEnv>,
): AdminUserDependencies {
  const publicClient = createPublicSupabaseClient(config);
  const serviceClient = createServiceRoleSupabaseClient(config);

  const fetchProfile = async (userId: string): Promise<AdminProfile | null> => {
    try {
      const response = await serviceClient
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", userId)
        .maybeSingle();
      if (response.error !== null) throw new Error("profile lookup failed");
      return response.data === null ? null : profileFromRow(response.data);
    } catch {
      throw new HttpError(503, "管理服务暂不可用");
    }
  };

  return {
    requireAdmin: async (request) => {
      const session = await getSession(request, env);
      if (session === null) throw new HttpError(401, "请先登录");
      return ensureAdmin(session);
    },
    async listProfiles() {
      try {
        const response = await serviceClient
          .from("profiles")
          .select(PROFILE_SELECT)
          .order("full_name", { ascending: true });
        if (response.error !== null) throw new Error("profile list failed");
        return response.data.map(profileFromRow);
      } catch {
        throw new HttpError(503, "管理服务暂不可用");
      }
    },
    getProfile: fetchProfile,
    async setActive(userId, active) {
      try {
        const response = await serviceClient
          .from("profiles")
          .update({ is_active: active })
          .eq("user_id", userId)
          .select("user_id")
          .maybeSingle();
        if (response.error !== null || response.data === null) throw new Error("profile update failed");
      } catch {
        throw new HttpError(503, "管理服务暂不可用");
      }
    },
    async setRequirePasswordChange(userId, required) {
      try {
        const response = await serviceClient
          .from("profiles")
          .update({ must_change_password: required })
          .eq("user_id", userId)
          .select("user_id")
          .maybeSingle();
        if (response.error !== null || response.data === null) throw new Error("profile update failed");
      } catch {
        throw new HttpError(503, "管理服务暂不可用");
      }
    },
    async sendReset(email) {
      try {
        const response = await publicClient.auth.resetPasswordForEmail(email, {
          redirectTo: RECOVERY_REDIRECT,
        });
        if (response.error !== null) throw new Error("reset email failed");
      } catch {
        throw new HttpError(503, "密码服务暂不可用");
      }
    },
    async revokeUserSessions(userId) {
      // Supabase Auth exposes global sign-out by JWT, not by user id. A short
      // admin ban invalidates refresh tokens; leaving the user banned until the
      // profile mutation completes prevents a race with an old session.
      try {
        const response = await serviceClient.auth.admin.updateUserById(userId, {
          ban_duration: "876000h",
        });
        if (response.error !== null) throw new Error("session revoke failed");
      } catch {
        throw new HttpError(503, "会话服务暂不可用");
      }
    },
    async restoreUserSessions(userId) {
      try {
        const response = await serviceClient.auth.admin.updateUserById(userId, {
          ban_duration: "none",
        });
        if (response.error !== null) throw new Error("session restore failed");
      } catch {
        throw new HttpError(503, "会话服务暂不可用");
      }
    },
    writeAudit: (event) => writeAudit(env, event),
  };
}

export async function handleAdminUsersRequest(
  request: Request,
  env: Env,
  injectedDependencies?: AdminUserDependencies,
): Promise<Response> {
  try {
    const config = requireEnv(env);
    requireSameOrigin(request, config.siteOrigin);
    if (request.method.toUpperCase() !== "GET") {
      return json({ error: "请求方法不允许" }, { status: 405, headers: { Allow: "GET" } });
    }
    const dependencies = injectedDependencies ?? defaultDependencies(env, config);
    ensureAdmin(await dependencies.requireAdmin(request));
    const profiles = await dependencies.listProfiles();
    return json({ users: profiles.map(adminUserView) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function handleAdminUserRequest(
  request: Request,
  env: Env,
  userId: string,
  injectedDependencies?: AdminUserDependencies,
): Promise<Response> {
  try {
    const config = requireEnv(env);
    requireSameOrigin(request, config.siteOrigin);
    if (request.method.toUpperCase() !== "PATCH") {
      return json({ error: "请求方法不允许" }, { status: 405, headers: { Allow: "PATCH" } });
    }
    const dependencies = injectedDependencies ?? defaultDependencies(env, config);
    const actor = ensureAdmin(await dependencies.requireAdmin(request));
    if (!/^[A-Za-z0-9_-]{1,120}$/u.test(userId)) throw new HttpError(400, "用户标识无效");
    const target = await dependencies.getProfile(userId);
    if (target === null) throw new HttpError(404, "用户不存在");
    const action = parseAction(await readAdminJson(request));

    if (action.action === "set_active") {
      if (!action.active && (target.role === "root_admin" || target.userId === actor.id)) {
        throw new HttpError(409, "王昊最高管理员不可停用");
      }
      if (!action.active) await dependencies.revokeUserSessions(target.userId);
      if (action.active && dependencies.restoreUserSessions !== undefined) {
        await dependencies.restoreUserSessions(target.userId);
      }
      await dependencies.setActive(target.userId, action.active);
    } else if (action.action === "send_reset") {
      await dependencies.sendReset(target.email);
    } else {
      await dependencies.setRequirePasswordChange(target.userId, action.required);
    }

    await dependencies.writeAudit({
      action: `admin.user.${action.action}`,
      actorUserId: actor.id,
      targetType: "profile",
      targetId: target.userId,
      result: true,
      metadata: action.action === "set_active"
        ? { active: action.active }
        : action.action === "require_password_change"
          ? { required: action.required }
          : {},
    });
    const updated = await dependencies.getProfile(target.userId) ?? {
      ...target,
      isActive: action.action === "set_active" ? action.active : target.isActive,
      mustChangePassword: action.action === "require_password_change" ? action.required : target.mustChangePassword,
    };
    return json({ action: action.action, user: adminUserView(updated) });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) =>
  handleAdminUsersRequest(context.request, context.env);
