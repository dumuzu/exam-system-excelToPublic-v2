import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAppServer } from "../src/server/server.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

test("live room loads through the shared route-lazy React application", async () => {
  const [html, router, roomRoute] = await Promise.all([
    readFile(new URL("../public/admin/react/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/client/app/router/router.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/routes/examRoom.lazy.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="reactRoot"/);
  assert.doesNotMatch(html, /admin-route-loader|authoringBootstrap|login-view|\/admin\/room\.js/);
  assert.match(router, /path:\s*"exams\/\$examCode\/room"/);
  assert.match(router, /features\/exam-room\/routes\/examRoom\.lazy\.tsx/);
  assert.match(roomRoute, /createLazyRoute\("\/exams\/\$examCode\/room"\)/);
});

test("allowlisted React assets bypass persisted account lookups while pages and APIs remain guarded", async () => {
  const repository = new InMemoryTeacherAccountRepository();
  const findSessionAccount = repository.findSessionAccount.bind(repository);
  const listMemberships = repository.listActiveSubjectMemberships.bind(repository);
  let sessionLookups = 0;
  let membershipLookups = 0;
  repository.findSessionAccount = async (accountId) => {
    sessionLookups += 1;
    return findSessionAccount(accountId);
  };
  repository.listActiveSubjectMemberships = async (accountId) => {
    membershipLookups += 1;
    return listMemberships(accountId);
  };

  const server = createAppServer({
    authConfig: {
      adminUsername: "authoring-perf-teacher",
      adminPassword: "authoring-perf-password",
      sessionSecret: "authoring-performance-session-secret-long-enough",
    },
    teacherAccountRepository: repository,
  });
  const reactHtml = await readFile(new URL("../public/admin/react/index.html", import.meta.url), "utf8");
  const entryPath = reactHtml.match(/src="(\/admin\/react\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(entryPath);

  await withFetchableServer(server, async (baseUrl) => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "authoring-perf-teacher", password: "authoring-perf-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    sessionLookups = 0;
    membershipLookups = 0;

    const asset = await fetch(`${baseUrl}${entryPath}`, { headers: { cookie } });
    const retiredAsset = await fetch(`${baseUrl}/admin/room.js`, { headers: { cookie } });
    assert.equal(asset.status, 200);
    assert.equal(retiredAsset.status, 404);
    assert.equal(sessionLookups, 0);
    assert.equal(membershipLookups, 0);

    const page = await fetch(`${baseUrl}/admin/exams/new/`, { headers: { cookie }, redirect: "manual" });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "/admin/system/");
    assert.equal(sessionLookups, 1);
    assert.equal(membershipLookups, 1);

    const session = await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie } });
    assert.equal(session.status, 200);
    assert.equal(sessionLookups, 2);
    assert.equal(membershipLookups, 2);
  });
});
