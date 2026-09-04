import assert from "node:assert/strict";
import test from "node:test";

import { validateDockerEnvironment } from "../scripts/validate-docker-environment.ts";

const validEnvironment = {
  ...process.env,
  POSTGRES_PASSWORD: "local_database_password_2026",
  SESSION_SECRET: "local-session-secret-that-is-longer-than-thirty-two-characters",
  CRON_SECRET: "local-cron-secret-that-is-separate-and-longer-than-thirty-two",
  BOOTSTRAP_ADMIN_PASSWORD: "local-admin-password-2026",
};

test("Docker environment validation accepts generated deployment secrets", () => {
  assert.doesNotThrow(() => validateDockerEnvironment(validEnvironment));
});

test("Docker environment validation rejects committed example placeholders", () => {
  assert.throws(
    () => validateDockerEnvironment({
      ...validEnvironment,
      SESSION_SECRET: "replace-with-a-random-session-secret-of-at-least-32-characters",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SESSION_SECRET still contains the example placeholder/);
      assert.doesNotMatch(error.message, /local_database_password_2026/);
      return true;
    },
  );
});
