import assert from "node:assert/strict";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";
import { PostgresStudentExamRepository } from "../src/server/student-exam-repository.ts";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (process.env["CAPACITY_CERTIFICATION_CONFIRM"] !== "TEMPORARY_BRANCH_ONLY") {
  throw new Error("This certification creates and deletes test data. Use a temporary branch and set CAPACITY_CERTIFICATION_CONFIRM=TEMPORARY_BRANCH_ONLY.");
}

const repository: any = new PostgresStudentExamRepository({ connectionString, databasePoolMax: 4 });
const studentNumber = `CERT${Date.now().toString().slice(-8)}`;
let examCode: string | null = null;

try {
  const composition = composeExamPlan({ selectedFunctions: ["SUM"] });
  if (!composition.ok) throw new Error("POLICY_CERTIFICATION_COMPOSITION_FAILED");
  const publicationAudit = auditExamPublication({ plan: composition.plan, warnings: composition.warnings });
  assert.equal(publicationAudit.ok, true, JSON.stringify(publicationAudit.errors));
  const exam = await repository.publishExam({
    title: "Policy suspension certification",
    mode: "exam",
    selectedFunctions: ["SUM"],
    plan: composition.plan,
    publicationAudit,
    roster: [{ studentNumber, name: "Certification Student" }],
    createdByLogin: "policy-certification",
  });
  examCode = exam.code;
  await repository.prepareNextBatch({ examCode, batchSize: 1 });
  await repository.verifyIdentity({ examCode, studentNumber });
  await repository.admitStudent({ examCode, studentNumber, approvedByLogin: "policy-certification" });
  const sessionTokenHash = `${examCode}:${studentNumber}:session`;
  const attempt = await repository.startAttempt({
    examCode,
    studentNumber,
    sessionTokenHash,
    browserPreflight: { fullscreen: true },
  });
  await repository.saveAnswer({
    examCode,
    studentNumber,
    sessionTokenHash,
    questionKey: attempt.questions[0].key,
    formula: "=SUM(A2:A6)",
    expectedVersion: 0,
  });

  let suspension: any;
  for (const eventType of ["page_hidden", "fullscreen_exit", "copy_blocked"]) {
    suspension = (await repository.recordProctorEvent({ examCode, studentNumber, sessionTokenHash, eventType })).suspension;
  }
  assert.equal(suspension.status, "suspended");
  assert.equal((await repository.listAttendance(examCode))[0].status, "policy_suspended");

  const resumed = await repository.authorizeResume({ examCode, studentNumber, authorizedByLogin: "policy-certification" });
  assert.equal(resumed.status, "in_progress");
  assert.equal((await repository.getAttempt({ examCode, studentNumber, sessionTokenHash })).answers.values[attempt.questions[0].key], "=SUM(A2:A6)");

  const collection = await repository.requestExamTermination({ examCode, requestedByLogin: "policy-certification", collectionSeconds: 3, now: new Date(Date.now() - 4_000) });
  assert.ok(collection.collectUntil);
  let terminated = await repository.terminateExam({ examCode, terminatedByLogin: "policy-certification" });
  while (!terminated.completed) terminated = await repository.terminateExam({ examCode, terminatedByLogin: "policy-certification" });
  assert.equal(terminated.teacherSubmittedCount, 1);
  const result = (await repository.listResults(examCode))[0];
  assert.equal(result.attemptStatus, "teacher_submitted");
  assert.equal(result.policySuspensionCount, 1);
  assert.equal(result.forcedSubmissionCount, 1);
  assert.equal(result.warningCount, 3);

  console.log(JSON.stringify({ examCode, studentNumber, status: result.attemptStatus, warnings: result.warningCount, suspensions: result.policySuspensionCount, teacherCollections: result.forcedSubmissionCount }));
} finally {
  if (examCode) {
    try {
      await repository.requestExamTermination({ examCode, requestedByLogin: "policy-certification-cleanup", collectionSeconds: 3, now: new Date(Date.now() - 4_000) });
      let cleanup = await repository.terminateExam({ examCode, terminatedByLogin: "policy-certification-cleanup" });
      while (!cleanup.completed) cleanup = await repository.terminateExam({ examCode, terminatedByLogin: "policy-certification-cleanup" });
    } catch { /* best-effort cleanup on a temporary branch */ }
    try { await repository.deleteExam({ examCode, deletedByLogin: "policy-certification-cleanup" }); } catch { /* branch deletion remains the final cleanup boundary */ }
  }
  await repository.close();
}
