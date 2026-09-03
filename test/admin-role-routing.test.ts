import assert from "node:assert/strict";
import test from "node:test";

import { adminPageRouteDefinitions, matchAdminPageRouteContract } from "../src/platform/admin-route-contract.ts";
import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import { authorizeAdminPage, getAdminLandingPath, getAdminNavigation } from "../src/server/admin-route-policy.ts";
import type { TeacherAuthorizationActor } from "../src/server/authorization-policy.ts";
import { createAppServer } from "../src/server/server.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

const subjectId = "40000000-0000-4000-8000-000000000004";

function actor(
  subjectRole: "subject_admin" | "teacher" | "proctor",
  platformRole: TeacherAuthorizationActor["platformRole"] = ADMIN_ROLES.TEACHER,
): TeacherAuthorizationActor {
  return {
    accountId: `${subjectRole}-account`,
    platformRole,
    memberships: [{ subjectId, subjectCode: "routing", subjectName: "Routing", subjectRole }],
  };
}

test("the server-owned route policy separates system, teaching and proctor workspaces", () => {
  const administrator = actor("subject_admin", ADMIN_ROLES.SUPER_ADMIN);
  assert.equal(getAdminLandingPath(administrator), "/admin/system/");
  assert.deepEqual(getAdminNavigation(administrator).map(({ key }) => key), ["system", "subjects", "accounts"]);
  assert.equal(authorizeAdminPage(administrator, "/admin/accounts/").allowed, true);
  assert.equal(authorizeAdminPage(administrator, "/admin/subjects/").allowed, true);
  assert.equal(authorizeAdminPage(administrator, "/admin/exams/new/").allowed, false);

  const teacher = actor("teacher");
  assert.equal(getAdminLandingPath(teacher), "/admin/dashboard/");
  assert.deepEqual(getAdminNavigation(teacher).map(({ key }) => key), ["dashboard", "compose", "rooms", "results"]);
  assert.equal(authorizeAdminPage(teacher, "/admin/system/").allowed, false);
  assert.equal(authorizeAdminPage(teacher, "/admin/accounts.html").allowed, false);

  const subjectAdministrator = actor("subject_admin");
  assert.deepEqual(getAdminNavigation(subjectAdministrator).map(({ key }) => key), ["dashboard", "compose", "rooms", "results"]);

  const proctor = actor("proctor");
  assert.deepEqual(getAdminNavigation(proctor).map(({ key }) => key), ["dashboard", "rooms"]);
  assert.equal(authorizeAdminPage(proctor, "/admin/exams/new/").allowed, false);
  assert.equal(authorizeAdminPage(proctor, "/admin/results/").allowed, false);
  assert.equal(authorizeAdminPage(proctor, "/admin/exams/ROOM-1/room/").allowed, true);

  const unassigned: TeacherAuthorizationActor = { accountId: "unassigned", platformRole: ADMIN_ROLES.TEACHER, memberships: [] };
  assert.deepEqual(getAdminNavigation(unassigned).map(({ key }) => key), ["dashboard"]);
  assert.equal(authorizeAdminPage(unassigned, "/admin/exams/").allowed, false);
  assert.equal(authorizeAdminPage(unassigned, "/admin/not-a-route/").allowed, false);
});

test("the shared route contract covers canonical paths, aliases and dynamic rooms", () => {
  for (const definition of adminPageRouteDefinitions) {
    if (definition.kind === "room") continue;
    assert.equal(matchAdminPageRouteContract(definition.path)?.key, definition.key);
    assert.equal(matchAdminPageRouteContract(definition.path.slice(0, -1))?.key, definition.key);
    for (const alias of definition.aliases) {
      const match = matchAdminPageRouteContract(alias);
      assert.equal(match?.key, definition.key);
      assert.equal(match?.canonical, false);
    }
  }
  const room = matchAdminPageRouteContract("/admin/exams/ROOM-42/room/");
  assert.equal(room?.key, "room");
  assert.equal(room?.params.examCode, "ROOM-42");
  assert.equal(matchAdminPageRouteContract("/admin/exams/invalid_room/room/"), null);
  assert.equal(matchAdminPageRouteContract("/admin/not-a-route/"), null);
});

const credentials = [
  { id: "routing-super", username: "routing-super", password: "routing-super-password", role: ADMIN_ROLES.SUPER_ADMIN, subjectRole: "subject_admin" },
  { id: "routing-teacher", username: "routing-teacher", password: "routing-teacher-password", role: ADMIN_ROLES.TEACHER, subjectRole: "teacher" },
  { id: "routing-manager", username: "routing-manager", password: "routing-manager-password", role: ADMIN_ROLES.TEACHER, subjectRole: "subject_admin" },
  { id: "routing-proctor", username: "routing-proctor", password: "routing-proctor-password", role: ADMIN_ROLES.TEACHER, subjectRole: "proctor" },
] as const;

async function login(baseUrl: string, username: string, password: string) {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  return { body: await response.json() as any, cookie };
}

test("page redirects and session navigation enforce the same role capabilities", async () => {
  const authAccounts = credentials.map((credential, index) => ({
    username: credential.username,
    passwordHash: hashAdminPassword(credential.password, { salt: String(index + 1).repeat(32) }),
    role: credential.role,
  }));
  const accountRepository = new InMemoryTeacherAccountRepository({
    accounts: credentials.map((credential, index) => ({
      id: credential.id,
      username: credential.username,
      displayName: credential.username,
      passwordHash: authAccounts[index]!.passwordHash,
      role: credential.role,
      status: "active",
      credentialVersion: 1,
      sessionVersion: 1,
    })),
    subjects: [{ id: subjectId, code: "routing", nameJa: "ルーティング", nameZh: "路由测试", assessmentTypeKey: "manual_questions" }],
    memberships: credentials.map((credential) => ({
      accountId: credential.id,
      subjectId,
      subjectCode: "routing",
      subjectName: "路由测试",
      subjectRole: credential.subjectRole,
      status: "active",
    })),
  });
  const server = createAppServer({
    authConfig: { sessionSecret: "role-routing-session-secret-that-is-long-enough", accounts: authAccounts },
    teacherAccountRepository: accountRepository,
  });

  await withFetchableServer(server, async (baseUrl) => {
    const administrator = await login(baseUrl, "routing-super", "routing-super-password");
    assert.equal(administrator.body.landingPath, "/admin/system/");
    const adminRoot = await fetch(`${baseUrl}/admin/`, { headers: { cookie: administrator.cookie }, redirect: "manual" });
    assert.equal(adminRoot.headers.get("location"), "/admin/system/");
    assert.equal((await fetch(`${baseUrl}/admin/system/`, { headers: { cookie: administrator.cookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/admin/subjects/`, { headers: { cookie: administrator.cookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/admin/accounts/`, { headers: { cookie: administrator.cookie } })).status, 200);
    const accountAlias = await fetch(`${baseUrl}/admin/accounts.html`, { headers: { cookie: administrator.cookie }, redirect: "manual" });
    assert.equal(accountAlias.headers.get("location"), "/admin/accounts/");
    const adminSession = await (await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie: administrator.cookie } })).json() as any;
    assert.equal(adminSession.workspaceKind, "system");
    assert.deepEqual(adminSession.navigation.map(({ key }: any) => key), ["system", "subjects", "accounts"]);
    for (const path of ["/admin/dashboard/", "/admin/exams/new/", "/admin/exams/", "/admin/results/"]) {
      const denied = await fetch(`${baseUrl}${path}`, { headers: { cookie: administrator.cookie }, redirect: "manual" });
      assert.equal(denied.status, 302);
      assert.equal(denied.headers.get("location"), "/admin/system/");
    }

    for (const username of ["routing-teacher", "routing-manager"] as const) {
      const credential = credentials.find((item) => item.username === username)!;
      const signedIn = await login(baseUrl, credential.username, credential.password);
      assert.equal(signedIn.body.landingPath, "/admin/dashboard/");
      for (const path of ["/admin/exams/new/", "/admin/exams/", "/admin/results/"]) {
        assert.equal((await fetch(`${baseUrl}${path}`, { headers: { cookie: signedIn.cookie } })).status, 200);
      }
      for (const path of ["/admin/system/", "/admin/accounts/", "/admin/accounts.html"]) {
        const denied = await fetch(`${baseUrl}${path}`, { headers: { cookie: signedIn.cookie }, redirect: "manual" });
        assert.equal(denied.status, 302);
        assert.equal(denied.headers.get("location"), "/admin/dashboard/");
      }
    }

    const proctor = await login(baseUrl, "routing-proctor", "routing-proctor-password");
    assert.equal((await fetch(`${baseUrl}/admin/exams/`, { headers: { cookie: proctor.cookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/admin/exams/ROUTE-1/room/`, { headers: { cookie: proctor.cookie } })).status, 200);
    for (const path of ["/admin/exams/new/", "/admin/results/", "/admin/accounts/"]) {
      const denied = await fetch(`${baseUrl}${path}`, { headers: { cookie: proctor.cookie }, redirect: "manual" });
      assert.equal(denied.status, 302);
      assert.equal(denied.headers.get("location"), "/admin/dashboard/");
    }
    const proctorSession = await (await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie: proctor.cookie } })).json() as any;
    assert.deepEqual(proctorSession.navigation.map(({ key }: any) => key), ["dashboard", "rooms"]);
    assert.deepEqual(proctorSession.workspaceSubjects[0].permissions.sort(), ["authorize_resume", "manage_admission", "view_dashboard", "view_room"]);
  });
});

test("workspace sources contain an administrator-only overview and no teacher account card", async () => {
  const { readFile } = await import("node:fs/promises");
  const [systemRoute, systemHook, systemApi, dashboardRoute, shell, styles] = await Promise.all([
    readFile(new URL("../src/client/features/system/routes/system.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/system/hooks/useSystemOverviewQueries.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/system/api/systemApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/dashboard/routes/dashboard.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/app/layouts/AdminShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/system/system.css", import.meta.url), "utf8"),
  ]);
  assert.match(systemRoute, /useSystemOverviewQueries/);
  assert.match(systemHook, /accountPageQueryOptions\(1, 1\)/);
  assert.match(systemHook, /platformExamEventQueryOptions/);
  assert.match(systemApi, /\/api\/admin\/exams/);
  assert.doesNotMatch(systemRoute, /SYSTEM CONTROL|STORAGE|POSTGRES/);
  assert.doesNotMatch(dashboardRoute, /routeAccounts|\/accounts/);
  assert.match(shell, /session\.navigation/);
  assert.match(shell, /grantedPermissions\.includes/);
  assert.match(styles, /\.systemMetricStrip/);
});
