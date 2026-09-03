export type AdminRouteKey = "login" | "system" | "subjects" | "dashboard" | "compose" | "rooms" | "results" | "accounts" | "room";
export type AdminNavigationRouteKey = Exclude<AdminRouteKey, "login" | "room">;
export type AdminWorkspaceKind = "system" | "teaching";
export type AdminRoutePermission = "manage_accounts" | "compose_exam" | "view_room" | "view_results";
export type AdminRouteGuard = "public" | "authenticated" | "platform_admin" | "permission";

export interface AdminPageRouteDefinition {
  readonly key: AdminRouteKey;
  readonly kind: "static" | "room";
  readonly path: string;
  readonly aliases: readonly string[];
  readonly staticFile: string;
  readonly guard: AdminRouteGuard;
  readonly permission: AdminRoutePermission | null;
  readonly workspace: AdminWorkspaceKind | null;
  readonly navigation: boolean;
}

export type AdminNavigationPageRouteDefinition = AdminPageRouteDefinition & {
  readonly key: AdminNavigationRouteKey;
  readonly workspace: AdminWorkspaceKind;
  readonly navigation: true;
};

export interface MatchedAdminPageRoute extends AdminPageRouteDefinition {
  readonly canonical: boolean;
  readonly params: Readonly<{ examCode?: string }>;
}

export const adminPageRouteDefinitions = Object.freeze([
  { key: "login", kind: "static", path: "/admin/login/", aliases: [], staticFile: "admin/react/index.html", guard: "public", permission: null, workspace: null, navigation: false },
  { key: "system", kind: "static", path: "/admin/system/", aliases: ["/admin/system.html"], staticFile: "admin/react/index.html", guard: "platform_admin", permission: "manage_accounts", workspace: "system", navigation: true },
  { key: "subjects", kind: "static", path: "/admin/subjects/", aliases: [], staticFile: "admin/react/index.html", guard: "platform_admin", permission: "manage_accounts", workspace: "system", navigation: true },
  { key: "dashboard", kind: "static", path: "/admin/dashboard/", aliases: ["/admin/dashboard.html"], staticFile: "admin/react/index.html", guard: "authenticated", permission: null, workspace: "teaching", navigation: true },
  { key: "compose", kind: "static", path: "/admin/exams/new/", aliases: [], staticFile: "admin/react/index.html", guard: "permission", permission: "compose_exam", workspace: "teaching", navigation: true },
  { key: "rooms", kind: "static", path: "/admin/exams/", aliases: ["/admin/exams.html"], staticFile: "admin/react/index.html", guard: "permission", permission: "view_room", workspace: "teaching", navigation: true },
  { key: "results", kind: "static", path: "/admin/results/", aliases: ["/admin/results.html"], staticFile: "admin/react/index.html", guard: "permission", permission: "view_results", workspace: "teaching", navigation: true },
  { key: "accounts", kind: "static", path: "/admin/accounts/", aliases: ["/admin/accounts.html"], staticFile: "admin/react/index.html", guard: "platform_admin", permission: "manage_accounts", workspace: "system", navigation: true },
  { key: "room", kind: "room", path: "/admin/exams/:examCode/room/", aliases: [], staticFile: "admin/react/index.html", guard: "permission", permission: "view_room", workspace: "teaching", navigation: false },
] as const satisfies readonly AdminPageRouteDefinition[]);

function isCanonicalStaticPath(pathname: string, canonicalPath: string): boolean {
  return pathname === canonicalPath || pathname === canonicalPath.slice(0, -1);
}

export function matchAdminPageRouteContract(pathname: string): MatchedAdminPageRoute | null {
  const roomMatch = /^\/admin\/exams\/([A-Za-z0-9-]{1,50})\/room\/?$/.exec(pathname);
  if (roomMatch) {
    const definition = adminPageRouteDefinitions.find((route) => route.kind === "room")!;
    return {
      ...definition,
      path: `/admin/exams/${roomMatch[1]!}/room/`,
      canonical: true,
      params: { examCode: roomMatch[1]! },
    };
  }

  const definition = adminPageRouteDefinitions.find((route) => route.kind === "static" && (
    isCanonicalStaticPath(pathname, route.path) || (route.aliases as readonly string[]).includes(pathname)
  ));
  if (!definition) return null;
  return {
    ...definition,
    canonical: isCanonicalStaticPath(pathname, definition.path),
    params: {},
  };
}

export function getAdminNavigationRouteDefinitions(): readonly AdminNavigationPageRouteDefinition[] {
  return adminPageRouteDefinitions.filter((route): route is typeof route & AdminNavigationPageRouteDefinition => (
    route.navigation && route.workspace !== null
  ));
}
