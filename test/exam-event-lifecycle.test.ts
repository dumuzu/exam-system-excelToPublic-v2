import assert from "node:assert/strict";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { createExamCode, InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";

test("new exam codes are short, readable and collision resistant for a school-sized batch", () => {
  const codes: any = new Set(Array.from({ length: 1_000 }, () => createExamCode()));
  assert.equal(codes.size, 1_000);
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{7}$/);
});

async function preparedExam() {
  const repository: any = new InMemoryStudentExamRepository();
  const plan: any = composeExamPlan({ selectedFunctions: ["SUM"] }).plan;
  const exam: any = await repository.publishExam({
    title: "Lifecycle",
    mode: "exam",
    selectedFunctions: ["SUM"],
    plan,
    roster: [{ studentNumber: "S001", name: "Student" }],
    createdByLogin: "super",
  });
  await repository.prepareNextBatch({ examCode: exam.code, batchSize: 1 });
  return { repository, exam };
}

async function preparedAssignment() {
  const repository: any = new InMemoryStudentExamRepository();
  const plan: any = composeExamPlan({ mode: "assignment", selectedFunctions: ["SUM"] }).plan;
  const exam: any = await repository.publishExam({
    title: "Assignment lifecycle",
    mode: "assignment",
    selectedFunctions: ["SUM"],
    plan,
    roster: [{ studentNumber: "S001", name: "Student" }],
    createdByLogin: "super",
  });
  await repository.prepareNextBatch({ examCode: exam.code, batchSize: 1 });
  return { repository, exam };
}

test("terminating an event requires the collection window and automatically submits active attempts", async () => {
  const { repository, exam } = await preparedExam();
  const startedAt: any = new Date("2026-07-21T01:00:00.000Z");
  await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S001", now: startedAt });
  await repository.admitStudent({ examCode: exam.code, studentNumber: "S001" });
  await repository.startAttempt({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "active-session",
    browserPreflight: { fullscreen: true },
    now: startedAt,
  });

  await repository.requestExamTermination({ examCode: exam.code, requestedByLogin: "super", now: startedAt, collectionSeconds: 8 });
  await assert.rejects(
    repository.terminateExam({ examCode: exam.code, terminatedByLogin: "super", now: new Date("2026-07-21T01:00:07.000Z") }),
    (error: any) => error.code === "COLLECTION_WINDOW_ACTIVE",
  );
  const terminated: any = await repository.terminateExam({ examCode: exam.code, terminatedByLogin: "super", now: new Date("2026-07-21T01:00:08.000Z") });
  assert.equal(terminated.state, "closed");
  assert.equal(terminated.completed, true);
  assert.equal(terminated.autoSubmittedCount, 1);
  assert.equal((await repository.listResults(exam.code))[0].gradingStatus, "graded");
  assert.equal(await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S001" }), null);
});

test("room collection gives online students a final sync window before teacher submission", async () => {
  const { repository, exam } = await preparedExam();
  const startedAt: any = new Date("2026-07-21T01:00:00.000Z");
  await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S001", now: startedAt });
  await repository.admitStudent({ examCode: exam.code, studentNumber: "S001" });
  const attempt: any = await repository.startAttempt({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "collection-session",
    browserPreflight: { fullscreen: true },
    now: startedAt,
  });

  const collection: any = await repository.requestExamTermination({
    examCode: exam.code,
    requestedByLogin: "super",
    now: new Date("2026-07-21T01:10:00.000Z"),
    collectionSeconds: 8,
  });
  assert.equal(collection.collectUntil, "2026-07-21T01:10:08.000Z");
  const repeatedCollection: any = await repository.requestExamTermination({
    examCode: exam.code,
    requestedByLogin: "another-teacher",
    now: new Date("2026-07-21T01:10:04.000Z"),
    collectionSeconds: 15,
  });
  assert.equal(repeatedCollection.collectUntil, collection.collectUntil);
  assert.equal((await repository.heartbeat({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "collection-session",
    now: new Date("2026-07-21T01:10:01.000Z"),
  })).status, "termination_collecting");

  await repository.saveAnswer({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "collection-session",
    questionKey: attempt.questions[0].key,
    formula: "=SUM(A2:A6)",
    expectedVersion: 0,
    now: new Date("2026-07-21T01:10:02.000Z"),
  });
  assert.equal((await repository.heartbeat({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "collection-session",
    now: new Date("2026-07-21T01:10:09.000Z"),
  })).status, "termination_collecting");
  await assert.rejects(
    repository.saveAnswer({
      examCode: exam.code,
      studentNumber: "S001",
      sessionTokenHash: "collection-session",
      questionKey: attempt.questions[0].key,
      formula: "=1",
      expectedVersion: 1,
      now: new Date("2026-07-21T01:10:09.000Z"),
    }),
    (error: any) => error.code === "ROOM_COLLECTION_ACTIVE",
  );
  const terminated: any = await repository.terminateExam({
    examCode: exam.code,
    terminatedByLogin: "super",
    now: new Date("2026-07-21T01:10:09.000Z"),
  });
  assert.equal(terminated.teacherSubmittedCount, 1);
  assert.equal(terminated.completed, true);
  const result: any = (await repository.listResults(exam.code))[0];
  assert.equal(result.attemptStatus, "teacher_submitted");
  assert.equal(result.forcedSubmissionCount, 1);
});

test("an active event must be terminated before it can be permanently deleted", async () => {
  const { repository, exam } = await preparedExam();
  await assert.rejects(
    repository.deleteExam({ examCode: exam.code, deletedByLogin: "super" }),
    (error: any) => error.code === "EXAM_MUST_BE_TERMINATED",
  );
  await repository.terminateExam({ examCode: exam.code, terminatedByLogin: "super" });
  assert.deepEqual(await repository.deleteExam({ examCode: exam.code, deletedByLogin: "super" }), {
    deleted: true,
    code: exam.code,
  });
});

test("terminating a classroom assignment preserves the open answer sheet until the student submits", async () => {
  const { repository, exam } = await preparedAssignment();
  await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S001" });
  const attempt: any = await repository.startAttempt({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "assignment-session",
  });

  const terminated: any = await repository.terminateExam({ examCode: exam.code, terminatedByLogin: "super" });
  assert.equal(terminated.state, "closed");
  assert.equal(terminated.autoSubmittedCount, 0);
  assert.equal(terminated.pendingSubmissionCount, 1);
  assert.equal(await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S001" }), null);

  await assert.rejects(
    repository.deleteExam({ examCode: exam.code, deletedByLogin: "super" }),
    (error: any) => error.code === "EXAM_HAS_IN_PROGRESS_ATTEMPTS",
  );

  const submission: any = await repository.submitAttempt({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "assignment-session",
    answers: { [attempt.questions[0].key]: "=1" },
  });
  assert.equal(submission.status, "received");
  assert.deepEqual(await repository.deleteExam({ examCode: exam.code, deletedByLogin: "super" }), {
    deleted: true,
    code: exam.code,
  });
});

test("server-side expiry scanning submits an abandoned attempt exactly once", async () => {
  const { repository, exam } = await preparedExam();
  const startedAt: any = new Date("2026-07-15T00:00:00.000Z");
  await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S001", now: startedAt });
  await repository.admitStudent({ examCode: exam.code, studentNumber: "S001" });
  await repository.startAttempt({
    examCode: exam.code,
    studentNumber: "S001",
    sessionTokenHash: "abandoned-session",
    browserPreflight: { fullscreen: true },
    now: startedAt,
  });

  assert.deepEqual(await repository.submitExpiredAttempts({ now: new Date("2026-07-15T01:29:59.000Z") }), {
    scannedCount: 0,
    submittedCount: 0,
    failedCount: 0,
  });
  assert.deepEqual(await repository.submitExpiredAttempts({ now: new Date("2026-07-15T01:30:01.000Z") }), {
    scannedCount: 1,
    submittedCount: 1,
    failedCount: 0,
  });
  assert.equal((await repository.listResults(exam.code))[0].attemptStatus, "auto_submitted");
  assert.deepEqual(await repository.submitExpiredAttempts({ now: new Date("2026-07-15T01:31:00.000Z") }), {
    scannedCount: 0,
    submittedCount: 0,
    failedCount: 0,
  });
});

test("room expiry scanning only submits attempts belonging to the requested exam", async () => {
  const repository: any = new InMemoryStudentExamRepository();
  const plan: any = composeExamPlan({ selectedFunctions: ["SUM"] }).plan;
  const exams: any = await Promise.all(["Teacher A room", "Teacher B room"].map((title) => repository.publishExam({
    title,
    mode: "exam",
    selectedFunctions: ["SUM"],
    plan,
    roster: [{ studentNumber: "S001", name: "Student" }],
    createdByLogin: title === "Teacher A room" ? "super" : "admin",
  })));
  await Promise.all(exams.map((exam: any) => repository.prepareNextBatch({ examCode: exam.code, batchSize: 1 })));
  const startedAt: any = new Date("2026-07-15T00:00:00.000Z");
  for (const exam of exams) {
    await repository.verifyIdentity({ examCode: exam.code, studentNumber: "S001", now: startedAt });
    await repository.admitStudent({ examCode: exam.code, studentNumber: "S001" });
    await repository.startAttempt({
      examCode: exam.code,
      studentNumber: "S001",
      sessionTokenHash: `${exam.code}:S001`,
      browserPreflight: { fullscreen: true },
      now: startedAt,
    });
  }

  assert.deepEqual(await repository.submitExpiredAttempts({
    examCode: exams[0].code,
    now: new Date("2026-07-15T01:31:00.000Z"),
  }), {
    scannedCount: 1,
    submittedCount: 1,
    failedCount: 0,
  });
  assert.equal((await repository.listResults(exams[0].code))[0].attemptStatus, "auto_submitted");
  assert.equal((await repository.listResults(exams[1].code))[0].attemptStatus, "in_progress");
});
