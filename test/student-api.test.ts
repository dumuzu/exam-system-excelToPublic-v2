import assert from "node:assert/strict";
import test from "node:test";

import { createSubmissionConfirmation, hashStudentSession } from "../src/server/student-auth.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";
import { createAppServer } from "../src/server/server.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

const authConfig: any = {
  adminUsername: "admin",
  adminPassword: "test-password",
  sessionSecret: "test-session-secret-that-is-long-enough",
};

const validBrowserPreflight: any = {
  secureContext: true,
  fullscreen: true,
  localStorage: true,
  visibility: true,
  network: true,
  browserFamily: "safari",
  browserVersion: 16.4,
  browserSupported: true,
};

function createRepository() {
  return new InMemoryStudentExamRepository({
    exams: [{
      id: "exam-1",
      examCode: "SUM-2026",
      titleJa: "SUM 練習",
      state: "published",
      durationMinutes: 90,
      students: [{ studentNumber: "20260001", name: "Anil K.", enrollmentStatus: "eligible" }],
    }],
  });
}

function createSharedNetworkRepository(studentCount: any) {
  return new InMemoryStudentExamRepository({
    exams: [{
      id: "exam-shared-network",
      examCode: "ROOM-2026",
      titleJa: "同時入場テスト",
      state: "published",
      durationMinutes: 90,
      students: Array.from({ length: studentCount }, (_, index) => ({
        studentNumber: `S${String(index + 1).padStart(3, "0")}`,
        name: `Student ${index + 1}`,
        enrollmentStatus: "eligible",
      })),
    }],
  });
}

function adminHeaders(cookie: any, csrfToken: any) {
  return { cookie, "content-type": "application/json", "x-csrf-token": csrfToken };
}

function responseCookie(response: any) {
  return response.headers.getSetCookie().map((value: any) => value.split(";", 1)[0]).join("; ");
}

function matureSubmissionConfirmation(cookie: any, examCode: any, studentNumber: any) {
  const token: any = cookie.split(";").map((part: any) => part.trim()).find((part: any) => part.startsWith("student_session="))?.slice("student_session=".length);
  assert.ok(token);
  return createSubmissionConfirmation({
    examCode,
    studentNumber,
    sessionTokenHash: hashStudentSession(token),
    sessionSecret: authConfig.sessionSecret,
    now: Date.now() - 2_000,
  });
}

async function loginAdmin(baseUrl: any) {
  const response: any = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test-password" }),
  });
  const session: any = await response.json();
  const cookie: any = response.headers.getSetCookie().map((value: any) => value.split(";", 1)[0]).join("; ");
  return { cookie, csrfToken: session.csrfToken };
}

test("student verification matches a roster entry and returns the waiting state", async () => {
  const server: any = createAppServer({ authConfig, studentExamRepository: createRepository() });
  await withFetchableServer(server, async (baseUrl) => {
    const response: any = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: "sum-2026", studentNumber: " ２０２６０００１ " }),
    });

    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.deepEqual({ ...body, csrfToken: "redacted" }, {
      status: "waiting_approval",
      exam: { code: "SUM-2026", titleJa: "SUM 練習", durationMinutes: 90, mode: "exam", studentLocale: "legacy_bilingual" },
      student: { studentNumber: "20260001", name: "Anil K." },
      experience: {
        mode: "exam",
        requiresAdmission: true,
        requiresFullscreen: true,
        hasTimeLimit: true,
        proctoringEnabled: true,
        autosaveEnabled: true,
        sharedPaper: false,
        randomizeQuestionOrder: true,
        revealScoreAfterSubmission: false,
        maximumAttempts: null,
      },
      csrfToken: "redacted",
    });
    assert.equal(typeof body.csrfToken, "string");
    assert.match(response.headers.get("set-cookie"), /student_session=/);
  });
});

test("student language is fixed by the subject and cannot be overridden by the verification request", async () => {
  const subjectId = "00000000-0000-4000-8000-000000000088";
  const teacherAccounts = new InMemoryTeacherAccountRepository({
    subjects: [{ id: subjectId, code: "english-course", nameJa: "英語科目", nameZh: "英语科目", nameEn: "English Course", studentLocale: "en", assessmentTypeKey: "manual_questions" }],
  });
  const studentExams = new InMemoryStudentExamRepository({
    exams: [{
      id: "exam-language",
      examCode: "LANG-2026",
      titleJa: "English assessment",
      state: "published",
      subjectId,
      durationMinutes: 60,
      students: [{ studentNumber: "LANG001", name: "Student One", enrollmentStatus: "eligible" }],
    }],
  });
  const server: any = createAppServer({ authConfig, studentExamRepository: studentExams, teacherAccountRepository: teacherAccounts });
  await withFetchableServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: "LANG-2026", studentNumber: "LANG001", studentLocale: "ja" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).exam.studentLocale, "en");
  });
});

test("student verification requires only a rostered student number and does not disclose which field was wrong", async () => {
  const server: any = createAppServer({ authConfig, studentExamRepository: createRepository() });
  await withFetchableServer(server, async (baseUrl) => {
    const response: any = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20269999" }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Identity could not be verified." });
  });
});

test("student verification isolates rate limits for concurrent students sharing one network address", async () => {
  const repository: any = createSharedNetworkRepository(200);
  const verifyIdentity: any = repository.verifyIdentity.bind(repository);
  repository.verifyIdentity = async (input: any) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return verifyIdentity(input);
  };
  const server: any = createAppServer({
    authConfig,
    capacityPolicy: { loginRateLimit: 5 },
    studentExamRepository: repository,
  });

  await withFetchableServer(server, async (baseUrl) => {
    const responses: any = await Promise.all(Array.from({ length: 200 }, (_, index) => fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        examCode: "ROOM-2026",
        studentNumber: `S${String(index + 1).padStart(3, "0")}`,
      }),
    })));

    assert.deepEqual(
      responses.reduce((counts: any, response: any) => {
        counts[response.status] = (counts[response.status] ?? 0) + 1;
        return counts;
      }, {}),
      { 200: 200 },
    );
  });
});

test("student verification still rate limits repeated failures for one exam identity", async () => {
  const server: any = createAppServer({
    authConfig,
    capacityPolicy: { loginRateLimit: 3 },
    studentExamRepository: createSharedNetworkRepository(1),
  });

  await withFetchableServer(server, async (baseUrl) => {
    const statuses: any = [];
    for (let attempt: any = 0; attempt < 4; attempt += 1) {
      const response: any = await fetch(`${baseUrl}/api/student/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examCode: "ROOM-2026", studentNumber: "UNKNOWN" }),
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 429]);

    const listedStudent: any = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: "ROOM-2026", studentNumber: "S001" }),
    });
    assert.equal(listedStudent.status, 200);
  });
});

test("teacher can view a waiting student and grant admission after identity verification", async () => {
  const server: any = createAppServer({
    authConfig,
    studentExamRepository: createRepository(),
  });
  await withFetchableServer(server, async (baseUrl) => {
    await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001", name: "Anil K." }),
    });

    const admin: any = await loginAdmin(baseUrl);
    const events: any = await fetch(`${baseUrl}/api/admin/exams`, { headers: { cookie: admin.cookie } });
    assert.equal(events.status, 200);
    assert.deepEqual((await events.json()).exams.map((exam: any) => exam.code), ["SUM-2026"]);
    const waiting: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/attendance`, { headers: { cookie: admin.cookie } });
    assert.equal(waiting.status, 200);
    const waitingBody: any = await waiting.json();
    assert.equal(waitingBody.violationLimit, 3);
    const waitingStudent: any = waitingBody.students[0];
    assert.deepEqual({ studentNumber: waitingStudent.studentNumber, name: waitingStudent.name, status: waitingStudent.status }, { studentNumber: "20260001", name: "Anil K.", status: "waiting_approval" });
    assert.equal(typeof waitingStudent.arrivedAt, "string");

    const approval: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/admit-selected`, {
      method: "POST",
      headers: adminHeaders(admin.cookie, admin.csrfToken),
      body: JSON.stringify({ studentNumbers: ["20260001"] }),
    });
    assert.equal(approval.status, 200);
    assert.deepEqual(await approval.json(), { admittedCount: 1 });

    const admitted: any = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001", name: "Anil K." }),
    });
    assert.equal((await admitted.json()).status, "admitted");
  });
});

test("admitted student starts once, resumes the same question and keeps answer keys private", async () => {
  const server: any = createAppServer({ authConfig, studentExamRepository: createRepository() });
  await withFetchableServer(server, async (baseUrl) => {
    const verification: any = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001", name: "Anil K." }),
    });
    const verified: any = await verification.json();
    const studentCookie: any = responseCookie(verification);
    const admin: any = await loginAdmin(baseUrl);
    await fetch(`${baseUrl}/api/admin/exams/SUM-2026/students/20260001/admit`, {
      method: "POST",
      headers: adminHeaders(admin.cookie, admin.csrfToken),
      body: "{}",
    });

    const start: any = await fetch(`${baseUrl}/api/student/start`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ browserPreflight: validBrowserPreflight }),
    });
    assert.equal(start.status, 200);
    const started: any = (await start.json()).attempt;
    assert.equal(started.status, "in_progress");
    assert.equal(started.questions.length, 1);
    const publicQuestions: any = JSON.stringify(started.questions);
    for (const privateField of ["answerKey", "allowedFormula", "correctOption", "expectedValue", "functionName", "scoringRule"]) {
      assert.doesNotMatch(publicQuestions, new RegExp(`"${privateField}"\\s*:`));
    }

    const clickThroughSubmission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: "{}",
    });
    assert.equal(clickThroughSubmission.status, 409);
    assert.equal((await clickThroughSubmission.json()).code, "SUBMISSION_CONFIRMATION_REQUIRED");

    const confirmationWithoutCsrf: any = await fetch(`${baseUrl}/api/student/submission-confirmation`, {
      method: "POST",
      headers: { cookie: studentCookie },
    });
    assert.equal(confirmationWithoutCsrf.status, 403);
    const confirmationResponse: any = await fetch(`${baseUrl}/api/student/submission-confirmation`, {
      method: "POST",
      headers: { cookie: studentCookie, "x-csrf-token": verified.csrfToken },
    });
    assert.equal(confirmationResponse.status, 201);
    const confirmationToken: any = (await confirmationResponse.json()).confirmationToken;
    assert.equal(typeof confirmationToken, "string");
    const prematureSubmission: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ confirmationToken }),
    });
    assert.equal(prematureSubmission.status, 409);
    assert.equal((await prematureSubmission.json()).code, "SUBMISSION_CONFIRMATION_REQUIRED");

    const recovery: any = await fetch(`${baseUrl}/api/student/attempt`, { headers: { cookie: studentCookie } });
    assert.equal(recovery.status, 200);
    assert.deepEqual((await recovery.json()).attempt, started);

    const save: any = await fetch(`${baseUrl}/api/student/answer`, {
      method: "PUT",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ questionKey: started.questions[0].key, formula: "=SUM(A2:A6)", expectedVersion: 0, clientSavedAt: new Date().toISOString() }),
    });
    assert.equal(save.status, 200);
    const savedAnswer: any = (await save.json()).answer;
    assert.equal(savedAnswer.version, 1);

    const conflict: any = await fetch(`${baseUrl}/api/student/answer`, {
      method: "PUT",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ questionKey: started.questions[0].key, formula: "=1", expectedVersion: 0 }),
    });
    assert.equal(conflict.status, 409);

    const restored: any = await fetch(`${baseUrl}/api/student/attempt`, { headers: { cookie: studentCookie } });
    assert.equal((await restored.json()).attempt.answer.formula, "=SUM(A2:A6)");

    for (let count: any = 1; count <= 3; count += 1) {
      const event: any = await fetch(`${baseUrl}/api/student/proctor-events`, {
        method: "POST",
        headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
        body: JSON.stringify({ eventType: count === 1 ? "copy_blocked" : "page_hidden" }),
      });
      assert.equal(event.status, 201);
      const recorded: any = await event.json();
      assert.equal(typeof recorded.occurredAt, "string");
      assert.equal("violationCount" in recorded, false);
      assert.equal("limit" in recorded, false);
      if (count < 3) assert.equal(recorded.suspension, null);
      if (count === 3) {
        assert.equal(typeof recorded.suspension.suspendedAt, "string");
        assert.equal(recorded.suspension.remainingSeconds > 0, true);
      }
    }

    const suspendedAdmission: any = await fetch(`${baseUrl}/api/student/admission`, { headers: { cookie: studentCookie } });
    assert.equal((await suspendedAdmission.json()).status, "policy_suspended");

    const suspendedResults: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/results`, { headers: { cookie: admin.cookie } });
    const suspendedRow: any = (await suspendedResults.json()).results[0];
    assert.equal(suspendedRow.gradingStatus, null);
    assert.equal(suspendedRow.warningCount, 3);
    assert.equal(suspendedRow.policySuspensionCount, 1);

    const resume: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/students/20260001/resume`, {
      method: "POST",
      headers: adminHeaders(admin.cookie, admin.csrfToken),
      body: "{}",
    });
    assert.equal(resume.status, 200);
    assert.equal((await resume.json()).status, "in_progress");

    const submit: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({
        confirmationToken: matureSubmissionConfirmation(studentCookie, "SUM-2026", "20260001"),
      }),
    });
    assert.equal(submit.status, 200);
    const submission: any = (await submit.json()).submission;
    assert.equal(submission.status, "received");
    assert.equal("totalScore" in submission, false);

    const terminalVerification: any = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json" },
      body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001" }),
    });
    assert.equal(terminalVerification.status, 200);
    assert.equal((await terminalVerification.json()).status, "waiting_approval");

    const privateCsv: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/results.csv`);
    assert.equal(privateCsv.status, 401);

    const results: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/results`, { headers: { cookie: admin.cookie } });
    assert.equal(results.status, 200);
    const resultRows: any = (await results.json()).results;
    assert.equal(resultRows[0].studentNumber, "20260001");
    assert.equal(typeof resultRows[0].score, "number");
    assert.equal(resultRows[0].warningCount, 3);
    assert.equal(resultRows[0].policySubmissionCount, 0);
    assert.equal(resultRows[0].policySuspensionCount, 1);
    assert.deepEqual(
      resultRows[0].warningEvents.map((event: any) => ({ attemptNumber: event.attemptNumber, eventType: event.eventType })),
      [
        { attemptNumber: 1, eventType: "copy_blocked" },
        { attemptNumber: 1, eventType: "page_hidden" },
        { attemptNumber: 1, eventType: "page_hidden" },
      ],
    );

    const detailResponse: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/students/20260001/result`, { headers: { cookie: admin.cookie } });
    assert.equal(detailResponse.status, 200);
    const detail: any = (await detailResponse.json()).result;
    assert.equal(detail.questions[0].formula, "=SUM(A2:A6)");

    const adjustment: any = await fetch(`${baseUrl}/api/admin/grade-results/${detail.questions[0].gradeResultId}/adjust`, {
      method: "POST",
      headers: adminHeaders(admin.cookie, admin.csrfToken),
      body: JSON.stringify({ newScore: 1.25, reason: "Reviewed formula manually." }),
    });
    assert.equal(adjustment.status, 200);
    assert.equal((await adjustment.json()).adjustment.newScore, 1.25);

    const csv: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/results.csv`, { headers: { cookie: admin.cookie } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    const csvText: any = await csv.text();
    assert.match(csvText, /20260001/);
    assert.match(csvText, /"Highest Score","Highest Maximum Score","Latest Score"/);
    assert.match(csvText, /"Warning Count","Policy Suspension Count","Forced Submission Count","Warning Events","Correct Count","Incorrect Count","Q01 Result"/);
    assert.match(csvText, /copy_blocked/);
    assert.match(csvText, /copy_blocked/);

    const warningCsv: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/warnings.csv`, { headers: { cookie: admin.cookie } });
    assert.equal(warningCsv.status, 200);
    assert.match(warningCsv.headers.get("content-disposition"), /warning-log\.csv/);
    const warningCsvText: any = await warningCsv.text();
    assert.match(warningCsvText, /"Log Type","Event Type","Occurred At"/);
    assert.match(warningCsvText, /"policy_suspension"/);

    const locked: any = await fetch(`${baseUrl}/api/student/answer`, {
      method: "PUT",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ questionKey: started.questions[0].key, formula: "=1", expectedVersion: 1 }),
    });
    assert.equal(locked.status, 404);

    const blocked: any = await fetch(`${baseUrl}/api/student/start`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json" },
      body: JSON.stringify({ browserPreflight: validBrowserPreflight }),
    });
    assert.equal(blocked.status, 403);
  });
});

test("teacher-authorised recovery replaces the old device session and preserves the answer", async () => {
  const server: any = createAppServer({ authConfig, studentExamRepository: createRepository() });
  await withFetchableServer(server, async (baseUrl) => {
    const firstVerification: any = await fetch(`${baseUrl}/api/student/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001", name: "Anil K." }) });
    const firstVerified: any = await firstVerification.json(); const firstCookie: any = responseCookie(firstVerification);
    const admin: any = await loginAdmin(baseUrl);
    await fetch(`${baseUrl}/api/admin/exams/SUM-2026/students/20260001/admit`, { method: "POST", headers: adminHeaders(admin.cookie, admin.csrfToken), body: "{}" });
    const firstStartResponse: any = await fetch(`${baseUrl}/api/student/start`, { method: "POST", headers: { cookie: firstCookie, "content-type": "application/json", "x-csrf-token": firstVerified.csrfToken }, body: JSON.stringify({ browserPreflight: validBrowserPreflight }) });
    const firstAttempt: any = (await firstStartResponse.json()).attempt;
    await fetch(`${baseUrl}/api/student/answer`, { method: "PUT", headers: { cookie: firstCookie, "content-type": "application/json", "x-csrf-token": firstVerified.csrfToken }, body: JSON.stringify({ questionKey: firstAttempt.questions[0].key, formula: "=SUM(A2:A6)", expectedVersion: 0 }) });

    const secondVerification: any = await fetch(`${baseUrl}/api/student/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001", name: "Anil K." }) });
    const secondVerified: any = await secondVerification.json(); const secondCookie: any = responseCookie(secondVerification);
    const blocked: any = await fetch(`${baseUrl}/api/student/start`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json", "x-csrf-token": secondVerified.csrfToken }, body: JSON.stringify({ browserPreflight: validBrowserPreflight }) });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, "DUPLICATE_SESSION");

    const missingCsrf: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/students/20260001/resume`, { method: "POST", headers: { cookie: admin.cookie } });
    assert.equal(missingCsrf.status, 403);
    const recovery: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/students/20260001/resume`, { method: "POST", headers: adminHeaders(admin.cookie, admin.csrfToken), body: "{}" });
    assert.equal(recovery.status, 200);
    assert.equal((await recovery.json()).status, "resume_ready");

    const resumedResponse: any = await fetch(`${baseUrl}/api/student/start`, { method: "POST", headers: { cookie: secondCookie, "content-type": "application/json", "x-csrf-token": secondVerified.csrfToken }, body: JSON.stringify({ browserPreflight: validBrowserPreflight }) });
    assert.equal(resumedResponse.status, 200);
    const resumed: any = (await resumedResponse.json()).attempt;
    assert.equal(resumed.deadlineAt, firstAttempt.deadlineAt);
    assert.equal(resumed.answers.values[firstAttempt.questions[0].key], "=SUM(A2:A6)");
    const heartbeat: any = await fetch(`${baseUrl}/api/student/heartbeat`, { method: "POST", headers: { cookie: secondCookie, "x-csrf-token": secondVerified.csrfToken } });
    assert.equal(heartbeat.status, 200);
  });
});

test("a submitted student can request and receive unlimited teacher-approved attempts using the original paper", async () => {
  const server: any = createAppServer({ authConfig, studentExamRepository: createRepository() });
  await withFetchableServer(server, async (baseUrl) => {
    const admin: any = await loginAdmin(baseUrl);
    const verification: any = await fetch(`${baseUrl}/api/student/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001", name: "Anil K." }) });
    const verified: any = await verification.json(); const studentCookie: any = responseCookie(verification);
    await fetch(`${baseUrl}/api/admin/exams/SUM-2026/students/20260001/admit`, { method: "POST", headers: adminHeaders(admin.cookie, admin.csrfToken), body: "{}" });
    const firstStart: any = await fetch(`${baseUrl}/api/student/start`, { method: "POST", headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken }, body: JSON.stringify({ browserPreflight: validBrowserPreflight }) });
    const firstAttempt: any = (await firstStart.json()).attempt;
    const firstSave: any = await fetch(`${baseUrl}/api/student/answer`, {
      method: "PUT",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ questionKey: firstAttempt.questions[0].key, formula: "=1", expectedVersion: 0 }),
    });
    assert.equal(firstSave.status, 200);
    const firstSubmit: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({
        confirmationToken: matureSubmissionConfirmation(studentCookie, "SUM-2026", "20260001"),
      }),
    });
    assert.equal(firstSubmit.status, 200);

    let previousAttempt: any = firstAttempt;
    for (let attemptNumber: any = 2; attemptNumber <= 3; attemptNumber += 1) {
      const requestResponse: any = await fetch(`${baseUrl}/api/student/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examCode: "SUM-2026", studentNumber: "20260001" }),
      });
      const request: any = await requestResponse.json();
      const requestCookie: any = responseCookie(requestResponse);
      assert.equal(request.status, "waiting_approval");

      const attendance: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/attendance`, { headers: { cookie: admin.cookie } });
      const waitingStudent: any = (await attendance.json()).students[0];
      assert.equal(waitingStudent.attemptCount, attemptNumber);
      assert.equal(waitingStudent.status, "waiting_approval");

      const approval: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/admit-selected`, {
        method: "POST",
        headers: adminHeaders(admin.cookie, admin.csrfToken),
        body: JSON.stringify({ studentNumbers: ["20260001"] }),
      });
      assert.equal(approval.status, 200);
      assert.deepEqual(await approval.json(), { admittedCount: 1 });

      const startResponse: any = await fetch(`${baseUrl}/api/student/start`, {
        method: "POST",
        headers: { cookie: requestCookie, "content-type": "application/json", "x-csrf-token": request.csrfToken },
        body: JSON.stringify({ browserPreflight: validBrowserPreflight }),
      });
      assert.equal(startResponse.status, 200);
      const attempt: any = (await startResponse.json()).attempt;
      assert.equal(attempt.attemptNumber, attemptNumber);
      assert.notEqual(attempt.id, previousAttempt.id);
      assert.deepEqual(attempt.answers.values, {});
      assert.deepEqual(attempt.questions, firstAttempt.questions);
      const saveResponse: any = await fetch(`${baseUrl}/api/student/answer`, {
        method: "PUT",
        headers: { cookie: requestCookie, "content-type": "application/json", "x-csrf-token": request.csrfToken },
        body: JSON.stringify({ questionKey: attempt.questions[0].key, formula: "=1", expectedVersion: 0 }),
      });
      assert.equal(saveResponse.status, 200);
      const submitResponse: any = await fetch(`${baseUrl}/api/student/submit`, {
        method: "POST",
        headers: { cookie: requestCookie, "content-type": "application/json", "x-csrf-token": request.csrfToken },
        body: JSON.stringify({
          confirmationToken: matureSubmissionConfirmation(requestCookie, "SUM-2026", "20260001"),
        }),
      });
      assert.equal(submitResponse.status, 200);
      previousAttempt = attempt;
    }

    const csv: any = await fetch(`${baseUrl}/api/admin/exams/SUM-2026/results.csv`, { headers: { cookie: admin.cookie } });
    assert.match(await csv.text(), /"Attempt Count"[\s\S]*,"3"/);
  });
});

test("teacher creates a rostered preparation draft that is closed until papers are ready", async () => {
  const repository: any = new InMemoryStudentExamRepository();
  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const admin: any = await loginAdmin(baseUrl);
    const missingRoster: any = await fetch(`${baseUrl}/api/admin/exams`, { method: "POST", headers: adminHeaders(admin.cookie, admin.csrfToken), body: JSON.stringify({ name: "Missing roster", mode: "assignment", assignmentOptions: { formulaQuestionCount: 6, choiceQuestionCount: 0 }, selectedFunctions: ["SUM"] }) });
    assert.equal(missingRoster.status, 422);
    assert.equal((await missingRoster.json()).code, "INVALID_ROSTER");
    const published: any = await fetch(`${baseUrl}/api/admin/exams`, { method: "POST", headers: adminHeaders(admin.cookie, admin.csrfToken), body: JSON.stringify({ name: "Published SUM", mode: "assignment", assignmentOptions: { formulaQuestionCount: 6, choiceQuestionCount: 0 }, selectedFunctions: ["SUM"], rosterCsv: "student_number,name\n20269999,Maya K." }) });
    assert.equal(published.status, 201);
    const exam: any = (await published.json()).exam;
    assert.match(exam.code, /^[A-HJ-NP-Z2-9]{7}$/);
    assert.equal(exam.rosterCount, 1);
    assert.equal(exam.preparationStatus, "pending");

    const unlisted: any = await fetch(`${baseUrl}/api/student/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ examCode: exam.code, studentNumber: "UNLISTED", name: "Unknown" }) });
    assert.equal(unlisted.status, 401);

    const listedBeforeReady: any = await fetch(`${baseUrl}/api/student/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ examCode: exam.code, studentNumber: "20269999", name: "Maya K." }) });
    assert.equal(listedBeforeReady.status, 401);

    const prepared: any = await fetch(`${baseUrl}/api/admin/exams/${exam.code}/preparation/step`, { method: "POST", headers: adminHeaders(admin.cookie, admin.csrfToken), body: JSON.stringify({ batchSize: 25 }) });
    assert.equal(prepared.status, 200);
    assert.equal((await prepared.json()).preparation.status, "ready");

    const listedAfterReady: any = await fetch(`${baseUrl}/api/student/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ examCode: exam.code, studentNumber: "20269999", name: "Maya K." }) });
    assert.equal(listedAfterReady.status, 200);
  });
});

test("teacher can create an exam from a valid decoded roster between the general and roster request limits", async () => {
  const repository: any = new InMemoryStudentExamRepository();
  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const admin: any = await loginAdmin(baseUrl);
    const rosterRows: any = Array.from({ length: 200 }, (_, index) => {
      const studentNumber: any = `S${String(index + 1).padStart(4, "0")}${"X".repeat(27)}`;
      return `${studentNumber},${"漢".repeat(100)}`;
    });
    const payload: any = JSON.stringify({
      name: "Large decoded roster",
      mode: "assignment",
      assignmentOptions: { formulaQuestionCountMode: "auto", choiceQuestionCount: 0 },
      selectedFunctions: ["SUM"],
      rosterCsv: `student_number,name\n${rosterRows.join("\n")}`,
    });

    assert.equal(Buffer.byteLength(payload) > 64 * 1024, true);
    assert.equal(Buffer.byteLength(payload) < 128 * 1024, true);
    const response: any = await fetch(`${baseUrl}/api/admin/exams`, {
      method: "POST",
      headers: adminHeaders(admin.cookie, admin.csrfToken),
      body: payload,
    });

    const responseBody: any = await response.json();
    assert.equal(response.status, 201, JSON.stringify(responseBody));
    assert.equal(responseBody.exam.rosterCount, 200);
  });
});

test("classroom assignments accept 500 rostered students while formal exams keep the 200-student limit", async () => {
  const repository: any = new InMemoryStudentExamRepository();
  const server: any = createAppServer({ authConfig, studentExamRepository: repository });
  await withFetchableServer(server, async (baseUrl) => {
    const admin: any = await loginAdmin(baseUrl);
    const rosterCsv: any = `student_number,name\n${Array.from({ length: 500 }, (_, index) => `C${String(index + 1).padStart(4, "0")},Student ${index + 1}`).join("\n")}`;
    const assignment: any = await fetch(`${baseUrl}/api/admin/exams`, {
      method: "POST",
      headers: adminHeaders(admin.cookie, admin.csrfToken),
      body: JSON.stringify({
        name: "All classes shared practice",
        mode: "assignment",
        assignmentOptions: { questionsPerFunction: 5 },
        selectedFunctions: ["SUM"],
        rosterCsv,
      }),
    });
    assert.equal(assignment.status, 201, JSON.stringify(await assignment.clone().json()));
    const assignmentExam: any = (await assignment.json()).exam;
    assert.equal(assignmentExam.rosterCount, 500);
    const room: any = await fetch(`${baseUrl}/api/admin/exams/${assignmentExam.code}/attendance`, {
      headers: { cookie: admin.cookie },
    });
    const roomBody: any = await room.json();
    assert.deepEqual(roomBody.room, {
      mode: "assignment",
      titleJa: "All classes shared practice",
      rosterCount: 500,
      state: "draft",
      subjectId: "00000000-0000-4000-8000-000000000023",
    });

    const formal: any = await fetch(`${baseUrl}/api/admin/exams`, {
      method: "POST",
      headers: adminHeaders(admin.cookie, admin.csrfToken),
      body: JSON.stringify({ name: "Formal capacity guard", mode: "exam", difficulty: "easy", selectedFunctions: ["SUM"], rosterCsv }),
    });
    assert.equal(formal.status, 422);
    const failure: any = await formal.json();
    assert.equal(failure.code, "INVALID_ROSTER");
    assert.equal(failure.errors[0].maximumStudents, 200);
  });
});
