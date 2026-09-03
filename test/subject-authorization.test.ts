import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_PERMISSIONS, ADMIN_ROLES } from "../src/server/admin-auth.ts";
import {
  authorizeTeacherAction,
  filterAuthorizedResources,
  getAuthorizationQueryScope,
  getSubjectAuthorizedPermissions,
} from "../src/server/authorization-policy.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { readFile } from "node:fs/promises";

const subjectOne: any = "00000000-0000-4000-8000-000000000101";
const subjectTwo: any = "00000000-0000-4000-8000-000000000102";
const auditMigrationUrl: any = new URL("../db/migrations/025_teacher_authorization_audit.sql", import.meta.url);

function actor({ accountId = "teacher-1", platformRole = ADMIN_ROLES.TEACHER, subjectRole = "teacher", subjectId = subjectOne }: any = {}): any {
  return {
    accountId,
    platformRole,
    memberships: [{ subjectId, subjectCode: "subject", subjectName: "Subject", subjectRole }],
  };
}

test("a subject teacher can manage owned events but cannot discover another owner's event", () => {
  const teacher: any = actor();
  const own: any = { subjectId: subjectOne, ownerAccountId: "teacher-1", resourceType: "exam", resourceId: "OWN" };
  const otherOwner: any = { ...own, ownerAccountId: "teacher-2", resourceId: "OTHER" };

  assert.equal(authorizeTeacherAction({ actor: teacher, action: ADMIN_PERMISSIONS.VIEW_ROOM, resource: own }).allowed, true);
  assert.deepEqual(
    authorizeTeacherAction({ actor: teacher, action: ADMIN_PERMISSIONS.VIEW_ROOM, resource: otherOwner }),
    { allowed: false, code: "RESOURCE_NOT_AUTHORIZED", auditRequired: false },
  );
  assert.deepEqual(
    filterAuthorizedResources({ actor: teacher, action: ADMIN_PERMISSIONS.VIEW_ROOM, resources: [own, otherOwner] }),
    [own],
  );
  assert.deepEqual(getAuthorizationQueryScope(teacher, ADMIN_PERMISSIONS.VIEW_ROOM), {
    unrestricted: false,
    accountId: "teacher-1",
    allResourceSubjectIds: [],
    ownedResourceSubjectIds: [subjectOne],
  });
});

test("a subject administrator can manage the subject but not a different subject", () => {
  const administrator: any = actor({ subjectRole: "subject_admin" });
  const sameSubject: any = { subjectId: subjectOne, ownerAccountId: "teacher-2", resourceType: "exam", resourceId: "SAME" };
  const otherSubject: any = { ...sameSubject, subjectId: subjectTwo, resourceId: "OTHER" };

  assert.equal(authorizeTeacherAction({ actor: administrator, action: ADMIN_PERMISSIONS.DELETE_EXAM, resource: sameSubject }).allowed, true);
  assert.equal(authorizeTeacherAction({ actor: administrator, action: ADMIN_PERMISSIONS.DELETE_EXAM, resource: otherSubject }).allowed, false);
});

test("a proctor has bounded room permissions and no authoring, result, or deletion permission", () => {
  const proctor: any = actor({ subjectRole: "proctor" });
  const resource: any = { subjectId: subjectOne, ownerAccountId: "teacher-2", resourceType: "exam", resourceId: "ROOM" };

  for (const action of [ADMIN_PERMISSIONS.VIEW_ROOM, ADMIN_PERMISSIONS.MANAGE_ADMISSION, ADMIN_PERMISSIONS.AUTHORIZE_RESUME]) {
    assert.equal(authorizeTeacherAction({ actor: proctor, action, resource }).allowed, true, action);
  }
  for (const action of [ADMIN_PERMISSIONS.COMPOSE_EXAM, ADMIN_PERMISSIONS.VIEW_RESULTS, ADMIN_PERMISSIONS.ADJUST_GRADES, ADMIN_PERMISSIONS.DELETE_EXAM]) {
    assert.equal(authorizeTeacherAction({ actor: proctor, action, resource }).allowed, false, action);
  }
  assert.deepEqual(getSubjectAuthorizedPermissions(proctor), [
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
    ADMIN_PERMISSIONS.VIEW_ROOM,
    ADMIN_PERMISSIONS.MANAGE_ADMISSION,
    ADMIN_PERMISSIONS.AUTHORIZE_RESUME,
  ]);
});

test("super administrators receive an explicit audit decision for cross-subject access", () => {
  const superAdmin: any = actor({ accountId: "super-1", platformRole: ADMIN_ROLES.SUPER_ADMIN, subjectRole: "subject_admin" });
  const resource: any = { subjectId: subjectTwo, ownerAccountId: "teacher-2", resourceType: "exam", resourceId: "CROSS" };

  assert.deepEqual(
    authorizeTeacherAction({ actor: superAdmin, action: ADMIN_PERMISSIONS.EXPORT_RESULTS, resource }),
    { allowed: true, code: "PLATFORM_SUPER_ADMIN", auditRequired: true },
  );
});

test("unknown actions and accounts without an active membership are denied by default", () => {
  const noMembership: any = { accountId: "teacher-1", platformRole: ADMIN_ROLES.TEACHER, memberships: [] };
  const resource: any = { subjectId: subjectOne, ownerAccountId: "teacher-1", resourceType: "exam", resourceId: "OWN" };

  assert.equal(authorizeTeacherAction({ actor: noMembership, action: ADMIN_PERMISSIONS.VIEW_ROOM, resource }).allowed, false);
  assert.equal(authorizeTeacherAction({ actor: actor(), action: "invented_action", resource }).allowed, false);
});

test("account repositories return only active memberships and retain super-admin audit events", async () => {
  const repository: any = new InMemoryTeacherAccountRepository({
    memberships: [
      { accountId: "teacher-1", subjectId: subjectOne, subjectCode: "one", subjectName: "One", subjectRole: "teacher", status: "active" },
      { accountId: "teacher-1", subjectId: subjectTwo, subjectCode: "two", subjectName: "Two", subjectRole: "subject_admin", status: "revoked" },
    ],
  });

  assert.deepEqual(await repository.listActiveSubjectMemberships("teacher-1"), [
    { subjectId: subjectOne, subjectCode: "one", subjectName: "One", subjectRole: "teacher" },
  ]);
  await repository.recordAuthorizationAudit({
    actorAccountId: "super-1",
    action: ADMIN_PERMISSIONS.EXPORT_RESULTS,
    subjectId: subjectTwo,
    resourceType: "exam",
    resourceId: "CROSS",
    decisionCode: "PLATFORM_SUPER_ADMIN",
  });
  assert.equal((await repository.listAuthorizationAudit()).length, 1);
});

test("migration 025 creates an append-only cross-subject authorization audit", async () => {
  const sql: any = await readFile(auditMigrationUrl, "utf8");

  assert.match(sql, /CREATE TABLE teacher_authorization_audit_events/i);
  assert.match(sql, /actor_account_id UUID NOT NULL REFERENCES teacher_accounts/i);
  assert.match(sql, /CREATE TRIGGER teacher_authorization_audit_events_append_only/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON teacher_authorization_audit_events/i);
  assert.match(sql, /VALUES \(25, '025_teacher_authorization_audit[.]sql'/i);
  assert.match(sql, /COMMIT;\s*$/i);
});
