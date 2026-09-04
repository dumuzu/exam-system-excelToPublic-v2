import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import { createAppServer } from "../src/server/server.ts";
import {
  DEFAULT_EXCEL_SUBJECT_ID,
  InMemoryTeacherAccountRepository,
} from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

const superPassword: any = "super-administrator-password";
const teacherPassword: any = "ordinary-teacher-password";
const manualSubjectId = "00000000-0000-4000-8000-000000000099";
const initialAccounts: any = [
  {
    username: "platform-super",
    passwordHash: hashAdminPassword(superPassword, { salt: "11111111111111111111111111111111" }),
    role: ADMIN_ROLES.SUPER_ADMIN,
  },
  {
    username: "course-teacher",
    passwordHash: hashAdminPassword(teacherPassword, { salt: "22222222222222222222222222222222" }),
    role: ADMIN_ROLES.TEACHER,
  },
];

function accountRepository() {
  return new InMemoryTeacherAccountRepository({
    legacyAccounts: initialAccounts,
    subjects: [{
      id: manualSubjectId,
      code: "manual-test",
      nameJa: "テスト",
      nameZh: "测试",
      nameEn: "Test",
      studentLocale: "en",
      assessmentTypeKeys: ["manual_questions"],
    }],
  });
}

function cookieHeader(response: any) {
  return response.headers.getSetCookie().map((value: any) => value.split(";", 1)[0]).join("; ");
}

async function login(baseUrl: any, username: any, password: any) {
  const response: any = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  return { cookie: cookieHeader(response), session: await response.json() };
}

test("account administration repository never returns credentials and records every privilege mutation", async () => {
  const repository: any = accountRepository();
  const actorAccountId: any = "legacy:platform-super";
  const created: any = await repository.createAccount({
    actorAccountId,
    username: "new-teacher",
    displayName: "New Teacher",
    passwordHash: hashAdminPassword("new-teacher-password"),
    platformRole: "teacher",
  });
  assert.deepEqual(Object.keys(created).sort(), ["displayName", "id", "memberships", "platformRole", "status", "username"]);
  assert.equal(JSON.stringify(created).includes("password"), false);

  await repository.assignSubjectMembership({
    actorAccountId,
    accountId: created.id,
    subjectId: DEFAULT_EXCEL_SUBJECT_ID,
    subjectRole: "teacher",
  });
  await repository.resetAccountPassword({
    actorAccountId,
    accountId: created.id,
    passwordHash: hashAdminPassword("replacement-password"),
  });
  await repository.setAccountStatus({ actorAccountId, accountId: created.id, status: "disabled" });

  const page: any = await repository.listAccounts({ page: 1, pageSize: 10 });
  assert.equal(page.accounts.length, 3);
  assert.equal(JSON.stringify(page).includes("passwordHash"), false);
  assert.deepEqual(page.accounts.find((account: any) => account.id === created.id).memberships, [{
    subjectId: DEFAULT_EXCEL_SUBJECT_ID,
    subjectCode: "excel-applications",
    subjectName: "电子表格练习",
    subjectRole: "teacher",
  }]);
  const audit: any = await repository.listAuthorizationAudit();
  assert.deepEqual(
    audit.slice(-4).map((event: any) => event.decisionCode),
    ["ACCOUNT_CREATED", "MEMBERSHIP_ASSIGNED", "PASSWORD_RESET", "ACCOUNT_DISABLED"],
  );
  assert.equal(JSON.stringify(audit).includes("password"), false);
});

test("the last active super administrator cannot be disabled or demoted", async () => {
  const repository: any = accountRepository();
  await assert.rejects(
    repository.setAccountStatus({
      actorAccountId: "legacy:platform-super",
      accountId: "legacy:platform-super",
      status: "disabled",
    }),
    (error: any) => error?.code === "LAST_ACTIVE_SUPER_ADMIN",
  );
  await assert.rejects(
    repository.setPlatformRole({
      actorAccountId: "legacy:platform-super",
      accountId: "legacy:platform-super",
      platformRole: "teacher",
    }),
    (error: any) => error?.code === "LAST_ACTIVE_SUPER_ADMIN",
  );
});

test("account APIs require current account-management permission, CSRF and explicit confirmation", async () => {
  const repository: any = accountRepository();
  const server: any = createAppServer({
    authConfig: { sessionSecret: "account-administration-session-secret", accounts: initialAccounts },
    teacherAccountRepository: repository,
  });
  await withFetchableServer(server, async (baseUrl) => {
    const teacher: any = await login(baseUrl, "course-teacher", teacherPassword);
    const teacherList: any = await fetch(`${baseUrl}/api/admin/accounts`, { headers: { cookie: teacher.cookie } });
    assert.equal(teacherList.status, 403);
    const teacherPage: any = await fetch(`${baseUrl}/admin/accounts/`, { headers: { cookie: teacher.cookie }, redirect: "manual" });
    assert.equal(teacherPage.status, 302);
    assert.equal(teacherPage.headers.get("location"), "/admin/dashboard/");

    const administrator: any = await login(baseUrl, "platform-super", superPassword);
    const administratorPage: any = await fetch(`${baseUrl}/admin/accounts/`, { headers: { cookie: administrator.cookie } });
    assert.equal(administratorPage.status, 200);
    assert.match(await administratorPage.text(), /id="reactRoot"/);
    const list: any = await fetch(`${baseUrl}/api/admin/accounts?page=1&pageSize=1`, { headers: { cookie: administrator.cookie } });
    assert.equal(list.status, 200);
    const listed: any = await list.json();
    assert.equal(listed.accounts.length, 1);
    assert.equal(listed.pagination.pageSize, 1);
    assert.equal(JSON.stringify(listed).includes("password"), false);

    const noCsrf: any = await fetch(`${baseUrl}/api/admin/accounts`, {
      method: "POST",
      headers: { cookie: administrator.cookie, "content-type": "application/json" },
      body: JSON.stringify({ username: "api-teacher", displayName: "API Teacher", password: "api-teacher-password", confirmed: true }),
    });
    assert.equal(noCsrf.status, 403);

    const unconfirmed: any = await fetch(`${baseUrl}/api/admin/accounts`, {
      method: "POST",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ username: "api-teacher", displayName: "API Teacher", password: "api-teacher-password", confirmed: false }),
    });
    assert.equal(unconfirmed.status, 422);

    const created: any = await fetch(`${baseUrl}/api/admin/accounts`, {
      method: "POST",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ username: "api-teacher", displayName: "API Teacher", password: "api-teacher-password", platformRole: "teacher", confirmed: true }),
    });
    assert.equal(created.status, 201);
    const payload: any = await created.json();
    assert.equal(payload.account.username, "api-teacher");
    assert.equal(JSON.stringify(payload).includes("password"), false);

    const accountId: any = encodeURIComponent(payload.account.id);
    const unconfirmedMutation: any = await fetch(`${baseUrl}/api/admin/accounts/${accountId}/status`, {
      method: "POST",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ status: "disabled" }),
    });
    assert.equal(unconfirmedMutation.status, 422);
    const subjectsResponse: any = await fetch(`${baseUrl}/api/admin/subjects`, { headers: { cookie: administrator.cookie } });
    assert.equal(subjectsResponse.status, 200);
    const { subjects } = await subjectsResponse.json();
    assert.equal(subjects.some((subject: any) => subject.id === DEFAULT_EXCEL_SUBJECT_ID), true);

    const mutate: any = (suffix: any, body: any) => fetch(`${baseUrl}/api/admin/accounts/${accountId}/${suffix}`, {
      method: "POST",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ ...body, confirmed: true }),
    });
    const batchMembership: any = await mutate("memberships/batch", { memberships: [
      { subjectId: DEFAULT_EXCEL_SUBJECT_ID, subjectRole: "teacher" },
      { subjectId: manualSubjectId, subjectRole: "proctor" },
    ] });
    assert.equal(batchMembership.status, 200);
    assert.deepEqual((await batchMembership.json()).account.memberships.map((membership: any) => membership.subjectId).sort(), [DEFAULT_EXCEL_SUBJECT_ID, manualSubjectId].sort());

    const subjectSettings: any = await fetch(`${baseUrl}/api/admin/subjects/${manualSubjectId}/settings`, {
      method: "PATCH",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ nameJa: "手動問題", nameZh: "手动作答", nameEn: "Manual Questions", studentLocale: "zh", assessmentTypeKeys: ["manual_questions", "excel_formula"] }),
    });
    assert.equal(subjectSettings.status, 200);
    assert.deepEqual((await subjectSettings.json()).subject, {
      id: manualSubjectId, code: "manual-test", nameJa: "手動問題", nameZh: "手动作答", nameEn: "Manual Questions", studentLocale: "zh", assessmentTypeKeys: ["manual_questions", "excel_formula"],
      status: "active", membershipCount: 1,
    });

    const createdSubjectResponse: any = await fetch(`${baseUrl}/api/admin/subjects`, {
      method: "POST",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ code: "business-writing", nameJa: "ビジネス文書", nameZh: "商务写作", nameEn: "Business Writing", studentLocale: "en", assessmentTypeKeys: ["manual_questions"] }),
    });
    assert.equal(createdSubjectResponse.status, 201);
    const createdSubject = (await createdSubjectResponse.json()).subject;
    assert.equal(createdSubject.status, "active");
    assert.equal(createdSubject.membershipCount, 0);

    const archiveSubject: any = await fetch(`${baseUrl}/api/admin/subjects/${encodeURIComponent(createdSubject.id)}/status`, {
      method: "PATCH",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ status: "archived" }),
    });
    assert.equal(archiveSubject.status, 200);
    assert.equal((await archiveSubject.json()).subject.status, "archived");
    const activeSubjects = await (await fetch(`${baseUrl}/api/admin/subjects`, { headers: { cookie: administrator.cookie } })).json() as any;
    assert.equal(activeSubjects.subjects.some((subject: any) => subject.id === createdSubject.id), false);
    const fullCatalog = await (await fetch(`${baseUrl}/api/admin/subjects/catalog`, { headers: { cookie: administrator.cookie } })).json() as any;
    assert.equal(fullCatalog.subjects.find((subject: any) => subject.id === createdSubject.id).status, "archived");

    const restoreSubject: any = await fetch(`${baseUrl}/api/admin/subjects/${encodeURIComponent(createdSubject.id)}/status`, {
      method: "PATCH",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ status: "active" }),
    });
    assert.equal(restoreSubject.status, 200);
    assert.equal((await restoreSubject.json()).subject.status, "active");
    assert.equal((await mutate("reset-password", { password: "replacement-api-password" })).status, 200);
    assert.equal((await mutate("role", { platformRole: "super_admin" })).status, 200);
    assert.equal((await mutate("status", { status: "disabled" })).status, 200);

    const lastSuper: any = await fetch(`${baseUrl}/api/admin/accounts/${encodeURIComponent("legacy:platform-super")}/status`, {
      method: "POST",
      headers: { cookie: administrator.cookie, "content-type": "application/json", "x-csrf-token": administrator.session.csrfToken },
      body: JSON.stringify({ status: "disabled", confirmed: true }),
    });
    assert.equal(lastSuper.status, 409);
    assert.equal((await lastSuper.json()).code, "LAST_ACTIVE_SUPER_ADMIN");
  });
});

test("account and subject management pages are route-lazy React super-administrator workspaces", async () => {
  const [route, api, createDialog, actionDialog, subjectRoute, subjectApi, subjectDialog, subjectEditor] = await Promise.all([
    readFile(new URL("../src/client/features/accounts/routes/accounts.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/accounts/api/accountApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/accounts/components/CreateAccountDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/accounts/components/AccountActionDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/subjects/routes/subjects.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/subjects/api/subjectApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/subjects/components/SubjectStatusDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/subjects/components/SubjectEditorDialog.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /createLazyRoute\("\/accounts"\)/);
  assert.doesNotMatch(route, /\bfetch\s*\(|window\.prompt/);
  assert.match(api, /\/api\/admin\/accounts/);
  assert.match(api, /x-csrf-token/);
  assert.doesNotMatch(createDialog, /newAccountConfirmation|confirmationHint|name="confirmation"/);
  assert.match(createDialog, /confirmed:\s*true/);
  assert.doesNotMatch(actionDialog, /confirmationMatches|accountActionConfirmation|confirmationHint/);
  assert.match(actionDialog, /confirmed:\s*true/);
  assert.match(subjectRoute, /createLazyRoute\("\/subjects"\)/);
  assert.doesNotMatch(subjectRoute, /\bfetch\s*\(|window\.prompt/);
  assert.match(subjectApi, /x-csrf-token/);
  assert.doesNotMatch(subjectDialog, /confirmationMatches|subjectStatusConfirmation/);
  assert.doesNotMatch(subjectEditor, /setAssessmentTypeKeys\(\(current\)\s*=>\s*event\.currentTarget\.checked/);
  const subjectCodePattern = subjectEditor.match(/pattern="([^"]+)"/)?.[1];
  assert.ok(subjectCodePattern);
  assert.doesNotThrow(() => new RegExp(`^(?:${subjectCodePattern})$`, "v"));
  assert.doesNotMatch(`${route}${api}${actionDialog}${subjectRoute}${subjectApi}${subjectDialog}`, /passwordHash|sessionSecret/);
});
