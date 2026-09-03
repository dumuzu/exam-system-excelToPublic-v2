import assert from "node:assert/strict";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import {
  InMemoryStudentExamRepository,
  selectLatestSessionAttemptRows,
} from "../src/server/student-exam-repository.ts";
import { createAppServer } from "../src/server/server.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

const authConfig: any = {
  adminUsername: "admin",
  adminPassword: "test-password",
  sessionSecret: "test-session-secret-that-is-long-enough",
};

function responseCookie(response: any) {
  return response.headers.getSetCookie().map((value: any) => value.split(";", 1)[0]).join("; ");
}

async function verifyStudent(baseUrl: any, studentNumber: any, cookie = "") {
  const response: any = await fetch(`${baseUrl}/api/student/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ examCode: "PRACT1", studentNumber }),
  });
  return { response, body: await response.json(), cookie: responseCookie(response) || cookie };
}

async function startAssignment(baseUrl: any, session: any) {
  const response: any = await fetch(`${baseUrl}/api/student/start`, {
    method: "POST",
    headers: {
      cookie: session.cookie,
      "content-type": "application/json",
      "x-csrf-token": session.body.csrfToken,
    },
    body: "{}",
  });
  return { response, body: await response.json() };
}

test("classroom assignment admits rostered students directly, shares one paper and allows two non-persistent submissions", async () => {
  const composition: any = composeExamPlan({
    mode: "assignment",
    selectedFunctions: ["SUM", "AVERAGE"],
  });
  assert.equal(composition.ok, true);

  const repository: any = new InMemoryStudentExamRepository({
    exams: [{
      id: "assignment-1",
      examCode: "PRACT1",
      titleJa: "関数練習",
      state: "published",
      durationMinutes: null,
      mode: "assignment",
      plan: composition.plan,
      students: [
        { studentNumber: "20260001", name: "Anil", enrollmentStatus: "eligible" },
        { studentNumber: "20260002", name: "Bina", enrollmentStatus: "eligible" },
      ],
    }],
  });
  const preparation: any = await repository.prepareNextBatch({ examCode: "PRACT1", batchSize: 25 });
  assert.equal(preparation.status, "ready");

  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const unknown: any = await verifyStudent(baseUrl, "20269999");
    assert.equal(unknown.response.status, 401);

    const firstStudent: any = await verifyStudent(baseUrl, "20260001");
    const secondStudent: any = await verifyStudent(baseUrl, "20260002");
    assert.equal(firstStudent.response.status, 200);
    assert.match(firstStudent.response.headers.get("set-cookie"), /Max-Age=86400/);
    assert.equal(firstStudent.body.status, "admitted");
    assert.equal(firstStudent.body.exam.mode, "assignment");
    assert.equal(firstStudent.body.exam.durationMinutes, null);
    assert.deepEqual(firstStudent.body.experience, {
      mode: "assignment",
      requiresAdmission: false,
      requiresFullscreen: false,
      hasTimeLimit: false,
      proctoringEnabled: false,
      autosaveEnabled: false,
      sharedPaper: true,
      randomizeQuestionOrder: false,
      revealScoreAfterSubmission: true,
      maximumAttempts: 2,
    });

    const firstStart: any = await startAssignment(baseUrl, firstStudent);
    const secondStart: any = await startAssignment(baseUrl, secondStudent);
    assert.equal(firstStart.response.status, 200);
    assert.equal(secondStart.response.status, 200);
    assert.equal(firstStart.body.attempt.attemptNumber, 1);
    assert.equal(firstStart.body.attempt.deadlineAt, null);
    assert.equal(firstStart.body.attempt.questions.length, 10);
    assert.deepEqual(firstStart.body.attempt.questions, secondStart.body.attempt.questions);

    const classroomAttendance: any = await repository.listAttendance("PRACT1", {
      now: new Date(Date.now() + 60_000),
      offlineAfterSeconds: 45,
    });
    assert.equal(
      classroomAttendance.find((student: any) => student.studentNumber === "20260001").status,
      "in_progress",
    );

    const proctorEvent: any = await fetch(`${baseUrl}/api/student/proctor-events`, {
      method: "POST",
      headers: {
        cookie: firstStudent.cookie,
        "content-type": "application/json",
        "x-csrf-token": firstStudent.body.csrfToken,
      },
      body: JSON.stringify({ eventType: "page_hidden" }),
    });
    assert.equal(proctorEvent.status, 409);
    assert.equal((await proctorEvent.json()).code, "PROCTORING_DISABLED");

    const autosave: any = await fetch(`${baseUrl}/api/student/answer`, {
      method: "PUT",
      headers: {
        cookie: firstStudent.cookie,
        "content-type": "application/json",
        "x-csrf-token": firstStudent.body.csrfToken,
      },
      body: JSON.stringify({
        questionKey: firstStart.body.attempt.questions[0].key,
        formula: "=SUM(A2:A6)",
        expectedVersion: 0,
      }),
    });
    assert.equal(autosave.status, 409);
    assert.equal((await autosave.json()).code, "AUTOSAVE_DISABLED");

    const invalidSubmission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: firstStudent.cookie,
        "content-type": "application/json",
        "x-csrf-token": firstStudent.body.csrfToken,
      },
      body: JSON.stringify({ answers: { "unknown-question": "=1" } }),
    });
    assert.equal(invalidSubmission.status, 422);
    assert.equal((await invalidSubmission.json()).code, "QUESTION_NOT_FOUND");

    const firstSubmission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: firstStudent.cookie,
        "content-type": "application/json",
        "x-csrf-token": firstStudent.body.csrfToken,
      },
      body: JSON.stringify({
        answers: {
          [firstStart.body.attempt.questions[0].key]: `=SUM(${firstStart.body.attempt.questions[0].table.namedRanges.ValueData})`,
        },
      }),
    });
    assert.equal(firstSubmission.status, 200);
    const firstResult: any = (await firstSubmission.json()).submission;
    assert.equal(firstResult.score, 3);
    assert.equal(firstResult.questionCount, 10);
    assert.equal(firstResult.attemptNumber, 1);
    assert.equal(firstResult.attemptsRemaining, 1);

    const repeatedSubmission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: firstStudent.cookie,
        "content-type": "application/json",
        "x-csrf-token": firstStudent.body.csrfToken,
      },
      body: JSON.stringify({ answers: {} }),
    });
    assert.deepEqual((await repeatedSubmission.json()).submission, firstResult);

    const secondVerification: any = await verifyStudent(baseUrl, "20260001", firstStudent.cookie);
    assert.equal(secondVerification.response.status, 200);
    assert.equal(secondVerification.body.status, "admitted");
    assert.notEqual(secondVerification.cookie, firstStudent.cookie);
    const retry: any = await startAssignment(baseUrl, secondVerification);
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.attempt.attemptNumber, 2);
    assert.deepEqual(retry.body.attempt.questions, firstStart.body.attempt.questions);
    assert.deepEqual(retry.body.attempt.answers.values, {});

    const secondSubmission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: secondVerification.cookie,
        "content-type": "application/json",
        "x-csrf-token": secondVerification.body.csrfToken,
      },
      body: JSON.stringify({ answers: {} }),
    });
    assert.equal(secondSubmission.status, 200);
    const secondResult: any = (await secondSubmission.json()).submission;
    assert.equal(secondResult.score, 0);
    assert.equal(secondResult.attemptNumber, 2);
    assert.equal(secondResult.attemptsRemaining, 0);

    const repeatedSecondSubmission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: secondVerification.cookie,
        "content-type": "application/json",
        "x-csrf-token": secondVerification.body.csrfToken,
      },
      body: JSON.stringify({ answers: { [retry.body.attempt.questions[0].key]: "=1" } }),
    });
    assert.deepEqual((await repeatedSecondSubmission.json()).submission, secondResult);

    const teacherSummary: any = (await repository.listResults("PRACT1"))
      .find((item: any) => item.studentNumber === "20260001");
    assert.equal(teacherSummary.attemptCount, 2);
    assert.equal(teacherSummary.gradingStatus, "graded");
    assert.equal(teacherSummary.score, 0);
    assert.equal(teacherSummary.maximumScore, 30);

    const teacherDetail: any = await repository.getResult({ examCode: "PRACT1", studentNumber: "20260001" });
    assert.equal(teacherDetail.questions.length, 10);
    assert.equal(teacherDetail.questions.every((question: any) => question.awardedScore === 0), true);

    const exhausted: any = await verifyStudent(baseUrl, "20260001", secondVerification.cookie);
    assert.equal(exhausted.body.status, "submitted");
    const blockedStart: any = await startAssignment(baseUrl, exhausted);
    assert.equal(blockedStart.response.status, 409);
    assert.equal(blockedStart.body.code, "ATTEMPT_LOCKED");
  });
});

test("submission row isolation selects only the latest attempt sharing a legacy session hash", () => {
  const rows: any = [
    { id: "attempt-1", attempt_number: 1, question_key: "first-1" },
    { id: "attempt-2", attempt_number: 2, question_key: "second-1" },
    { id: "attempt-1", attempt_number: 1, question_key: "first-2" },
    { id: "attempt-2", attempt_number: 2, question_key: "second-2" },
  ];

  assert.deepEqual(selectLatestSessionAttemptRows(rows), [rows[1], rows[3]]);
});

test("classroom submission retries one transient database disconnect without losing the answer sheet", async () => {
  const composition: any = composeExamPlan({
    mode: "assignment",
    selectedFunctions: ["SUM"],
  });
  assert.equal(composition.ok, true);

  const repository: any = new InMemoryStudentExamRepository({
    exams: [{
      id: "assignment-retry",
      examCode: "PRACT1",
      titleJa: "再送テスト",
      state: "published",
      durationMinutes: null,
      mode: "assignment",
      plan: composition.plan,
      students: [{ studentNumber: "20260001", name: "Anil", enrollmentStatus: "eligible" }],
    }],
  });
  await repository.prepareNextBatch({ examCode: "PRACT1", batchSize: 25 });

  const persistSubmission: any = repository.submitAttempt.bind(repository);
  let submissionCalls: any = 0;
  repository.submitAttempt = async (input: any) => {
    submissionCalls += 1;
    if (submissionCalls === 1) {
      const error: any = new Error("Connection terminated unexpectedly");
      error.code = "08006";
      throw error;
    }
    return persistSubmission(input);
  };

  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const student: any = await verifyStudent(baseUrl, "20260001");
    const started: any = await startAssignment(baseUrl, student);
    assert.equal(started.response.status, 200);

    const submission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: student.cookie,
        "content-type": "application/json",
        "x-csrf-token": student.body.csrfToken,
      },
      body: JSON.stringify({ answers: {} }),
    });

    assert.equal(submission.status, 200);
    assert.equal(submissionCalls, 2);
    assert.equal((await submission.json()).submission.attemptsRemaining, 1);
  });
});

test("classroom entry and attempt start retry one transient database disconnect", async () => {
  const composition: any = composeExamPlan({ mode: "assignment", selectedFunctions: ["SUM"] });
  const repository: any = new InMemoryStudentExamRepository({
    exams: [{
      id: "assignment-entry-retry",
      examCode: "PRACT1",
      titleJa: "入室再送テスト",
      state: "published",
      durationMinutes: null,
      mode: "assignment",
      plan: composition.plan,
      students: [{ studentNumber: "20260001", name: "Anil", enrollmentStatus: "eligible" }],
    }],
  });
  await repository.prepareNextBatch({ examCode: "PRACT1", batchSize: 25 });

  const verifyIdentity: any = repository.verifyIdentity.bind(repository);
  const startAttempt: any = repository.startAttempt.bind(repository);
  let verificationCalls: any = 0;
  let startCalls: any = 0;
  repository.verifyIdentity = async (input: any) => {
    verificationCalls += 1;
    if (verificationCalls === 1) {
      const error: any = new Error("Connection terminated unexpectedly");
      error.code = "08006";
      throw error;
    }
    return verifyIdentity(input);
  };
  repository.startAttempt = async (input: any) => {
    startCalls += 1;
    if (startCalls === 1) {
      const error: any = new Error("Connection terminated unexpectedly");
      error.code = "08006";
      throw error;
    }
    return startAttempt(input);
  };

  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const student: any = await verifyStudent(baseUrl, "20260001");
    assert.equal(student.response.status, 200);
    assert.equal(verificationCalls, 2);
    const started: any = await startAssignment(baseUrl, student);
    assert.equal(started.response.status, 200);
    assert.equal(startCalls, 2);
    assert.equal(started.body.attempt.questions.length, 5);
  });
});

test("classroom submission reports that the event is unavailable after it is permanently deleted", async () => {
  const composition: any = composeExamPlan({
    mode: "assignment",
    selectedFunctions: ["SUM"],
  });
  const repository: any = new InMemoryStudentExamRepository({
    exams: [{
      id: "assignment-deleted",
      examCode: "PRACT1",
      titleJa: "削除確認",
      state: "published",
      durationMinutes: null,
      mode: "assignment",
      plan: composition.plan,
      students: [{ studentNumber: "20260001", name: "Anil", enrollmentStatus: "eligible" }],
    }],
  });
  await repository.prepareNextBatch({ examCode: "PRACT1", batchSize: 25 });

  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const student: any = await verifyStudent(baseUrl, "20260001");
    const started: any = await startAssignment(baseUrl, student);
    assert.equal(started.response.status, 200);

    const accepted: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: student.cookie,
        "content-type": "application/json",
        "x-csrf-token": student.body.csrfToken,
      },
      body: JSON.stringify({ answers: {} }),
    });
    assert.equal(accepted.status, 200);
    await repository.terminateExam({ examCode: "PRACT1", terminatedByLogin: "admin" });
    await repository.deleteExam({ examCode: "PRACT1" });

    const submission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: student.cookie,
        "content-type": "application/json",
        "x-csrf-token": student.body.csrfToken,
      },
      body: JSON.stringify({ answers: {} }),
    });

    assert.equal(submission.status, 410);
    assert.equal((await submission.json()).code, "EXAM_EVENT_UNAVAILABLE");
  });
});

test("classroom submission accepts the complete 15-per-function answer map", async () => {
  const selectedFunctions: any = FUNCTION_CATALOG
    .filter((definition) => definition.modes.includes("formula"))
    .map((definition) => definition.name);
  const composition: any = composeExamPlan({
    mode: "assignment",
    selectedFunctions,
    assignmentOptions: { questionsPerFunction: 15 },
  });
  const repository: any = new InMemoryStudentExamRepository({
    exams: [{
      examCode: "PRACT1",
      titleJa: "最大課題",
      state: "published",
      durationMinutes: null,
      mode: "assignment",
      plan: composition.plan,
      students: [{ studentNumber: "20260001", name: "Anil", enrollmentStatus: "eligible" }],
    }],
  });
  await repository.prepareNextBatch({ examCode: "PRACT1", batchSize: 25 });

  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const student: any = await verifyStudent(baseUrl, "20260001");
    const started: any = await startAssignment(baseUrl, student);
    assert.ok(started.body.attempt.questions.length > 500);
    const answers: any = Object.fromEntries(started.body.attempt.questions.map((question: any) => [question.key, "=1"]));

    const submission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: {
        cookie: student.cookie,
        "content-type": "application/json",
        "x-csrf-token": student.body.csrfToken,
      },
      body: JSON.stringify({ answers }),
    });

    assert.equal(submission.status, 200);
    assert.equal((await submission.json()).submission.questionCount, selectedFunctions.length * 15);
  });
});

test("classroom assignment prepares one shared paper for a 500-student roster", async () => {
  const selectedFunctions: any = FUNCTION_CATALOG
    .filter((definition) => definition.modes.includes("formula"))
    .map((definition) => definition.name);
  const composition: any = composeExamPlan({
    mode: "assignment",
    selectedFunctions,
    assignmentOptions: { questionsPerFunction: 15 },
  });
  assert.equal(composition.ok, true);

  const students: any = Array.from({ length: 500 }, (_, index) => ({
    studentNumber: `S${String(index + 1).padStart(4, "0")}`,
    name: `Student ${index + 1}`,
    enrollmentStatus: "eligible",
  }));
  const repository: any = new InMemoryStudentExamRepository({
    exams: [{
      examCode: "CAP500",
      titleJa: "全関数練習",
      state: "published",
      durationMinutes: null,
      mode: "assignment",
      plan: composition.plan,
      students,
    }],
  });

  const preparation: any = await repository.prepareNextBatch({ examCode: "CAP500", batchSize: 25 });

  const questionsPerStudent: any = selectedFunctions.length * 15;
  assert.equal(preparation.status, "ready");
  assert.equal(preparation.rosterCount, 500);
  assert.equal(preparation.plannedQuestionCount, questionsPerStudent);
  assert.equal(preparation.generatedQuestionCount, questionsPerStudent);
});
