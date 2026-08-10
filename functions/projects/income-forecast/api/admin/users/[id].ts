import type { Env } from "../../../../../_lib/env";
import {
  handleAdminUserRequest,
  type AdminUserDependencies,
} from "../users";

export { handleAdminUserRequest } from "../users";
export type { AdminUserDependencies } from "../users";

export async function handleAdminUserDetailRequest(
  request: Request,
  env: Env,
  userId: string,
  dependencies?: AdminUserDependencies,
): Promise<Response> {
  return handleAdminUserRequest(request, env, userId, dependencies);
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const userId = typeof context.params.id === "string" ? context.params.id : "";
  return handleAdminUserRequest(context.request, context.env, userId);
};
