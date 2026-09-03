import assert from "node:assert/strict";
import test from "node:test";

import { createAppServer } from "../src/server/server.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

test("initialization example: the application starts and reports readiness", async () => {
  const server: any = createAppServer({
    authConfig: {
      adminUsername: "example-admin",
      adminPassword: "example-test-password",
      sessionSecret: "example-session-secret-that-is-long-enough",
    },
  });

  await withFetchableServer(server, async (baseUrl) => {
    const response: any = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});
