import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import { createAppRequestHandler, createAppServer } from "../src/server/server.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

async function withServer(run: any) {
  const server: any = createAppServer({
    authConfig: {
      adminUsername: "admin",
      adminPassword: "test-password",
      sessionSecret: "test-session-secret-that-is-long-enough",
    },
  });
  await withFetchableServer(server, run);
}

async function withConfiguredServer(options: any, run: any) {
  const server: any = createAppServer({
    authConfig: {
      adminUsername: "admin",
      adminPassword: "test-password",
      sessionSecret: "test-session-secret-that-is-long-enough",
    },
    ...options,
  });
  await withFetchableServer(server, run);
}

test("shared request handler can be mounted by a serverless runtime", () => {
  const handler: any = createAppRequestHandler({
    authConfig: {
      adminUsername: "admin",
      adminPassword: "test-password",
      sessionSecret: "test-session-secret-that-is-long-enough",
    },
  });

  assert.equal(typeof handler, "function");
});

test("first valid legacy login activates a migration-pending database account", async () => {
  const legacyAccount = {
    username: "migration-admin",
    passwordHash: hashAdminPassword("legacy-password", { salt: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    role: ADMIN_ROLES.SUPER_ADMIN,
  };
  const repository = new InMemoryTeacherAccountRepository();
  const migrateLegacyAccounts = repository.migrateLegacyAccounts.bind(repository);
  let migrationCalls = 0;
  repository.migrateLegacyAccounts = async (accounts) => {
    migrationCalls += 1;
    return migrateLegacyAccounts(accounts);
  };

  await withConfiguredServer({
    authConfig: {
      accounts: [legacyAccount],
      sessionSecret: "legacy-migration-session-secret-long-enough",
    },
    teacherAccountRepository: repository,
  }, async (baseUrl: string) => {
    const response = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "migration-admin", password: "legacy-password" }),
    });

    assert.equal(response.status, 200);
    assert.equal(migrationCalls, 1);
    assert.equal((await repository.findAuthenticationAccount("migration-admin"))?.status, "active");
  });
});

test("legacy login compatibility never overwrites an active database credential", async () => {
  const legacyAccount = {
    username: "durable-admin",
    passwordHash: hashAdminPassword("old-environment-password", { salt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    role: ADMIN_ROLES.SUPER_ADMIN,
  };
  const repository = new InMemoryTeacherAccountRepository({
    legacyAccounts: [{
      ...legacyAccount,
      passwordHash: hashAdminPassword("new-database-password", { salt: "cccccccccccccccccccccccccccccccc" }),
    }],
  });
  const migrateLegacyAccounts = repository.migrateLegacyAccounts.bind(repository);
  let migrationCalls = 0;
  repository.migrateLegacyAccounts = async (accounts) => {
    migrationCalls += 1;
    return migrateLegacyAccounts(accounts);
  };

  await withConfiguredServer({
    authConfig: {
      accounts: [legacyAccount],
      sessionSecret: "durable-account-session-secret-long-enough",
    },
    teacherAccountRepository: repository,
  }, async (baseUrl: string) => {
    const staleLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "durable-admin", password: "old-environment-password" }),
    });
    assert.equal(staleLogin.status, 401);
    assert.equal(migrationCalls, 0);

    const durableLogin = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "durable-admin", password: "new-database-password" }),
    });
    assert.equal(durableLogin.status, 200);
    assert.equal(migrationCalls, 0);
  });
});

test("admin preview endpoint requires an authenticated session", async () => {
  await withServer(async (baseUrl: any) => {
    const response: any = await fetch(`${baseUrl}/api/admin/exam-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedFunctions: ["SUM"],
      }),
    });

    assert.equal(response.status, 401);
  });
});

test("attempt expiry worker requires the server task secret", async () => {
  let calls: any = 0;
  const studentExamRepository: any = {
    async submitExpiredAttempts({ limit }: any) {
      calls += 1;
      assert.equal(limit, 25);
      return { scannedCount: 2, submittedCount: 2, failedCount: 0 };
    },
  };
  const server: any = createAppServer({
    authConfig: {
      adminUsername: "admin",
      adminPassword: "test-password",
      sessionSecret: "test-session-secret-that-is-long-enough",
    },
    studentExamRepository,
    internalTaskSecret: "a-server-task-secret-with-at-least-32-characters",
  });

  await withFetchableServer(server, async (baseUrl) => {
    const denied: any = await fetch(`${baseUrl}/api/internal/attempt-expiry`, { method: "POST" });
    assert.equal(denied.status, 401);

    const accepted: any = await fetch(`${baseUrl}/api/internal/attempt-expiry`, {
      method: "POST",
      headers: { authorization: "Bearer a-server-task-secret-with-at-least-32-characters", "content-type": "application/json" },
      body: JSON.stringify({ limit: 25 }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { scannedCount: 2, submittedCount: 2, failedCount: 0 });
    assert.equal(calls, 1);
  });
});

test("server separates student and administrator pages with browser safety headers", async () => {
  await withServer(async (baseUrl: any) => {
    const rootResponse: any = await fetch(`${baseUrl}/`, { redirect: "manual" });
    assert.equal(rootResponse.status, 302);
    assert.equal(rootResponse.headers.get("location"), "/exam/");

    const examResponse: any = await fetch(`${baseUrl}/exam/`);
    const studentLocalizationResponse: any = await fetch(`${baseUrl}/exam/student-localization.js`);
    const adminResponse: any = await fetch(`${baseUrl}/admin/`);
    const retiredAdminAssetResponses: any = await Promise.all([
      "/admin/room-selection.js",
      "/admin/room-shell.js",
      "/admin/room.css",
      "/admin/room.js",
      "/admin/admin-route-loader.js",
      "/admin/admin-route-manifest.generated.js",
      "/admin/admin-login.js",
      "/admin/admin-shared.js",
      "/admin/admin.css",
      "/admin/admin.js",
    ].map((pathname) => fetch(`${baseUrl}${pathname}`)));
    const healthResponse: any = await fetch(`${baseUrl}/api/health`);

    assert.equal(examResponse.status, 200);
    assert.equal(studentLocalizationResponse.status, 200);
    assert.match(studentLocalizationResponse.headers.get("content-type"), /javascript/);
    assert.equal(adminResponse.status, 200);
    assert.equal(retiredAdminAssetResponses.every((asset: Response) => asset.status === 404), true);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "ok" });
    assert.match(examResponse.headers.get("content-type"), /text\/html/);
    assert.match(examResponse.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(examResponse.headers.get("content-security-policy"), /object-src 'none'/);
    assert.equal(examResponse.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(examResponse.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(examResponse.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
    assert.match(await examResponse.text(), /id="preflight-list"/);
    const adminHtml: any = await adminResponse.text();
    assert.match(adminHtml, /id="reactRoot"/);
    assert.match(adminHtml, /\/admin\/react\/assets\//);
  });
});

test("static publishing rejects hidden files, source maps and unknown file types", async (t) => {
  const publicDirectory: any = await mkdtemp(path.join(os.tmpdir(), "exam-public-"));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await mkdir(path.join(publicDirectory, "exam"), { recursive: true });
  await writeFile(path.join(publicDirectory, "exam", "index.html"), "<!doctype html><title>Exam</title>");
  await writeFile(path.join(publicDirectory, ".env"), "SESSION_SECRET=must-not-be-served");
  await writeFile(path.join(publicDirectory, "client.js.map"), "{\"sources\":[\"private-source.js\"]}");
  await writeFile(path.join(publicDirectory, "server.mjs"), "export const secret: any = true;");
  await writeFile(path.join(publicDirectory, "private.txt"), "must-not-be-served");

  await withConfiguredServer({ publicDirectory }, async (baseUrl: any) => {
    const allowed: any = await fetch(`${baseUrl}/exam/`);
    assert.equal(allowed.status, 200);

    for (const pathname of ["/.env", "/client.js.map", "/server.mjs", "/private.txt"]) {
      const response: any = await fetch(`${baseUrl}${pathname}`);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), "Not found");
    }
  });
});

test("page routes handle HEAD probes without bypassing redirects or failing on directories", async () => {
  await withServer(async (baseUrl: any) => {
    const rootResponse: any = await fetch(`${baseUrl}/`, { method: "HEAD", redirect: "manual" });
    const adminResponse: any = await fetch(`${baseUrl}/admin/`, { method: "HEAD", redirect: "manual" });
    const dashboardResponse: any = await fetch(`${baseUrl}/admin/dashboard/`, { method: "HEAD", redirect: "manual" });

    assert.equal(rootResponse.status, 302);
    assert.equal(rootResponse.headers.get("location"), "/exam/");
    assert.equal(adminResponse.status, 302);
    assert.equal(adminResponse.headers.get("location"), "/admin/login/");
    assert.equal(dashboardResponse.status, 302);
    assert.equal(dashboardResponse.headers.get("location"), "/admin/login/");
  });
});

test("administrator routes redirect according to the verified server session", async () => {
  await withServer(async (baseUrl: any) => {
    const anonymous: any = await fetch(`${baseUrl}/admin/`, { redirect: "manual" });
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get("location"), "/admin/login/");

    const login: any = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-password" }),
    });
    const cookie: any = login.headers.getSetCookie().map((value: any) => value.split(";", 1)[0]).join("; ");

    const authenticated: any = await fetch(`${baseUrl}/admin/login/`, { redirect: "manual", headers: { cookie } });
    assert.equal(authenticated.status, 302);
    assert.equal(authenticated.headers.get("location"), "/admin/system/");

    const system: any = await fetch(`${baseUrl}/admin/system/`, { headers: { cookie } });
    assert.equal(system.status, 200);
    const systemDocument = await system.text();
    assert.match(systemDocument, /id="reactRoot"/);
    assert.match(systemDocument, /<script type="module"/);

    const dashboard: any = await fetch(`${baseUrl}/admin/dashboard/`, { headers: { cookie } });
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /id="reactRoot"/);

    const authoring: any = await fetch(`${baseUrl}/admin/exams/new/`, { headers: { cookie } });
    assert.equal(authoring.status, 200);
    assert.match(await authoring.text(), /id="reactRoot"/);

    for (const route of ["/admin/exams/new/", "/admin/exams/", "/admin/results/"]) {
      const protectedPage: any = await fetch(`${baseUrl}${route}`, { headers: { cookie } });
      assert.equal(protectedPage.status, 200);
    }
  });
});

test("server normalises injected capacity policies before reading request bodies", async () => {
  await withConfiguredServer(
    {
      capacityPolicy: { maxRequestBodyBytes: undefined },
    },
    async (baseUrl: any) => {
      const response: any = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "x".repeat(70 * 1024) }),
      });

      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), {
        error: "Request body is too large.",
        code: "REQUEST_BODY_TOO_LARGE",
      });
    },
  );
});

test("public health endpoint reports readiness without exposing infrastructure details", async () => {
  const historyRepository: any = {
    storageMode: "postgres",
    async checkHealth() {
      const error: any = new Error("Database is not initialized.");
      error.code = "DATABASE_NOT_INITIALIZED";
      throw error;
    },
  };

  await withConfiguredServer({ historyRepository }, async (baseUrl: any) => {
    const response: any = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 503);
    const body: any = await response.json();
    assert.deepEqual(body, { status: "degraded" });
    assert.doesNotMatch(JSON.stringify(body), /database|postgres|migration|excel-web-exam-system/i);
  });
});
