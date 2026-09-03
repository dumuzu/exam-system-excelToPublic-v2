import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";

function repositoryWithStudent() {
  return new InMemoryStudentExamRepository({ exams: [{
    id: "exam-live-room",
    examCode: "ROOM-2026",
    titleJa: "Live room",
    state: "published",
    durationMinutes: 90,
    students: [{ studentNumber: "E24B3522", name: "अनिल कुमार", enrollmentStatus: "eligible" }],
  }] });
}

test("live room detects a stale session and teacher-authorised recovery preserves answers and deadline", async () => {
  const repository: any = repositoryWithStudent();
  const arrivedAt: any = new Date("2026-07-12T01:00:00.000Z");
  await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522", name: "अनिल कुमार", now: arrivedAt });
  await repository.admitStudent({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  const started: any = await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-one", browserPreflight: { fullscreen: true }, now: new Date("2026-07-12T01:01:00.000Z") });
  await repository.saveAnswer({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-one", questionKey: started.questions[0].key, formula: "=SUM(A2:A6)", expectedVersion: 0, now: new Date("2026-07-12T01:02:00.000Z") });
  await repository.heartbeat({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-one", now: new Date("2026-07-12T01:02:00.000Z") });

  const disconnected: any = (await repository.listAttendance("ROOM-2026", { now: new Date("2026-07-12T01:02:46.000Z") }))[0];
  assert.equal(disconnected.status, "disconnected");
  assert.equal(disconnected.name, "अनिल कुमार");
  assert.equal(disconnected.arrivedAt, arrivedAt.toISOString());
  assert.equal(disconnected.startedAt, "2026-07-12T01:01:00.000Z");
  assert.equal(disconnected.remainingSeconds, 5_294);

  const authorised: any = await repository.authorizeResume({ examCode: "ROOM-2026", studentNumber: "E24B3522", authorizedByLogin: "admin", now: new Date("2026-07-12T01:03:00.000Z") });
  assert.deepEqual(authorised, { studentNumber: "E24B3522", status: "resume_ready" });
  assert.equal((await repository.listAttendance("ROOM-2026", { now: new Date("2026-07-12T01:03:01.000Z") }))[0].status, "resume_ready");
  assert.equal(await repository.getAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-one" }), null);

  const resumed: any = await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-two", browserPreflight: { fullscreen: true }, now: new Date("2026-07-12T01:04:00.000Z") });
  assert.equal(resumed.deadlineAt, started.deadlineAt);
  assert.equal(resumed.answers.values[started.questions[0].key], "=SUM(A2:A6)");
  assert.equal((await repository.listAttendance("ROOM-2026", { now: new Date("2026-07-12T01:04:01.000Z") }))[0].status, "in_progress");
});

test("recovery is refused after submission", async () => {
  const repository: any = repositoryWithStudent();
  const startedAt: any = new Date("2026-07-12T01:00:00.000Z");
  await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522", name: "अनिल कुमार" });
  await repository.admitStudent({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-one", browserPreflight: { fullscreen: true }, now: startedAt });
  await repository.submitAttempt({
    examCode: "ROOM-2026",
    studentNumber: "E24B3522",
    sessionTokenHash: "session-one",
    now: new Date(startedAt.getTime() + 6_000),
    manualConfirmationVerified: true,
  });
  assert.equal(await repository.authorizeResume({ examCode: "ROOM-2026", studentNumber: "E24B3522", authorizedByLogin: "admin" }), null);
});

test("an empty formal answer sheet cannot be manually submitted by a startup click-through", async () => {
  const repository: any = repositoryWithStudent();
  const startedAt: any = new Date("2026-07-12T01:00:00.000Z");
  await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522", now: startedAt });
  await repository.admitStudent({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  await repository.startAttempt({
    examCode: "ROOM-2026",
    studentNumber: "E24B3522",
    sessionTokenHash: "startup-click-through",
    browserPreflight: { fullscreen: true },
    now: startedAt,
  });

  await assert.rejects(
    repository.submitAttempt({
      examCode: "ROOM-2026",
      studentNumber: "E24B3522",
      sessionTokenHash: "startup-click-through",
      now: new Date(startedAt.getTime() + 1_200),
      manualConfirmationVerified: true,
    }),
    (error: any) => error.code === "SUBMISSION_CONFIRMATION_REQUIRED",
  );
  await assert.rejects(
    repository.submitAttempt({
      examCode: "ROOM-2026",
      studentNumber: "E24B3522",
      sessionTokenHash: "startup-click-through",
      now: new Date(startedAt.getTime() + 6_000),
    }),
    (error: any) => error.code === "SUBMISSION_CONFIRMATION_REQUIRED",
  );
  assert.equal(
    (await repository.getAttempt({
      examCode: "ROOM-2026",
      studentNumber: "E24B3522",
      sessionTokenHash: "startup-click-through",
    })).status,
    "in_progress",
  );
});

test("three violations suspend the same attempt until a teacher resumes its saved answers and remaining time", async () => {
  const repository: any = repositoryWithStudent();
  await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522", now: new Date("2026-07-12T01:00:00.000Z") });
  await repository.admitStudent({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  const started: any = await repository.startAttempt({
    examCode: "ROOM-2026",
    studentNumber: "E24B3522",
    sessionTokenHash: "policy-session",
    browserPreflight: { fullscreen: true },
    now: new Date("2026-07-12T01:00:00.000Z"),
  });
  await repository.saveAnswer({
    examCode: "ROOM-2026",
    studentNumber: "E24B3522",
    sessionTokenHash: "policy-session",
    questionKey: started.questions[0].key,
    formula: "=SUM(A2:A6)",
    expectedVersion: 0,
    now: new Date("2026-07-12T01:09:00.000Z"),
  });

  for (const [index, eventType] of ["copy_blocked", "page_hidden", "fullscreen_exit"].entries()) {
    const recorded: any = await repository.recordProctorEvent({
      examCode: "ROOM-2026",
      studentNumber: "E24B3522",
      sessionTokenHash: "policy-session",
      eventType,
      now: new Date(`2026-07-12T01:${String(10 + index).padStart(2, "0")}:00.000Z`),
    });
    assert.equal(recorded.auditEvent.policyId, "browser_three_strike");
    assert.equal(recorded.auditEvent.violationOrdinal, index + 1);
    assert.equal(recorded.auditEvent.sourceEventType, eventType);
    if (index < 2) assert.equal(recorded.suspension, null);
    else {
      assert.equal(recorded.auditEvent.decision, "suspended");
      assert.equal(recorded.suspension.remainingSeconds, 4_680);
      assert.equal(recorded.suspension.suspendedAt, "2026-07-12T01:12:00.000Z");
    }
  }

  const suspended: any = (await repository.listAttendance("ROOM-2026", { now: new Date("2026-07-12T01:30:00.000Z") }))[0];
  assert.equal(suspended.status, "policy_suspended");
  assert.equal(suspended.remainingSeconds, 4_680);
  assert.equal((await repository.listResults("ROOM-2026"))[0].gradingStatus, null);
  await assert.rejects(
    repository.saveAnswer({
      examCode: "ROOM-2026",
      studentNumber: "E24B3522",
      sessionTokenHash: "policy-session",
      questionKey: started.questions[0].key,
      formula: "=SUM(A2:A5)",
      expectedVersion: 1,
      now: new Date("2026-07-12T01:30:00.000Z"),
    }),
    (error: any) => error.code === "ATTEMPT_LOCKED",
  );

  const resumed: any = await repository.authorizeResume({
    examCode: "ROOM-2026",
    studentNumber: "E24B3522",
    authorizedByLogin: "admin",
    now: new Date("2026-07-12T01:30:00.000Z"),
  });
  assert.equal(resumed.status, "in_progress");
  assert.equal(resumed.deadlineAt, "2026-07-12T02:48:00.000Z");
  const restored: any = await repository.getAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "policy-session" });
  assert.equal(restored.id, started.id);
  assert.equal(restored.answers.values[started.questions[0].key], "=SUM(A2:A6)");
  assert.equal(restored.deadlineAt, "2026-07-12T02:48:00.000Z");
});

test("teacher collection resolves an open policy suspension instead of leaving a terminal attempt suspended", async () => {
  const repository: any = repositoryWithStudent();
  const startedAt: any = new Date("2026-07-12T01:00:00.000Z");
  await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522", now: startedAt });
  await repository.admitStudent({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "collection-policy", browserPreflight: { fullscreen: true }, now: startedAt });
  for (const eventType of ["copy_blocked", "page_hidden", "fullscreen_exit"]) {
    await repository.recordProctorEvent({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "collection-policy", eventType, now: new Date("2026-07-12T01:10:00.000Z") });
  }
  await repository.requestExamTermination({ examCode: "ROOM-2026", requestedByLogin: "admin", now: new Date("2026-07-12T01:11:00.000Z"), collectionSeconds: 3 });
  const collectedAt: any = new Date("2026-07-12T01:11:03.000Z");
  await repository.terminateExam({ examCode: "ROOM-2026", terminatedByLogin: "admin", now: collectedAt });

  const result: any = (await repository.listResults("ROOM-2026"))[0];
  assert.equal(result.attemptStatus, "teacher_submitted");
  assert.equal(result.policySuspensions[0].status, "collected");
  assert.equal(result.policySuspensions[0].collectedAt, collectedAt.toISOString());
  assert.equal(result.policySuspensions[0].collectedBy, "admin");
});

test("a teacher can approve another attempt with the original paper after a policy-forced zero", async () => {
  const repository: any = repositoryWithStudent();
  await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522", name: "अनिल कुमार" });
  await repository.admitStudent({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  const first: any = await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-one", browserPreflight: { fullscreen: true } });
  await repository.submitAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-one", submissionType: "policy" });
  assert.equal((await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522" })).status, "waiting_approval");
  assert.deepEqual(
    await repository.authorizeRetake({ examCode: "ROOM-2026", studentNumber: "E24B3522", authorizedByLogin: "admin" }),
    { studentNumber: "E24B3522", status: "admitted", attemptCount: 2 },
  );
  assert.equal((await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522" })).status, "admitted");
  const second: any = await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "session-two", browserPreflight: { fullscreen: true } });
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.answers.values, {});
  assert.deepEqual(second.questions, first.questions);
});

test("a stale browser session is replaced automatically without changing answers or deadline", async () => {
  const repository: any = repositoryWithStudent();
  await repository.verifyIdentity({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  await repository.admitStudent({ examCode: "ROOM-2026", studentNumber: "E24B3522" });
  const started: any = await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "old-browser", browserPreflight: { fullscreen: true }, now: new Date("2026-07-12T01:00:00.000Z") });
  await repository.saveAnswer({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "old-browser", questionKey: started.questions[0].key, formula: "=SUM(A2:A6)", expectedVersion: 0, now: new Date("2026-07-12T01:00:05.000Z") });
  await assert.rejects(
    repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "new-browser", browserPreflight: { fullscreen: true }, now: new Date("2026-07-12T01:00:40.000Z") }),
    (error: any) => error.code === "DUPLICATE_SESSION",
  );
  const resumed: any = await repository.startAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "new-browser", browserPreflight: { fullscreen: true }, now: new Date("2026-07-12T01:00:46.000Z") });
  assert.equal(resumed.id, started.id);
  assert.equal(resumed.deadlineAt, started.deadlineAt);
  assert.equal(resumed.answers.values[started.questions[0].key], "=SUM(A2:A6)");
  assert.equal(await repository.getAttempt({ examCode: "ROOM-2026", studentNumber: "E24B3522", sessionTokenHash: "old-browser" }), null);
});
