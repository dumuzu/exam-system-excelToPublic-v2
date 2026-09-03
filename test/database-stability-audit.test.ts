import assert from "node:assert/strict";
import test from "node:test";

import { assessDatabaseStability } from "../src/server/database-stability-audit.ts";

test("database stability audit requires a contiguous migration ledger and zero structural anomalies", () => {
  const healthy: any = assessDatabaseStability({
    migrationFiles: ["001_initial.sql", "002_second.sql"],
    ledgerRows: [
      { version: 1, filename: "001_initial.sql" },
      { version: 2, filename: "002_second.sql" },
    ],
    anomalyRow: {
      expired_active_sessions: 0,
      duplicate_open_attempts: 0,
      session_identity_mismatches: 0,
      suspension_state_mismatches: 0,
      unresolved_failures_without_open_attempt: 0,
    },
  });
  assert.equal(healthy.ok, true);
  assert.deepEqual(healthy.problems, []);

  const broken: any = assessDatabaseStability({
    migrationFiles: ["001_initial.sql", "002_second.sql", "003_third.sql"],
    ledgerRows: [
      { version: 1, filename: "001_initial.sql" },
      { version: 3, filename: "003_wrong_name.sql" },
    ],
    anomalyRow: { expired_active_sessions: "2", duplicate_open_attempts: 1 },
  });
  assert.equal(broken.ok, false);
  assert.match(broken.problems.join("\n"), /missing migration 002_second[.]sql/);
  assert.match(broken.problems.join("\n"), /filename mismatch for version 3/);
  assert.match(broken.problems.join("\n"), /expired_active_sessions=2/);
});
