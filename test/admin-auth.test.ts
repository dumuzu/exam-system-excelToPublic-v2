import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  createAdminSession,
  createLoginRateLimiter,
  getAuthConfigFromEnvironment,
  hashAdminPassword,
  hasAdminPermission,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  verifyAdminCredentials,
  verifyPersistedAdminCredentials,
  verifyPersistedAdminSession,
  verifyAdminSession,
} from "../src/server/admin-auth.ts";

test("login limiter evicts the oldest tracked key when its capacity is reached", () => {
  const limiter: any = createLoginRateLimiter({
    limit: 1,
    windowMilliseconds: 60_000,
    maxTrackedKeys: 2,
  });

  assert.equal(limiter.check("first").allowed, true);
  assert.equal(limiter.check("second").allowed, true);
  assert.equal(limiter.check("third").allowed, true);

  // "first" was the oldest entry and was evicted to keep the local Map bounded.
  assert.equal(limiter.check("first").allowed, true);
});

test("administrator session cookies cover both API calls and protected page routes", () => {
  assert.match(serializeSessionCookie("signed-session"), /Path=\//);
  assert.match(serializeExpiredSessionCookie(), /Path=\//);
});

test("multi-account authentication preserves the role and enforces the permission matrix", () => {
  const authConfig: any = {
    sessionSecret: "test-session-secret-that-is-long-enough",
    accounts: [
      {
        username: "supervisor",
        passwordHash: hashAdminPassword("strong-password", { salt: "0123456789abcdef0123456789abcdef" }),
        role: ADMIN_ROLES.SUPER_ADMIN,
      },
      {
        username: "teacher",
        passwordHash: hashAdminPassword("teacher-password", { salt: "abcdef0123456789abcdef0123456789" }),
        role: ADMIN_ROLES.ASSISTANT_TEACHER,
      },
    ],
  };

  const supervisor: any = verifyAdminCredentials({ username: "supervisor", password: "strong-password" }, authConfig);
  const teacher: any = verifyAdminCredentials({ username: "teacher", password: "teacher-password" }, authConfig);

  assert.deepEqual(supervisor, { username: "supervisor", role: ADMIN_ROLES.SUPER_ADMIN });
  assert.deepEqual(teacher, { username: "teacher", role: ADMIN_ROLES.ASSISTANT_TEACHER });
  assert.equal(verifyAdminCredentials({ username: "teacher", password: "wrong" }, authConfig), null);

  const created: any = createAdminSession({ account: teacher, sessionSecret: authConfig.sessionSecret });
  const session: any = verifyAdminSession(created.token, authConfig);
  assert.equal(session.role, ADMIN_ROLES.ASSISTANT_TEACHER);
  assert.equal(hasAdminPermission(session, ADMIN_PERMISSIONS.MANAGE_ADMISSION), true);
  assert.equal(hasAdminPermission(session, ADMIN_PERMISSIONS.COMPOSE_EXAM), false);
  assert.equal(hasAdminPermission(session, ADMIN_PERMISSIONS.VIEW_RESULTS), false);
  assert.equal(hasAdminPermission(session, ADMIN_PERMISSIONS.DELETE_EXAM), false);
  assert.equal(verifyAdminSession(created.token, { ...authConfig, accounts: [authConfig.accounts[0]] }), null);
});

test("test administrators can exercise every permission in an isolated environment", () => {
  const session: any = { role: ADMIN_ROLES.TEST_ADMIN };

  for (const permission of Object.values(ADMIN_PERMISSIONS)) {
    assert.equal(hasAdminPermission(session, permission), true, permission);
  }
});

test("environment configuration keeps the test account disabled unless explicitly enabled", () => {
  const accounts: any = [
    { username: "super", passwordHash: hashAdminPassword("super-pass", { salt: "44444444444444444444444444444444" }), role: ADMIN_ROLES.SUPER_ADMIN },
    { username: "admin", passwordHash: hashAdminPassword("test-pass", { salt: "55555555555555555555555555555555" }), role: ADMIN_ROLES.TEST_ADMIN },
  ];
  const baseEnvironment: any = {
    SESSION_SECRET: "test-session-secret-that-is-long-enough",
    ADMIN_ACCOUNTS_JSON: JSON.stringify(accounts),
  };

  assert.deepEqual(
    getAuthConfigFromEnvironment(baseEnvironment)!.accounts!.map((account) => account.username),
    ["super"],
  );
  assert.deepEqual(
    getAuthConfigFromEnvironment({ ...baseEnvironment, ENABLE_TEST_ADMIN: "true" })!.accounts!.map((account) => account.username),
    ["super", "admin"],
  );
});

test("durable authentication rejects invalid and disabled accounts with one public result", async () => {
  const activeHash: any = hashAdminPassword("active-password", { salt: "66666666666666666666666666666666" });
  const disabledHash: any = hashAdminPassword("disabled-password", { salt: "77777777777777777777777777777777" });
  const accounts: any = new Map([
    ["active", { id: "account-active", username: "active", displayName: "Active", passwordHash: activeHash, role: ADMIN_ROLES.TEACHER, status: "active", credentialVersion: 3, sessionVersion: 4 }],
    ["disabled", { id: "account-disabled", username: "disabled", displayName: "Disabled", passwordHash: disabledHash, role: ADMIN_ROLES.TEACHER, status: "disabled", credentialVersion: 1, sessionVersion: 2 }],
  ]);
  const repository: any = {
    findAuthenticationAccount: async (username: any) => accounts.get(username.toLowerCase()) ?? null,
  };

  assert.deepEqual(
    await verifyPersistedAdminCredentials({ username: "active", password: "active-password" }, repository),
    { accountId: "account-active", username: "active", role: ADMIN_ROLES.TEACHER, credentialVersion: 3, sessionVersion: 4 },
  );
  assert.equal(await verifyPersistedAdminCredentials({ username: "active", password: "wrong" }, repository), null);
  assert.equal(await verifyPersistedAdminCredentials({ username: "disabled", password: "disabled-password" }, repository), null);
  assert.equal(await verifyPersistedAdminCredentials({ username: "missing", password: "anything" }, repository), null);
});

test("durable sessions are revoked after password or role version changes", async () => {
  const authConfig: any = { sessionSecret: "durable-session-secret-that-is-long-enough" };
  const account: any = {
    accountId: "account-1",
    username: "teacher-one",
    role: ADMIN_ROLES.TEACHER,
    credentialVersion: 2,
    sessionVersion: 5,
  };
  const created: any = createAdminSession({ account, sessionSecret: authConfig.sessionSecret });
  let persisted: any = { id: account.accountId, username: account.username, role: account.role, status: "active", credentialVersion: 2, sessionVersion: 5 };
  const repository: any = { findSessionAccount: async () => persisted };

  assert.equal((await verifyPersistedAdminSession(created.token, authConfig, repository))!.sub, "teacher-one");
  persisted = { ...persisted, sessionVersion: 6 };
  assert.equal(await verifyPersistedAdminSession(created.token, authConfig, repository), null);
  persisted = { ...persisted, sessionVersion: 5, credentialVersion: 3 };
  assert.equal(await verifyPersistedAdminSession(created.token, authConfig, repository), null);
  persisted = { ...persisted, credentialVersion: 2, role: ADMIN_ROLES.SUPER_ADMIN };
  assert.equal(await verifyPersistedAdminSession(created.token, authConfig, repository), null);
});
