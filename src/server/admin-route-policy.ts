import {
  getAdminNavigationRouteDefinitions,
  matchAdminPageRouteContract,
  type AdminNavigationRouteKey,
  type AdminRouteKey,
  type AdminWorkspaceKind,
  type MatchedAdminPageRoute,
} from "../platform/admin-route-contract.ts";
import { ADMIN_ROLES, type AdminPermission } from "./admin-auth.ts";
import { getSubjectAuthorizedPermissions, type TeacherAuthorizationActor } from "./authorization-policy.ts";

export type { AdminRouteKey, AdminWorkspaceKind };
export type AdminPageRoute = MatchedAdminPageRoute;

export interface AdminNavigationRoute {
  readonly key: AdminNavigationRouteKey;
  readonly path: string;
  readonly permission: AdminPermission | null;
  readonly workspace: AdminWorkspaceKind;
}

export interface AdminPageAccess {
  readonly allowed: boolean;
  readonly route: AdminPageRoute | null;
  readonly redirectTo: string;
}

function isPlatformAdministrator(actor: TeacherAuthorizationActor): boolean {
  return actor.platformRole === ADMIN_ROLES.SUPER_ADMIN || actor.platformRole === ADMIN_ROLES.TEST_ADMIN;
}

export function getAdminLandingPath(actor: TeacherAuthorizationActor): string {
  return isPlatformAdministrator(actor) ? "/admin/system/" : "/admin/dashboard/";
}

export function getAdminNavigation(actor: TeacherAuthorizationActor): AdminNavigationRoute[] {
  const permissions = new Set(getSubjectAuthorizedPermissions(actor));
  return getAdminNavigationRouteDefinitions().filter((route) => {
    if (isPlatformAdministrator(actor)) return route.workspace === "system";
    if (route.workspace !== "teaching") return false;
    return route.permission === null || permissions.has(route.permission);
  }).map((route) => ({
    key: route.key,
    path: route.path,
    permission: route.permission,
    workspace: route.workspace,
  }));
}

export function matchAdminPageRoute(pathname: string): AdminPageRoute | null {
  return matchAdminPageRouteContract(pathname);
}

export function authorizeAdminPage(actor: TeacherAuthorizationActor, pathname: string): AdminPageAccess {
  const redirectTo = getAdminLandingPath(actor);
  const route = matchAdminPageRoute(pathname);
  // 未注册页面和未知守卫一律拒绝，客户端加载器不能扩大服务端权限。
  if (!route) return { allowed: false, route: null, redirectTo };
  if (isPlatformAdministrator(actor) && route.workspace === "teaching") {
    return { allowed: false, route, redirectTo };
  }
  if (route.guard === "public" || route.guard === "authenticated") {
    return { allowed: true, route, redirectTo };
  }
  if (route.guard === "platform_admin") {
    return { allowed: isPlatformAdministrator(actor), route, redirectTo };
  }
  if (route.guard === "permission" && route.permission) {
    return {
      allowed: getSubjectAuthorizedPermissions(actor).includes(route.permission),
      route,
      redirectTo,
    };
  }
  return { allowed: false, route, redirectTo };
}
