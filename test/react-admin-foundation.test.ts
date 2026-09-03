import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { matchAdminPageRouteContract } from "../src/platform/admin-route-contract.ts";
import { createAppServer } from "../src/server/server.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

test("React owns the migrated administration routes", () => {
  assert.equal(matchAdminPageRouteContract("/admin/login/")?.staticFile, "admin/react/index.html");
  assert.equal(matchAdminPageRouteContract("/admin/system/")?.staticFile, "admin/react/index.html");
  assert.equal(matchAdminPageRouteContract("/admin/dashboard/")?.staticFile, "admin/react/index.html");
  assert.equal(matchAdminPageRouteContract("/admin/exams/new/")?.staticFile, "admin/react/index.html");
  assert.equal(matchAdminPageRouteContract("/admin/exams/")?.staticFile, "admin/react/index.html");
  assert.equal(matchAdminPageRouteContract("/admin/results/")?.staticFile, "admin/react/index.html");
  assert.equal(matchAdminPageRouteContract("/admin/accounts/")?.staticFile, "admin/react/index.html");
  assert.equal(matchAdminPageRouteContract("/admin/exams/ROOM001/room/")?.staticFile, "admin/react/index.html");
});

test("the production manifest code-splits each migrated administration route without source maps", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/admin/react/.vite/manifest.json", import.meta.url), "utf8")) as Record<string, { file: string; isEntry?: boolean; isDynamicEntry?: boolean }>;
  const files = Object.values(manifest).map(({ file }) => file);
  assert.ok(Object.keys(manifest).some((key) => key.endsWith("features/auth/routes/login.lazy.tsx")));
  assert.ok(Object.keys(manifest).some((key) => key.endsWith("features/system/routes/system.lazy.tsx")));
  assert.ok(Object.keys(manifest).some((key) => key.endsWith("features/dashboard/routes/dashboard.lazy.tsx")));
  assert.ok(Object.keys(manifest).some((key) => key.endsWith("features/exam-authoring/routes/authoring.lazy.tsx")));
  assert.ok(Object.keys(manifest).some((key) => key.endsWith("features/exams/routes/exams.lazy.tsx")));
  assert.ok(Object.keys(manifest).some((key) => key.endsWith("features/results/routes/results.lazy.tsx")));
  assert.ok(Object.keys(manifest).some((key) => key.endsWith("features/accounts/routes/accounts.lazy.tsx")));
  assert.ok(Object.values(manifest).some(({ isEntry }) => isEntry));
  assert.ok(Object.values(manifest).filter(({ isDynamicEntry }) => isDynamicEntry).length >= 6);
  assert.ok(files.every((file) => !file.endsWith(".map")));
});

test("React pages remain behind the server route policy and generated asset allowlist", async () => {
  const server = createAppServer({
    authConfig: {
      adminUsername: "react-foundation-teacher",
      adminPassword: "react-foundation-password",
      sessionSecret: "react-foundation-session-secret-that-is-long-enough",
    },
  });

  await withFetchableServer(server, async (baseUrl) => {
    const loginPage = await fetch(`${baseUrl}/admin/login/`);
    assert.equal(loginPage.status, 200);
    const loginHtml = await loginPage.text();
    assert.match(loginHtml, /id="reactRoot"/);
    assert.doesNotMatch(loginHtml, /login-form|admin-route-loader/);

    const protectedPage = await fetch(`${baseUrl}/admin/dashboard/`, { redirect: "manual" });
    assert.equal(protectedPage.status, 302);
    assert.equal(protectedPage.headers.get("location"), "/admin/login/");
    const protectedExams = await fetch(`${baseUrl}/admin/exams/`, { redirect: "manual" });
    assert.equal(protectedExams.status, 302);
    const protectedRoom = await fetch(`${baseUrl}/admin/exams/ROOM001/room/`, { redirect: "manual" });
    assert.equal(protectedRoom.status, 302);
    assert.equal(protectedRoom.headers.get("location"), "/admin/login/");
    const protectedSystem = await fetch(`${baseUrl}/admin/system/`, { redirect: "manual" });
    assert.equal(protectedSystem.status, 302);

    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "react-foundation-teacher", password: "react-foundation-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const dashboard = await fetch(`${baseUrl}/admin/dashboard/`, { headers: { cookie } });
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /id="reactRoot"/);
    const authoring = await fetch(`${baseUrl}/admin/exams/new/`, { headers: { cookie } });
    assert.equal(authoring.status, 200);
    const authoringHtml = await authoring.text();
    assert.match(authoringHtml, /id="reactRoot"/);
    assert.doesNotMatch(authoringHtml, /id="login-view"/);
    const system = await fetch(`${baseUrl}/admin/system/`, { headers: { cookie } });
    assert.equal(system.status, 200);
    assert.match(await system.text(), /id="reactRoot"/);
    const exams = await fetch(`${baseUrl}/admin/exams/`, { headers: { cookie } });
    assert.equal(exams.status, 200);
    assert.match(await exams.text(), /id="reactRoot"/);
    const room = await fetch(`${baseUrl}/admin/exams/ROOM001/room/`, { headers: { cookie } });
    assert.equal(room.status, 200);
    assert.match(await room.text(), /id="reactRoot"/);
    const results = await fetch(`${baseUrl}/admin/results/`, { headers: { cookie } });
    assert.equal(results.status, 200);
    assert.match(await results.text(), /id="reactRoot"/);
    const accounts = await fetch(`${baseUrl}/admin/accounts/`, { headers: { cookie } });
    assert.equal(accounts.status, 200);
    assert.match(await accounts.text(), /id="reactRoot"/);

    const entryPath = loginHtml.match(/src="(\/admin\/react\/assets\/[^"]+\.js)"/)?.[1];
    assert.ok(entryPath);
    const entryAsset = await fetch(`${baseUrl}${entryPath}`);
    assert.equal(entryAsset.status, 200);
    assert.equal(entryAsset.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(entryAsset.headers.get("pragma"), null);
    assert.equal((await fetch(`${baseUrl}/admin/react/assets/not-generated.js`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/admin/react/.vite/manifest.json`)).status, 404);
  });
});

test("React page modules consume feature hooks rather than direct requests", async () => {
  const [loginRoute, systemRoute, systemHook, dashboardRoute, examsRoute, resultsRoute, accountsRoute, systemApi, resultsApi, accountsApi, httpClient] = await Promise.all([
    readFile(new URL("../src/client/features/auth/routes/login.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/system/routes/system.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/system/hooks/useSystemOverviewQueries.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/dashboard/routes/dashboard.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exams/routes/exams.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/results/routes/results.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/accounts/routes/accounts.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/system/api/systemApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/results/api/resultApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/accounts/api/accountApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/shared/api/httpClient.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(loginRoute, /\bfetch\s*\(/);
  assert.doesNotMatch(systemRoute, /\bfetch\s*\(|useEffect\s*\(/);
  assert.match(systemHook, /useQuery/);
  assert.doesNotMatch(dashboardRoute, /\bfetch\s*\(|useEffect\s*\(/);
  assert.doesNotMatch(examsRoute, /\bfetch\s*\(|useEffect\s*\(/);
  assert.match(examsRoute, /useDeferredValue/);
  assert.doesNotMatch(resultsRoute, /\bfetch\s*\(|useEffect\s*\(/);
  assert.match(resultsRoute, /useDeferredValue/);
  assert.doesNotMatch(accountsRoute, /\bfetch\s*\(|useEffect\s*\(/);
  assert.match(systemApi, /requestJson/);
  assert.match(resultsApi, /requestJson/);
  assert.match(accountsApi, /requestJson/);
  assert.match(httpClient, /\bfetch\s*\(/);
});

test("teacher workspace keeps one locale and only task-relevant operational metadata", async () => {
  const [shell, localeProvider, localeSelect, dashboard, operations] = await Promise.all([
    readFile(new URL("../src/client/app/layouts/AdminShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/shared/i18n/AdminLocaleProvider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/shared/i18n/AdminLocaleSelect.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/dashboard/routes/dashboard.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/dashboard/components/OperationsTable.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(shell, /storageMode|accessLabels|accessScope|ACADEMIC CONSOLE|navigationIndex/);
  assert.doesNotMatch(shell, /item\.code/);
  assert.match(shell, /getLocalizedSubjectName\(item, locale\)/);
  assert.match(shell, /useQuery\(\{[\s\S]*adminSessionQueryOptions\(\)[\s\S]*refetchOnWindowFocus:\s*"always"/);
  assert.doesNotMatch(shell, /refetchOnMount:\s*"always"/);
  assert.match(shell, /displaySubjects\.map/);
  assert.match(localeProvider, /adminLocaleOptions/);
  assert.match(localeSelect, /adminLocaleOptions\.map/);
  assert.doesNotMatch(localeProvider, /toggleLocale/);
  assert.doesNotMatch(dashboard, /TEACHER WORKSPACE|DAILY CONTROL|让考试运营|sectionIndex/);
  assert.doesNotMatch(operations, /A \/ OPERATIONS|operationCode|operationArrow|description/);
});

test("React asset publication refreshes after a watched Vite rebuild", async () => {
  const publicDirectory = await mkdtemp(path.join(tmpdir(), "react-asset-manifest-"));
  const reactDirectory = path.join(publicDirectory, "admin", "react");
  const assetDirectory = path.join(reactDirectory, "assets");
  const manifestDirectory = path.join(reactDirectory, ".vite");

  try {
    await Promise.all([
      mkdir(assetDirectory, { recursive: true }),
      mkdir(manifestDirectory, { recursive: true }),
    ]);
    await writeFile(path.join(assetDirectory, "first.js"), "export const version = 1;", "utf8");
    await writeFile(path.join(manifestDirectory, "manifest.json"), JSON.stringify({ index: { file: "assets/first.js" } }), "utf8");

    const server = createAppServer({ publicDirectory });
    await withFetchableServer(server, async (baseUrl) => {
      assert.equal((await fetch(`${baseUrl}/admin/react/assets/first.js`)).status, 200);

      await writeFile(path.join(assetDirectory, "second-build.js"), "export const version = 2;", "utf8");
      await writeFile(path.join(manifestDirectory, "manifest.json"), JSON.stringify({ index: { file: "assets/second-build.js" } }), "utf8");

      assert.equal((await fetch(`${baseUrl}/admin/react/assets/second-build.js`)).status, 200);
      assert.equal((await fetch(`${baseUrl}/admin/react/assets/first.js`)).status, 404);
    });
  } finally {
    await rm(publicDirectory, { force: true, recursive: true });
  }
});
