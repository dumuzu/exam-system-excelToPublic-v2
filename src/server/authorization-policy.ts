import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  getAdminPermissions,
  type AdminPermission,
  type AdminRole,
} from "./admin-auth.ts";

export type SubjectRole = "subject_admin" | "teacher" | "proctor";

export interface SubjectMembershipContext {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectRole: SubjectRole;
}

export interface TeacherAuthorizationActor {
  accountId: string;
  platformRole: AdminRole;
  memberships: SubjectMembershipContext[];
}

export interface AuthorizationResource {
  subjectId: string;
  ownerAccountId: string;
  resourceType: "exam" | "configuration" | "grade_result";
  resourceId: string;
}

export interface AuthorizationDecision {
  allowed: boolean;
  code: string;
  auditRequired: boolean;
}

const validActions = new Set<AdminPermission>(Object.values(ADMIN_PERMISSIONS));
const proctorActions = new Set<AdminPermission>([
  ADMIN_PERMISSIONS.VIEW_DASHBOARD,
  ADMIN_PERMISSIONS.VIEW_ROOM,
  ADMIN_PERMISSIONS.MANAGE_ADMISSION,
  ADMIN_PERMISSIONS.AUTHORIZE_RESUME,
]);

const denied = (code = "RESOURCE_NOT_AUTHORIZED"): AuthorizationDecision => ({
  allowed: false,
  code,
  auditRequired: false,
});

function membershipFor(
  actor: TeacherAuthorizationActor,
  subjectId: string,
): SubjectMembershipContext | null {
  return actor.memberships.find((membership) => membership.subjectId === subjectId) ?? null;
}

export function authorizeTeacherAction({
  actor,
  action,
  resource,
  subjectId,
}: {
  actor: TeacherAuthorizationActor;
  action: AdminPermission | string;
  resource?: AuthorizationResource | null;
  subjectId?: string | null;
}): AuthorizationDecision {
  if (!validActions.has(action as AdminPermission)) return denied("UNKNOWN_ACTION");

  if (actor.platformRole === ADMIN_ROLES.SUPER_ADMIN) {
    return { allowed: true, code: "PLATFORM_SUPER_ADMIN", auditRequired: true };
  }
  if (actor.platformRole === ADMIN_ROLES.TEST_ADMIN) {
    return { allowed: true, code: "ISOLATED_TEST_ADMIN", auditRequired: false };
  }

  // 普通教师权限先收敛到科目，再按资源所有者判断，默认拒绝跨教师操作。
  const targetSubjectId = resource?.subjectId ?? subjectId;
  if (!targetSubjectId) return denied("SUBJECT_REQUIRED");
  const membership = membershipFor(actor, targetSubjectId);
  if (!membership) return denied();

  if (membership.subjectRole === "subject_admin") {
    return { allowed: true, code: "SUBJECT_ADMIN", auditRequired: false };
  }
  if (membership.subjectRole === "proctor") {
    return proctorActions.has(action as AdminPermission)
      ? { allowed: true, code: "SUBJECT_PROCTOR", auditRequired: false }
      : denied();
  }
  if (membership.subjectRole !== "teacher") return denied();
  if (action === ADMIN_PERMISSIONS.VIEW_DASHBOARD) {
    return { allowed: true, code: "SUBJECT_TEACHER", auditRequired: false };
  }
  if (!resource) {
    return { allowed: true, code: "SUBJECT_TEACHER", auditRequired: false };
  }
  return resource.ownerAccountId === actor.accountId
    ? { allowed: true, code: "RESOURCE_OWNER", auditRequired: false }
    : denied();
}

export function filterAuthorizedResources<Resource extends AuthorizationResource>({
  actor,
  action,
  resources,
}: {
  actor: TeacherAuthorizationActor;
  action: AdminPermission;
  resources: Resource[];
}): Resource[] {
  return resources.filter((resource) => authorizeTeacherAction({ actor, action, resource }).allowed);
}

export function resolveSubjectId(
  actor: TeacherAuthorizationActor,
  requestedSubjectId?: string | null,
): string | null {
  if (requestedSubjectId) {
    if (actor.platformRole === ADMIN_ROLES.SUPER_ADMIN || actor.platformRole === ADMIN_ROLES.TEST_ADMIN) {
      return requestedSubjectId;
    }
    return membershipFor(actor, requestedSubjectId) ? requestedSubjectId : null;
  }
  if (actor.memberships.length === 1) return actor.memberships[0]?.subjectId ?? null;
  return null;
}

export function getSubjectAuthorizedPermissions(actor: TeacherAuthorizationActor): AdminPermission[] {
  if (actor.platformRole === ADMIN_ROLES.SUPER_ADMIN || actor.platformRole === ADMIN_ROLES.TEST_ADMIN) {
    return getAdminPermissions(actor.platformRole);
  }
  const authorized = new Set<AdminPermission>();
  for (const membership of actor.memberships) {
    for (const permission of getAuthorizedSubjectPermissions(actor, membership.subjectId)) authorized.add(permission);
  }
  return Object.values(ADMIN_PERMISSIONS).filter((permission) => authorized.has(permission));
}

export function getAuthorizedSubjectPermissions(
  actor: TeacherAuthorizationActor,
  subjectId: string,
): AdminPermission[] {
  const rolePermissions = new Set(getAdminPermissions(actor.platformRole));
  return Object.values(ADMIN_PERMISSIONS).filter((permission) => (
    rolePermissions.has(permission)
    && authorizeTeacherAction({ actor, action: permission, subjectId }).allowed
  ));
}

export interface AuthorizationQueryScope {
  unrestricted: boolean;
  accountId: string;
  allResourceSubjectIds: string[];
  ownedResourceSubjectIds: string[];
}

export function getAuthorizationQueryScope(
  actor: TeacherAuthorizationActor,
  action: AdminPermission,
): AuthorizationQueryScope {
  if (actor.platformRole === ADMIN_ROLES.SUPER_ADMIN || actor.platformRole === ADMIN_ROLES.TEST_ADMIN) {
    return { unrestricted: true, accountId: actor.accountId, allResourceSubjectIds: [], ownedResourceSubjectIds: [] };
  }
  const allResourceSubjectIds: string[] = [];
  const ownedResourceSubjectIds: string[] = [];
  for (const membership of actor.memberships) {
    if (!authorizeTeacherAction({ actor, action, subjectId: membership.subjectId }).allowed) continue;
    if (membership.subjectRole === "subject_admin" || membership.subjectRole === "proctor") {
      allResourceSubjectIds.push(membership.subjectId);
    } else if (membership.subjectRole === "teacher") {
      ownedResourceSubjectIds.push(membership.subjectId);
    }
  }
  return { unrestricted: false, accountId: actor.accountId, allResourceSubjectIds, ownedResourceSubjectIds };
}
