import assert from "node:assert/strict";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import { InMemoryExamHistoryRepository } from "../src/server/exam-history-repository.ts";
import { createAppServer } from "../src/server/server.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";
import { InMemoryTeacherAccountRepository, DEFAULT_EXCEL_SUBJECT_ID } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

async function withAdminServer(run: any, options: any = {}) {
  const server: any = createAppServer({
    authConfig: options.authConfig ?? {
      adminUsername: "admin",
      adminPassword: "test-password",
      sessionSecret: "test-session-secret-that-is-long-enough",
    },
    historyRepository: options.historyRepository ?? new InMemoryExamHistoryRepository(),
    studentExamRepository: options.studentExamRepository,
    teacherAccountRepository: options.teacherAccountRepository,
  });
  await withFetchableServer(server, run);
}

test("teachers cannot discover or mutate another owner's exam while super access is audited", async () => {
  const accounts: any = [
    { username: "teacher-a", passwordHash: hashAdminPassword("teacher-a-pass", { salt: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), role: ADMIN_ROLES.TEACHER },
    { username: "teacher-b", passwordHash: hashAdminPassword("teacher-b-pass", { salt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }), role: ADMIN_ROLES.TEACHER },
    { username: "platform-super", passwordHash: hashAdminPassword("super-pass", { salt: "cccccccccccccccccccccccccccccccc" }), role: ADMIN_ROLES.SUPER_ADMIN },
  ];
  const authConfig: any = {
    sessionSecret: "subject-isolation-session-secret-long-enough",
    accounts,
  };
  const teacherAccounts: any = new InMemoryTeacherAccountRepository({ legacyAccounts: accounts });
  const historyRepository: any = new InMemoryExamHistoryRepository();
  const exams: any = new InMemoryStudentExamRepository({
    exams: [
      { examCode: "OWNERA1", titleJa: "Owner A", state: "draft", durationMinutes: 90, subjectId: DEFAULT_EXCEL_SUBJECT_ID, ownerAccountId: "legacy:teacher-a", createdByLogin: "teacher-a", students: [] },
      { examCode: "OWNERB1", titleJa: "Owner B", state: "draft", durationMinutes: 90, subjectId: DEFAULT_EXCEL_SUBJECT_ID, ownerAccountId: "legacy:teacher-b", createdByLogin: "teacher-b", students: [] },
    ],
  });

  await withAdminServer(async (baseUrl: any) => {
    const teacherA: any = await loginAs(baseUrl, "teacher-a", "teacher-a-pass");
    const ownList: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie: teacherA.cookie } });
    assert.equal(ownList.status, 200);
    assert.deepEqual((await ownList.json()).exams.map((exam: any) => exam.code), ["OWNERA1"]);

    const changedIdentifier: any = await fetch(`${baseUrl}/api/admin/exams/OWNERB1/attendance`, { headers: { cookie: teacherA.cookie } });
    assert.equal(changedIdentifier.status, 404);
    assert.deepEqual(await changedIdentifier.json(), { error: "Exam not found." });

    const blockedDelete: any = await fetch(`${baseUrl}/api/admin/exams/OWNERB1`, {
      method: "DELETE",
      headers: { cookie: teacherA.cookie, "content-type": "application/json", "x-csrf-token": teacherA.session.csrfToken },
      body: JSON.stringify({ confirmationCode: "OWNERB1" }),
    });
    assert.equal(blockedDelete.status, 404);

    const savedConfiguration: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      method: "POST",
      headers: { cookie: teacherA.cookie, "content-type": "application/json", "x-csrf-token": teacherA.session.csrfToken },
      body: JSON.stringify({ name: "Owner A config", selectedFunctions: ["SUM"] }),
    });
    assert.equal(savedConfiguration.status, 201);
    const configurationId: any = (await savedConfiguration.json()).configuration.id;

    const teacherB: any = await loginAs(baseUrl, "teacher-b", "teacher-b-pass");
    const ownerBList: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie: teacherB.cookie } });
    assert.deepEqual((await ownerBList.json()).exams.map((exam: any) => exam.code), ["OWNERB1"]);
    const ownerBHistory: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, { headers: { cookie: teacherB.cookie } });
    assert.deepEqual((await ownerBHistory.json()).configurations, []);
    const blockedHistoryMutation: any = await fetch(`${baseUrl}/api/admin/exam-configurations/${configurationId}/use`, {
      method: "POST",
      headers: { cookie: teacherB.cookie, "x-csrf-token": teacherB.session.csrfToken },
    });
    assert.equal(blockedHistoryMutation.status, 404);

    const platformSuper: any = await loginAs(baseUrl, "platform-super", "super-pass");
    const allExams: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie: platformSuper.cookie } });
    assert.deepEqual((await allExams.json()).exams.map((exam: any) => exam.code).sort(), ["OWNERA1", "OWNERB1"]);
    const audit: any = await teacherAccounts.listAuthorizationAudit();
    assert.equal(audit.some((event: any) => event.actorAccountId === "legacy:platform-super" && event.action === "view_room"), true);
  }, { authConfig, teacherAccountRepository: teacherAccounts, studentExamRepository: exams, historyRepository });
});

function roleAuthConfig() {
  return {
    sessionSecret: "test-session-secret-that-is-long-enough",
    accounts: [
      { username: "super", passwordHash: hashAdminPassword("super-pass", { salt: "11111111111111111111111111111111" }), role: ADMIN_ROLES.SUPER_ADMIN },
      { username: "tester", passwordHash: hashAdminPassword("test-pass", { salt: "22222222222222222222222222222222" }), role: ADMIN_ROLES.TEST_ADMIN },
      { username: "teacher", passwordHash: hashAdminPassword("teacher-pass", { salt: "33333333333333333333333333333333" }), role: ADMIN_ROLES.ASSISTANT_TEACHER },
    ],
  };
}

test("room permissions never exceed the authenticated platform-role baseline", async () => {
  const subjectId: any = "20000000-0000-4000-8000-000000000001";
  const passwordHash: any = hashAdminPassword("assistant-manager-pass", { salt: "dddddddddddddddddddddddddddddddd" });
  const authenticationAccount: any = {
    username: "assistant-manager",
    passwordHash,
    role: ADMIN_ROLES.ASSISTANT_TEACHER,
  };
  const teacherAccounts: any = new InMemoryTeacherAccountRepository({
    accounts: [{
      id: "assistant-manager-1",
      username: authenticationAccount.username,
      displayName: "Assistant Manager",
      passwordHash,
      role: ADMIN_ROLES.ASSISTANT_TEACHER,
      status: "active",
      credentialVersion: 1,
      sessionVersion: 1,
    }],
    memberships: [{
      accountId: "assistant-manager-1",
      subjectId,
      subjectCode: "mixed-role",
      subjectName: "Mixed Role",
      subjectRole: "subject_admin",
      status: "active",
    }],
    subjects: [{
      id: subjectId,
      code: "mixed-role",
      nameJa: "複合権限",
      nameZh: "混合权限",
      assessmentTypeKey: "excel_formula",
    }],
  });
  const exams: any = new InMemoryStudentExamRepository({
    exams: [{
      examCode: "MIXED01",
      titleJa: "Mixed Role",
      state: "published",
      durationMinutes: 90,
      subjectId,
      ownerAccountId: "another-teacher",
      students: [{ studentNumber: "S001", name: "Student", enrollmentStatus: "eligible" }],
    }],
  });

  await withAdminServer(async (baseUrl: any) => {
    const assistant: any = await loginAs(baseUrl, "assistant-manager", "assistant-manager-pass");
    const sessionResponse: any = await fetch(`${baseUrl}/api/admin/session`, {
      headers: { cookie: assistant.cookie },
    });
    const session: any = await sessionResponse.json();
    assert.deepEqual(session.workspaceSubjects[0].permissions, ["view_dashboard", "view_room", "manage_admission", "authorize_resume"]);
    assert.deepEqual(session.navigation.map(({ key }: any) => key), ["dashboard", "rooms"]);

    const attendance: any = await fetch(`${baseUrl}/api/admin/exams/MIXED01/attendance`, {
      headers: { cookie: assistant.cookie },
    });
    assert.equal(attendance.status, 200);
    assert.deepEqual((await attendance.json()).permissions, ["view_room", "manage_admission", "authorize_resume"]);

    const blockedRetake: any = await fetch(`${baseUrl}/api/admin/exams/MIXED01/students/S001/retake`, {
      method: "POST",
      headers: {
        cookie: assistant.cookie,
        "content-type": "application/json",
        "x-csrf-token": assistant.session.csrfToken,
      },
      body: "{}",
    });
    assert.equal(blockedRetake.status, 403);
  }, {
    authConfig: { sessionSecret: "mixed-role-session-secret-long-enough", accounts: [authenticationAccount] },
    teacherAccountRepository: teacherAccounts,
    studentExamRepository: exams,
  });
});

async function loginAs(baseUrl: any, username: any, password: any) {
  const response: any = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { response, session: await response.json(), cookie: cookieHeader(response) };
}

function cookieHeader(response: any) {
  return response.headers.getSetCookie().map((value: any) => value.split(";", 1)[0]).join("; ");
}

test("admin can save a one-function exam configuration and load it from history", async () => {
  await withAdminServer(async (baseUrl: any) => {
    const blocked: any = await fetch(`${baseUrl}/api/admin/functions`);
    assert.equal(blocked.status, 401);

    const login: any = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-password" }),
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    const session: any = await login.json();
    const cookie: any = cookieHeader(login);

    const modes: any = await fetch(`${baseUrl}/api/admin/exam-modes`, { headers: { cookie } });
    assert.equal(modes.status, 200);
    assert.deepEqual((await modes.json()).modes.map((mode: any) => mode.key), ["exam", "assignment"]);

    const save: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({ name: "SUM practice", selectedFunctions: ["SUM"] }),
    });
    assert.equal(save.status, 201);
    const saved: any = await save.json();
    assert.equal(saved.configuration.selectedFunctions[0], "SUM");
    assert.equal(saved.configuration.plan.choiceQuestions.every((question: any) => question.functionName === "SUM"), true);

    const history: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      headers: { cookie },
    });
    assert.equal(history.status, 200);
    const historyBody: any = await history.json();
    assert.equal(historyBody.configurations.length, 1);
    assert.equal(historyBody.configurations[0].id, saved.configuration.id);
  });
});

test("admin history writes reject invalid credentials and missing CSRF tokens", async () => {
  await withAdminServer(async (baseUrl: any) => {
    const rejectedLogin: any = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });
    assert.equal(rejectedLogin.status, 401);
    assert.deepEqual(await rejectedLogin.json(), { error: "Invalid username or password." });

    const login: any = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-password" }),
    });
    const cookie: any = cookieHeader(login);

    const writeWithoutCsrf: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Blocked", selectedFunctions: ["SUM"] }),
    });
    assert.equal(writeWithoutCsrf.status, 403);
  });
});

test("admin preserves assignment questions per function in history", async () => {
  await withAdminServer(async (baseUrl: any) => {
    const login: any = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-password" }),
    });
    const session: any = await login.json();
    const cookie: any = cookieHeader(login);

    const save: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        name: "SUM homework",
        mode: "assignment",
        assignmentOptions: { questionsPerFunction: 10 },
        selectedFunctions: ["SUM", "AVERAGE"],
      }),
    });

    assert.equal(save.status, 201);
    const body: any = await save.json();
    assert.equal(body.configuration.mode, "assignment");
    assert.deepEqual(body.configuration.assignmentOptions, {
      formulaQuestionCount: 20,
      choiceQuestionCount: 0,
      formulaQuestionCountMode: "per_function",
      questionsPerFunction: 10,
    });
    assert.equal(body.configuration.plan.questionCounts.formula, 20);
    assert.equal(body.configuration.plan.questionCounts.choice, 0);
  });
});

test("assistant teachers can operate rooms but cannot compose or read results", async () => {
  await withAdminServer(async (baseUrl: any) => {
    const { session, cookie } = await loginAs(baseUrl, "teacher", "teacher-pass");
    assert.equal(session.role, ADMIN_ROLES.ASSISTANT_TEACHER);

    const exams: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie } });
    assert.equal(exams.status, 200);

    const preview: any = await fetch(`${baseUrl}/api/admin/exam-preview`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-csrf-token": session.csrfToken },
      body: JSON.stringify({ selectedFunctions: ["SUM"] }),
    });
    assert.equal(preview.status, 403);
    assert.deepEqual(await preview.json(), { error: "Permission denied.", code: "FORBIDDEN" });

    const results: any = await fetch(`${baseUrl}/api/admin/exams/ANY/results`, { headers: { cookie } });
    assert.equal(results.status, 403);

    const composePage: any = await fetch(`${baseUrl}/admin/exams/new/`, { headers: { cookie }, redirect: "manual" });
    assert.equal(composePage.status, 302);
    assert.equal(composePage.headers.get("location"), "/admin/dashboard/");
  }, { authConfig: roleAuthConfig() });
});

test("room administrators can inspect collection failures and retry one confirmed attempt", async () => {
  const attemptId: any = "11111111-1111-4111-8111-111111111111";
  const calls: any = [];
  const repository: any = {
    async listTerminationFailures(examCode: any) {
      assert.equal(examCode, "ROOM19");
      return [{ attemptId, studentNumber: "S001", name: "Student One", attemptNumber: 1, errorCode: "GRADING_FAILED", errorMessage: "The answer could not be graded.", occurrenceCount: 2 }];
    },
    async retryTerminationAttempt(input: any) {
      calls.push(input);
      return { completed: true, pendingSubmissionCount: 0, processedThisBatch: 1 };
    },
  };

  await withAdminServer(async (baseUrl: any) => {
    const admin: any = await loginAs(baseUrl, "super", "super-pass");
    const failures: any = await fetch(`${baseUrl}/api/admin/exams/ROOM19/termination-failures`, { headers: { cookie: admin.cookie } });
    assert.equal(failures.status, 200);
    assert.equal((await failures.json()).failures[0].studentNumber, "S001");

    const missingCsrf: any = await fetch(`${baseUrl}/api/admin/exams/ROOM19/termination-failures/${attemptId}/retry`, {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ confirmationCode: "ROOM19" }),
    });
    assert.equal(missingCsrf.status, 403);

    const retried: any = await fetch(`${baseUrl}/api/admin/exams/ROOM19/termination-failures/${attemptId}/retry`, {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json", "x-csrf-token": admin.session.csrfToken },
      body: JSON.stringify({ confirmationCode: "ROOM19" }),
    });
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).exam.completed, true);
    assert.deepEqual(calls, [{ examCode: "ROOM19", attemptId, retriedByLogin: "super" }]);

    const assistant: any = await loginAs(baseUrl, "teacher", "teacher-pass");
    const visible: any = await fetch(`${baseUrl}/api/admin/exams/ROOM19/termination-failures`, { headers: { cookie: assistant.cookie } });
    assert.equal(visible.status, 200);
    const blockedRetry: any = await fetch(`${baseUrl}/api/admin/exams/ROOM19/termination-failures/${attemptId}/retry`, {
      method: "POST",
      headers: { cookie: assistant.cookie, "content-type": "application/json", "x-csrf-token": assistant.session.csrfToken },
      body: JSON.stringify({ confirmationCode: "ROOM19" }),
    });
    assert.equal(blockedRetry.status, 403);
  }, { authConfig: roleAuthConfig(), studentExamRepository: repository });
});

test("super and isolated test administrators can terminate and delete an exam event", async () => {
  const repository: any = new InMemoryStudentExamRepository();
  const plan: any = composeExamPlan({ selectedFunctions: ["SUM"] }).plan;
  const published: any = await repository.publishExam({
    title: "Lifecycle test",
    mode: "exam",
    selectedFunctions: ["SUM"],
    plan,
    roster: [],
    createdByLogin: "super",
  });
  await repository.prepareNextBatch({ examCode: published.code, batchSize: 1 });

  await withAdminServer(async (baseUrl: any) => {
    const tester: any = await loginAs(baseUrl, "tester", "test-pass");
    const collection: any = await fetch(`${baseUrl}/api/admin/exams/${published.code}/termination-collection`, {
      method: "POST",
      headers: { cookie: tester.cookie, "content-type": "application/json", "x-csrf-token": tester.session.csrfToken },
      body: JSON.stringify({ confirmationCode: published.code }),
    });
    assert.equal(collection.status, 200);
    assert.ok((await collection.json()).collection.collectUntil);
    const testerTerminate: any = await fetch(`${baseUrl}/api/admin/exams/${published.code}/terminate`, {
      method: "POST",
      headers: { cookie: tester.cookie, "content-type": "application/json", "x-csrf-token": tester.session.csrfToken },
      body: JSON.stringify({ confirmationCode: published.code }),
    });
    assert.equal(testerTerminate.status, 200);
    assert.equal((await testerTerminate.json()).exam.state, "closed");

    const remove: any = await fetch(`${baseUrl}/api/admin/exams/${published.code}`, {
      method: "DELETE",
      headers: { cookie: tester.cookie, "content-type": "application/json", "x-csrf-token": tester.session.csrfToken },
      body: JSON.stringify({ confirmationCode: published.code }),
    });
    assert.equal(remove.status, 200);
    assert.equal((await remove.json()).deleted, true);
    assert.deepEqual(await repository.listExamEvents(), []);
  }, { authConfig: roleAuthConfig(), studentExamRepository: repository });
});

test("exam publication is blocked when the blueprint publication gate fails", async () => {
  let publishCalled: any = false;
  const repository: any = {
    async publishExam() { publishCalled = true; },
    async listExamEvents() { return []; },
  };
  const server: any = createAppServer({
    authConfig: roleAuthConfig(),
    studentExamRepository: repository,
    publicationGate: (() => ({ ok: false, status: "blocked", errors: [{ code: "BLUEPRINT_REPLAY_FAILED" }], warnings: [] })) as any,
  });

  await withFetchableServer(server, async (baseUrl) => {
    const admin: any = await loginAs(baseUrl, "super", "super-pass");
    const response: any = await fetch(`${baseUrl}/api/admin/exams`, {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json", "x-csrf-token": admin.session.csrfToken },
      body: JSON.stringify({ name: "Blocked exam", selectedFunctions: ["SUM"], rosterCsv: "student_number,name\nS001,Student" }),
    });

    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "PUBLICATION_BLOCKED");
    assert.equal(publishCalled, false);
  });
});
