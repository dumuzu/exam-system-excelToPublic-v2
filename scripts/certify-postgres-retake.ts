import assert from "node:assert/strict";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";
import { PostgresStudentExamRepository } from "../src/server/student-exam-repository.ts";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (process.env["CAPACITY_CERTIFICATION_CONFIRM"] !== "TEMPORARY_BRANCH_ONLY") {
  throw new Error("Retake certification changes test attempts. Use a temporary branch and set CAPACITY_CERTIFICATION_CONFIRM=TEMPORARY_BRANCH_ONLY.");
}

const repository: any = new PostgresStudentExamRepository({ connectionString, databasePoolMax: 4 });
const studentNumber = `RETAKE${Date.now().toString().slice(-8)}`;
let examCode: string | null = null;

try {
  const composition = composeExamPlan({ selectedFunctions: ["SUM"] });
  if (!composition.ok) throw new Error("RETAKE_CERTIFICATION_COMPOSITION_FAILED");
  const publicationAudit = auditExamPublication({ plan: composition.plan, warnings: composition.warnings });
  assert.equal(publicationAudit.ok, true, JSON.stringify(publicationAudit.errors));
  const exam = await repository.publishExam({
    title: "Retake certification",
    mode: "exam",
    selectedFunctions: ["SUM"],
    plan: composition.plan,
    publicationAudit,
    roster: [{ studentNumber, name: "Retake Certification" }],
    createdByLogin: "retake-certification",
  });
  examCode = exam.code;
  await repository.prepareNextBatch({ examCode, batchSize: 1 });
  await repository.verifyIdentity({ examCode, studentNumber });
  await repository.admitStudent({ examCode, studentNumber, approvedByLogin: "retake-certification" });

  const firstSession = `${examCode}:${studentNumber}:attempt-1`;
  const firstAttempt = await repository.startAttempt({
    examCode,
    studentNumber,
    sessionTokenHash: firstSession,
    browserPreflight: { fullscreen: true },
  });
  assert.equal(firstAttempt.status, "in_progress");
  assert.equal(firstAttempt.questions.length, 50);

  let suspension: any;
  for (const eventType of ["page_hidden", "fullscreen_exit", "long_blur"]) {
    suspension = (await repository.recordProctorEvent({
      examCode,
      studentNumber,
      sessionTokenHash: firstSession,
      eventType,
    })).suspension;
  }
  assert.equal(suspension.status, "suspended");
  await repository.authorizeResume({ examCode, studentNumber, authorizedByLogin: "retake-certification" });
  await repository.submitAttempt({
    examCode,
    studentNumber,
    sessionTokenHash: firstSession,
    submissionType: "manual",
  });

  const firstResult = (await repository.listResults(examCode)).find((item: any) => item.studentNumber === studentNumber);
  assert.equal(firstResult.warningCount, 3);
  assert.equal(firstResult.policySuspensionCount, 1);
  assert.equal(firstResult.policySubmissionCount, 0);
  assert.equal(firstResult.attemptStatus, "submitted");

  for (let attemptNumber = 2; attemptNumber <= 3; attemptNumber += 1) {
    const verification = await repository.verifyIdentity({ examCode, studentNumber });
    assert.equal(verification.status, "waiting_approval");
    await repository.admitStudent({ examCode, studentNumber, approvedByLogin: "retake-certification" });
    const sessionTokenHash = `${examCode}:${studentNumber}:attempt-${attemptNumber}`;
    const attempt = await repository.startAttempt({
      examCode,
      studentNumber,
      sessionTokenHash,
      browserPreflight: { fullscreen: true },
    });
    assert.equal(attempt.attemptNumber, attemptNumber);
    assert.deepEqual(attempt.questions, firstAttempt.questions);
    assert.deepEqual(attempt.answers.values, {});
    if (attemptNumber === 2) {
      await repository.submitAttempt({ examCode, studentNumber, sessionTokenHash, submissionType: "manual" });
    }
  }

  const attendance = (await repository.listAttendance(examCode)).find((item: any) => item.studentNumber === studentNumber);
  assert.equal(attendance.attemptCount, 3);
  const latestResult = (await repository.listResults(examCode)).find((item: any) => item.studentNumber === studentNumber);
  assert.equal(latestResult.warningCount, 3);
  assert.equal(latestResult.policySuspensionCount, 1);
  assert.equal(latestResult.policySubmissionCount, 0);
  assert.equal(latestResult.attemptCount, 3);

  console.log(JSON.stringify({
    examCode,
    studentNumber,
    attemptsCreated: 3,
    reusedOriginalPaper: true,
    warningCount: latestResult.warningCount,
    policySuspensionCount: latestResult.policySuspensionCount,
  }, null, 2));
} finally {
  if (examCode) {
    try {
      await repository.requestExamTermination({
        examCode,
        requestedByLogin: "retake-certification-cleanup",
        collectionSeconds: 3,
        now: new Date(Date.now() - 4_000),
      });
      let cleanup = await repository.terminateExam({
        examCode,
        terminatedByLogin: "retake-certification-cleanup",
      });
      while (!cleanup.completed) {
        cleanup = await repository.terminateExam({
          examCode,
          terminatedByLogin: "retake-certification-cleanup",
        });
      }
    } catch { /* best-effort cleanup on a temporary branch */ }
    try {
      await repository.deleteExam({ examCode, deletedByLogin: "retake-certification-cleanup" });
    } catch { /* branch deletion remains the final cleanup boundary */ }
  }
  await repository.close();
}
