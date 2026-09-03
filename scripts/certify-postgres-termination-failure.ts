import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";
import { PostgresStudentExamRepository } from "../src/server/student-exam-repository.ts";

interface QueryResult { rows: any[] }
interface AuditPoolLike { query(text: string, values?: readonly unknown[]): Promise<QueryResult>; end(): Promise<void> }
const require = createRequire(import.meta.url);
const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => AuditPoolLike };

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (process.env["CAPACITY_CERTIFICATION_CONFIRM"] !== "TEMPORARY_BRANCH_ONLY") {
  throw new Error("This certification mutates test data. Use a temporary branch and set CAPACITY_CERTIFICATION_CONFIRM=TEMPORARY_BRANCH_ONLY.");
}

const repository: any = new PostgresStudentExamRepository({ connectionString, databasePoolMax: 2 });
const auditPool = new Pool({ connectionString, max: 1 });
const studentNumber = `FAIL${Date.now().toString().slice(-8)}`;
const sessionTokenHash = `termination-failure:${studentNumber}`;
let examCode: string | null = null;
let attemptId: string | null = null;
let answerBackup: any = null;

try {
  const composition = composeExamPlan({ selectedFunctions: ["SUM"] });
  if (!composition.ok) throw new Error("TERMINATION_CERTIFICATION_COMPOSITION_FAILED");
  const publicationAudit = auditExamPublication({ plan: composition.plan, warnings: composition.warnings });
  assert.equal(publicationAudit.ok, true);
  const exam = await repository.publishExam({
    title: "Termination failure certification",
    mode: "exam",
    selectedFunctions: ["SUM"],
    plan: composition.plan,
    publicationAudit,
    roster: [{ studentNumber, name: "Failure Certification" }],
    createdByLogin: "failure-certification",
  });
  examCode = exam.code;
  await repository.prepareNextBatch({ examCode, batchSize: 1 });
  await repository.verifyIdentity({ examCode, studentNumber });
  await repository.admitStudent({ examCode, studentNumber, approvedByLogin: "failure-certification" });
  const attempt = await repository.startAttempt({ examCode, studentNumber, sessionTokenHash, browserPreflight: { fullscreen: true } });
  attemptId = attempt.id;
  await repository.saveAnswer({ examCode, studentNumber, sessionTokenHash, questionKey: attempt.questions[0].key, formula: "=SUM(A2:A6)", expectedVersion: 0 });
  answerBackup = (await auditPool.query("SELECT * FROM answers WHERE attempt_id=$1", [attemptId])).rows[0];
  assert.ok(answerBackup);

  await repository.requestExamTermination({ examCode, requestedByLogin: "failure-certification", collectionSeconds: 3, now: new Date(Date.now() - 4_000) });
  await auditPool.query("DELETE FROM answers WHERE attempt_id=$1", [attemptId]);
  const failed = await repository.terminateExam({ examCode, terminatedByLogin: "failure-certification" });
  assert.equal(failed.completed, false);
  assert.equal(failed.failedSubmissionCount, 1);
  assert.equal(failed.pendingSubmissionCount, 1);
  const failures = await repository.listTerminationFailures(examCode);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].attemptId, attemptId);
  assert.equal(failures[0].errorCode, "PAPER_NOT_PREPARED");

  await auditPool.query(
    `INSERT INTO answers (attempt_id,answer_payload,version,client_saved_at,server_saved_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [attemptId, answerBackup.answer_payload, answerBackup.version, answerBackup.client_saved_at, answerBackup.server_saved_at, answerBackup.updated_at],
  );
  const retried = await repository.retryTerminationAttempt({ examCode, attemptId, retriedByLogin: "failure-certification" });
  assert.equal(retried.completed, true);
  assert.equal(retried.pendingSubmissionCount, 0);
  assert.deepEqual(await repository.listTerminationFailures(examCode), []);
  const result = (await repository.listResults(examCode))[0];
  assert.equal(result.attemptStatus, "teacher_submitted");
  const ledger = await auditPool.query("SELECT COUNT(*)::integer AS count,MAX(version)::integer AS latest FROM schema_migrations");
  assert.ok(ledger.rows[0].count > 0);
  assert.equal(ledger.rows[0].count, ledger.rows[0].latest, "The migration ledger must be contiguous from version 1.");

  process.stdout.write(`${JSON.stringify({
    examCode,
    attemptId,
    failureRecorded: true,
    retryCompleted: true,
    latestMigration: ledger.rows[0].latest,
  })}\n`);
} finally {
  if (examCode) {
    if (attemptId && answerBackup) {
      try {
        await auditPool.query(
          `INSERT INTO answers (attempt_id,answer_payload,version,client_saved_at,server_saved_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (attempt_id) DO NOTHING`,
          [attemptId, answerBackup.answer_payload, answerBackup.version, answerBackup.client_saved_at, answerBackup.server_saved_at, answerBackup.updated_at],
        );
      } catch { /* temporary branch cleanup is completed by deleting the branch */ }
    }
    try {
      await repository.requestExamTermination({ examCode, requestedByLogin: "failure-certification-cleanup", collectionSeconds: 3, now: new Date(Date.now() - 4_000) });
      let cleanup = await repository.terminateExam({ examCode, terminatedByLogin: "failure-certification-cleanup" });
      while (!cleanup.completed) cleanup = await repository.terminateExam({ examCode, terminatedByLogin: "failure-certification-cleanup" });
    } catch { /* temporary branch cleanup is completed by deleting the branch */ }
    try { await repository.deleteExam({ examCode, deletedByLogin: "failure-certification-cleanup" }); } catch { /* temporary branch cleanup is completed by deleting the branch */ }
  }
  await auditPool.end();
  await repository.close();
}
