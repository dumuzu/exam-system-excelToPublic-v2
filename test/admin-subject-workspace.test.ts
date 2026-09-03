import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import { InMemoryExamHistoryRepository } from "../src/server/exam-history-repository.ts";
import { createAppServer } from "../src/server/server.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { DEFAULT_EXCEL_SUBJECT_ID } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

const subjectOne: any = "10000000-0000-4000-8000-000000000001";
const subjectTwo: any = "10000000-0000-4000-8000-000000000002";
const forgedSubject: any = "10000000-0000-4000-8000-000000000099";
const passwordHash: any = (password: any, salt: any) => hashAdminPassword(password, { salt });
const authAccounts: any = [
  { username: "multi-teacher", passwordHash: passwordHash("multi-teacher-password", "11111111111111111111111111111111"), role: ADMIN_ROLES.TEACHER },
  { username: "subject-manager", passwordHash: passwordHash("subject-manager-password", "22222222222222222222222222222222"), role: ADMIN_ROLES.TEACHER },
  { username: "platform-super", passwordHash: passwordHash("platform-super-password", "33333333333333333333333333333333"), role: ADMIN_ROLES.SUPER_ADMIN },
];
const durableAccounts: any = authAccounts.map((account: any, index: any) => ({
  id: ["teacher-1", "subject-manager-1", "super-1"][index],
  username: account.username,
  displayName: account.username,
  passwordHash: account.passwordHash,
  role: account.role,
  status: "active",
  credentialVersion: 1,
  sessionVersion: 1,
}));
const subjects: any = [
  { id: subjectOne, code: "spreadsheet", nameJa: "表計算", nameZh: "电子表格", assessmentTypeKeys: ["excel_formula", "manual_questions"] },
  { id: subjectTwo, code: "statistics", nameJa: "統計演習", nameZh: "统计练习", assessmentTypeKey: "excel_formula" },
];
const memberships: any = [
  { accountId: "teacher-1", subjectId: subjectOne, subjectCode: "spreadsheet", subjectName: "电子表格", subjectRole: "teacher", status: "active" },
  { accountId: "teacher-1", subjectId: subjectTwo, subjectCode: "statistics", subjectName: "统计练习", subjectRole: "teacher", status: "active" },
  { accountId: "subject-manager-1", subjectId: subjectOne, subjectCode: "spreadsheet", subjectName: "电子表格", subjectRole: "subject_admin", status: "active" },
];

function exam(examCode: any, subjectId: any, ownerAccountId: any) {
  return { examCode, titleJa: examCode, state: "draft", durationMinutes: 90, mode: "exam", preparationStatus: "ready", subjectId, ownerAccountId, assessmentTypeKey: "excel_formula", createdByLogin: ownerAccountId, students: [] };
}

async function login(baseUrl: any, username: any, password: any) {
  const response: any = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  const cookie: any = response.headers.getSetCookie().map((value: any) => value.split(";", 1)[0]).join("; ");
  return { cookie, session: await response.json() };
}

async function fixture(run: any) {
  const teacherAccounts: any = new InMemoryTeacherAccountRepository({ accounts: durableAccounts, memberships, subjects });
  const historyRepository: any = new InMemoryExamHistoryRepository();
  await historyRepository.save({ name: "Own A", mode: "exam", assignmentOptions: {}, selectedFunctions: ["SUM"], plan: {}, createdBy: "multi-teacher", subjectId: subjectOne, ownerAccountId: "teacher-1", assessmentTypeKey: "excel_formula" });
  await historyRepository.save({ name: "Own B", mode: "exam", assignmentOptions: {}, selectedFunctions: ["SUM"], plan: {}, createdBy: "multi-teacher", subjectId: subjectTwo, ownerAccountId: "teacher-1", assessmentTypeKey: "excel_formula" });
  await historyRepository.save({ name: "Shared A", mode: "exam", assignmentOptions: {}, selectedFunctions: ["SUM"], plan: {}, createdBy: "other", subjectId: subjectOne, ownerAccountId: "other-1", assessmentTypeKey: "excel_formula" });
  const studentExamRepository: any = new InMemoryStudentExamRepository({ exams: [
    exam("OWNA001", subjectOne, "teacher-1"),
    exam("OWNB001", subjectTwo, "teacher-1"),
    exam("SHAREA1", subjectOne, "other-1"),
  ] });
  const server: any = createAppServer({
    authConfig: { sessionSecret: "multi-subject-workspace-session-secret", accounts: authAccounts },
    teacherAccountRepository: teacherAccounts,
    historyRepository,
    studentExamRepository,
  });
  await withFetchableServer(server, (baseUrl) => run({ baseUrl, historyRepository }));
}

test("sessions describe personal, shared-subject and platform-wide workspace access", async () => {
  await fixture(async ({ baseUrl }: any) => {
    const teacher: any = await login(baseUrl, "multi-teacher", "multi-teacher-password");
    const teacherSession: any = await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie: teacher.cookie } });
    assert.deepEqual((await teacherSession.json()).workspaceSubjects.map(({ id, accessScope }: any) => ({ id, accessScope })), [
      { id: subjectOne, accessScope: "personal" },
      { id: subjectTwo, accessScope: "personal" },
    ]);

    const manager: any = await login(baseUrl, "subject-manager", "subject-manager-password");
    const managerSession: any = await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie: manager.cookie } });
    assert.deepEqual((await managerSession.json()).workspaceSubjects.map(({ id, accessScope }: any) => ({ id, accessScope })), [
      { id: subjectOne, accessScope: "subject" },
    ]);

    const platform: any = await login(baseUrl, "platform-super", "platform-super-password");
    const platformSession: any = await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie: platform.cookie } });
    assert.deepEqual((await platformSession.json()).workspaceSubjects.map(({ id, accessScope }: any) => ({ id, accessScope })), [
      { id: DEFAULT_EXCEL_SUBJECT_ID, accessScope: "platform" },
      { id: subjectOne, accessScope: "platform" },
      { id: subjectTwo, accessScope: "platform" },
    ]);
  });
});

test("collection APIs require and enforce the selected authorized subject", async () => {
  await fixture(async ({ baseUrl }: any) => {
    const teacher: any = await login(baseUrl, "multi-teacher", "multi-teacher-password");
    const unscoped: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie: teacher.cookie } });
    assert.equal(unscoped.status, 403);
    assert.equal((await unscoped.json()).code, "SUBJECT_REQUIRED");

    const headers: any = (subjectId: any) => ({ cookie: teacher.cookie, "x-subject-id": subjectId });
    const first: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: headers(subjectOne) });
    assert.deepEqual((await first.json()).exams.map(({ code }: any) => code), ["OWNA001"]);
    const second: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: headers(subjectTwo) });
    assert.deepEqual((await second.json()).exams.map(({ code }: any) => code), ["OWNB001"]);
    const history: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, { headers: headers(subjectTwo) });
    assert.deepEqual((await history.json()).configurations.map(({ name }: any) => name), ["Own B"]);
    const forged: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: headers(forgedSubject) });
    assert.equal(forged.status, 403);

    const platform: any = await login(baseUrl, "platform-super", "platform-super-password");
    const platformFirst: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie: platform.cookie, "x-subject-id": subjectOne } });
    assert.deepEqual((await platformFirst.json()).exams.map(({ code }: any) => code).sort(), ["OWNA001", "SHAREA1"]);
    const platformForged: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie: platform.cookie, "x-subject-id": forgedSubject } });
    assert.equal(platformForged.status, 403);
    assert.equal((await platformForged.json()).code, "SUBJECT_NOT_FOUND");
  });
});

test("create and reuse flows preserve subject and assessment type and reject crossed scopes", async () => {
  await fixture(async ({ baseUrl }: any) => {
    const teacher: any = await login(baseUrl, "multi-teacher", "multi-teacher-password");
    const headers: any = (subjectId: any) => ({ cookie: teacher.cookie, "content-type": "application/json", "x-csrf-token": teacher.session.csrfToken, "x-subject-id": subjectId });
    const created: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      method: "POST",
      headers: headers(subjectTwo),
      body: JSON.stringify({ name: "Statistics SUM", selectedFunctions: ["SUM"] }),
    });
    assert.equal(created.status, 201);
    const configuration: any = (await created.json()).configuration;
    assert.equal(configuration.subjectId, subjectTwo);
    assert.equal(configuration.assessmentTypeKey, "excel_formula");

    const crossed: any = await fetch(`${baseUrl}/api/admin/exam-configurations/${configuration.id}/use`, {
      method: "POST",
      headers: headers(subjectOne),
    });
    assert.equal(crossed.status, 409);
    assert.equal((await crossed.json()).code, "SUBJECT_SCOPE_MISMATCH");
    const reused: any = await fetch(`${baseUrl}/api/admin/exam-configurations/${configuration.id}/use`, {
      method: "POST",
      headers: headers(subjectTwo),
    });
    assert.equal(reused.status, 200);
    assert.equal((await reused.json()).configuration.subjectId, subjectTwo);
  });
});

test("a multi-capability subject requires and preserves the teacher-selected authoring capability", async () => {
  await fixture(async ({ baseUrl }: any) => {
    const teacher: any = await login(baseUrl, "multi-teacher", "multi-teacher-password");
    const baseHeaders: any = {
      cookie: teacher.cookie,
      "content-type": "application/json",
      "x-csrf-token": teacher.session.csrfToken,
      "x-subject-id": subjectOne,
    };
    const ambiguous: any = await fetch(`${baseUrl}/api/admin/exam-modes`, { headers: baseHeaders });
    assert.equal(ambiguous.status, 422);
    assert.equal((await ambiguous.json()).code, "ASSESSMENT_TYPE_REQUIRED");

    const manualHeaders = { ...baseHeaders, "x-assessment-type-key": "manual_questions" };
    const manualModes: any = await fetch(`${baseUrl}/api/admin/exam-modes`, { headers: manualHeaders });
    assert.deepEqual((await manualModes.json()).modes, [{ key: "exam", configurable: true, authoringKind: "manual_questions" }]);
    const manualConfiguration: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      method: "POST",
      headers: manualHeaders,
      body: JSON.stringify({
        name: "Reusable questions",
        questions: [{
          key: "choice-1",
          type: "single_choice",
          promptMarkdown: "Select one.",
          options: [{ id: "a", markdown: "A" }, { id: "b", markdown: "B" }],
          correctOptionIds: ["a"],
        }],
      }),
    });
    assert.equal(manualConfiguration.status, 201);
    assert.equal((await manualConfiguration.json()).configuration.assessmentTypeKey, "manual_questions");

    const manualHistory: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, { headers: manualHeaders });
    assert.deepEqual((await manualHistory.json()).configurations.map((item: any) => item.assessmentTypeKey), ["manual_questions"]);
    const excelHistory: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      headers: { ...baseHeaders, "x-assessment-type-key": "excel_formula" },
    });
    assert.equal((await excelHistory.json()).configurations.every((item: any) => item.assessmentTypeKey === "excel_formula"), true);
  });
});

test("teacher workspace pages use typed subject context and native keyboard-selectable controls", async () => {
  const [shell, selectField, dashboard, examApi, resultApi] = await Promise.all([
    readFile(new URL("../src/client/app/layouts/AdminShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/shared/ui/SelectField.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/dashboard/routes/dashboard.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exams/api/examApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/results/api/resultApi.ts", import.meta.url), "utf8"),
  ]);
  const source: any = `${dashboard}\n${examApi}\n${resultApi}`;
  assert.match(source, /x-subject-id/);
  assert.match(shell, /<SelectField/);
  assert.match(selectField, /<select/);
  assert.match(shell, /id="subjectSelector"/);
  assert.match(shell, /onChange=/);
  assert.match(shell, /displaySubjects\.map/);
  assert.doesNotMatch(shell, /accessScope/);
});
