import assert from "node:assert/strict";
import test from "node:test";

import {
  getRosterLimit,
  getStudentExperiencePolicy,
} from "../src/core/exam-mode-config.ts";
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  getAdminPermissions,
} from "../src/server/admin-auth.ts";

test("platform extraction preserves distinct formal exam and classroom assignment policies", () => {
  assert.deepEqual(getStudentExperiencePolicy("exam"), {
    mode: "exam",
    requiresAdmission: true,
    requiresFullscreen: true,
    hasTimeLimit: true,
    proctoringEnabled: true,
    autosaveEnabled: true,
    sharedPaper: false,
    randomizeQuestionOrder: true,
    revealScoreAfterSubmission: false,
    maximumAttempts: null,
  });
  assert.deepEqual(getStudentExperiencePolicy("assignment"), {
    mode: "assignment",
    requiresAdmission: false,
    requiresFullscreen: false,
    hasTimeLimit: false,
    proctoringEnabled: false,
    autosaveEnabled: false,
    sharedPaper: true,
    randomizeQuestionOrder: false,
    revealScoreAfterSubmission: true,
    maximumAttempts: 2,
  });
  assert.equal(getRosterLimit("exam"), 200);
  assert.equal(getRosterLimit("assignment"), 500);
});

test("authorization migration preserves server-enforced proctor restrictions", () => {
  const superPermissions: any = new Set(getAdminPermissions(ADMIN_ROLES.SUPER_ADMIN));
  const assistantPermissions: any = new Set(getAdminPermissions(ADMIN_ROLES.ASSISTANT_TEACHER));

  for (const permission of Object.values(ADMIN_PERMISSIONS)) {
    assert.equal(superPermissions.has(permission), true);
  }

  assert.equal(assistantPermissions.has(ADMIN_PERMISSIONS.VIEW_ROOM), true);
  assert.equal(assistantPermissions.has(ADMIN_PERMISSIONS.MANAGE_ADMISSION), true);
  assert.equal(assistantPermissions.has(ADMIN_PERMISSIONS.AUTHORIZE_RESUME), true);
  assert.equal(assistantPermissions.has(ADMIN_PERMISSIONS.COMPOSE_EXAM), false);
  assert.equal(assistantPermissions.has(ADMIN_PERMISSIONS.VIEW_RESULTS), false);
  assert.equal(assistantPermissions.has(ADMIN_PERMISSIONS.ADJUST_GRADES), false);
  assert.equal(assistantPermissions.has(ADMIN_PERMISSIONS.DELETE_EXAM), false);
});
