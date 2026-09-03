import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessDatabaseStability } from "../src/server/database-stability-audit.ts";
import type { MigrationLedgerRow } from "../src/server/database-stability-audit.ts";

interface QueryResult { rows: Array<Record<string, unknown>> }
interface PoolLike {
  query(text: string): Promise<QueryResult>;
  end(): Promise<void>;
}
const require = createRequire(import.meta.url);
const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => PoolLike };
const connectionString = process.env["MIGRATION_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationFiles = (await readdir(path.join(projectRoot, "db", "migrations")))
  .filter((filename) => /^[0-9]{3}_[a-z0-9_]+[.]sql$/.test(filename))
  .sort();

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const [ledger, anomalies] = await Promise.all([
    pool.query("SELECT version,filename FROM schema_migrations ORDER BY version"),
    pool.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM active_sessions WHERE status='active' AND expires_at<=CURRENT_TIMESTAMP) AS expired_active_sessions,
         (SELECT COUNT(*)::integer FROM (
            SELECT exam_id,student_id FROM attempts
            WHERE status IN ('waiting','in_progress','policy_suspended')
            GROUP BY exam_id,student_id HAVING COUNT(*)>1
          ) duplicate_open) AS duplicate_open_attempts,
         (SELECT COUNT(*)::integer FROM active_sessions session
            INNER JOIN attempts attempt ON attempt.id=session.attempt_id
            WHERE session.exam_id<>attempt.exam_id OR session.student_id<>attempt.student_id) AS session_identity_mismatches,
         (SELECT COUNT(*)::integer FROM attempts attempt
            WHERE (attempt.status='policy_suspended') <>
              EXISTS (SELECT 1 FROM attempt_policy_suspensions suspension
                      WHERE suspension.attempt_id=attempt.id AND suspension.status='suspended')) AS suspension_state_mismatches,
         (SELECT COUNT(*)::integer FROM exam_termination_failures failure
            INNER JOIN attempts attempt ON attempt.id=failure.attempt_id
            WHERE failure.resolved_at IS NULL
              AND attempt.status NOT IN ('in_progress','policy_suspended')) AS unresolved_failures_without_open_attempt,
         (SELECT COUNT(*)::integer FROM exam_termination_runs run
            WHERE run.status='completed' AND EXISTS (
              SELECT 1 FROM attempts attempt
              WHERE attempt.exam_id=run.exam_id AND attempt.status IN ('in_progress','policy_suspended')
            )) AS completed_termination_runs_with_open_attempts,
         (SELECT COUNT(*)::integer FROM exams exam
            INNER JOIN exam_preparation_runs run ON run.exam_id=exam.id AND run.status='ready'
            WHERE exam.exam_mode='assignment'
              AND run.generator_version='deterministic-v3-bilingual'
              AND (SELECT COUNT(*) FROM assignment_shared_question_instances shared WHERE shared.exam_id=exam.id)
                <> run.planned_question_count) AS ready_assignment_shared_paper_mismatches,
         (SELECT COUNT(DISTINCT shared.exam_id)::integer
            FROM assignment_shared_question_instances shared
            INNER JOIN exams exam ON exam.id=shared.exam_id
            WHERE exam.exam_mode<>'assignment') AS formal_exams_with_shared_papers,
         (SELECT COUNT(*)::integer FROM exam_roster roster
            WHERE roster.roster_name IS NULL
              OR btrim(roster.roster_name)=''
              OR char_length(roster.roster_name)>100) AS roster_name_snapshot_mismatches`,
    ),
  ]);
  const report = assessDatabaseStability({
    migrationFiles,
    ledgerRows: ledger.rows as unknown as MigrationLedgerRow[],
    anomalyRow: anomalies.rows[0] ?? {},
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
} finally {
  await pool.end();
}
