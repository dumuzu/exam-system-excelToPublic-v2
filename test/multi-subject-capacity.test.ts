import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import { InMemoryExamHistoryRepository } from "../src/server/exam-history-repository.ts";
import { createAppServer } from "../src/server/server.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

const repositoryRoot = new URL("../", import.meta.url);

test("multi-subject capacity certification is a bounded TypeScript operation", async () => {
  const [packageJson, script] = await Promise.all([
    readFile(new URL("package.json", repositoryRoot), "utf8").then(JSON.parse),
    readFile(new URL("scripts/certify-postgres-multi-subject-load.ts", repositoryRoot), "utf8"),
  ]);
  assert.equal(
    packageJson.scripts["certify:multi-subject-load"],
    "node --env-file-if-exists=.env scripts/certify-postgres-multi-subject-load.ts",
  );
  assert.match(script, /process\.env\["CAPACITY_TEST_DATABASE_URL"\]/);
  assert.match(script, /CAPACITY_CERTIFICATION_CONFIRM.*TEMPORARY_BRANCH_ONLY/s);
  assert.match(script, /const teacherCount = 5/);
  assert.match(script, /p95BudgetsMs/);
  assert.match(script, /mapWithConcurrency\(exams, databasePoolMax/);
  assert.match(script, /while \(!result[?][.]completed\)/);
});

const teacherCount = 5;
const rosterSize = 200;
const activeStudentsPerSubject = 10;

function responseCookie(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

function subjectId(index: number): string {
  return `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function teacherId(index: number): string {
  return `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function rosterCsv(teacherIndex: number): string {
  return `student_number,name\n${Array.from({ length: rosterSize }, (_, studentIndex) =>
    `T${teacherIndex + 1}-${String(studentIndex + 1).padStart(4, "0")},Teacher ${teacherIndex + 1} Student ${studentIndex + 1}`
  ).join("\n")}`;
}

async function mapWithConcurrency<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  operation: (value: Value, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!, index);
    }
  }));
  return results;
}

async function expectJson(response: Response, status = 200): Promise<any> {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test("five authenticated teachers operate isolated 200-student subjects under concurrent traffic", { timeout: 30_000 }, async (context) => {
  const passwords = Array.from({ length: teacherCount }, (_, index) => `capacity-teacher-${index + 1}-password`);
  const authAccounts = passwords.map((password, index) => ({
    username: `capacity-teacher-${index + 1}`,
    passwordHash: hashAdminPassword(password, { salt: String(index + 1).repeat(32) }),
    role: ADMIN_ROLES.TEACHER,
  }));
  const accounts = authAccounts.map((account, index) => ({
    id: teacherId(index),
    username: account.username,
    displayName: `Capacity Teacher ${index + 1}`,
    passwordHash: account.passwordHash,
    role: account.role,
    status: "active" as const,
    credentialVersion: 1,
    sessionVersion: 1,
  }));
  const subjects = Array.from({ length: teacherCount }, (_, index) => ({
    id: subjectId(index),
    code: `capacity-subject-${index + 1}`,
    nameJa: `容量科目 ${index + 1}`,
    nameZh: `容量科目 ${index + 1}`,
    assessmentTypeKey: "excel_formula",
  }));
  const memberships = accounts.map((account, index) => ({
    accountId: account.id,
    subjectId: subjects[index]!.id,
    subjectCode: subjects[index]!.code,
    subjectName: subjects[index]!.nameZh,
    subjectRole: "teacher" as const,
    status: "active" as const,
  }));
  const teacherAccounts = new InMemoryTeacherAccountRepository({ accounts, subjects, memberships });
  const exams = new InMemoryStudentExamRepository();
  const server = createAppServer({
    authConfig: { sessionSecret: "capacity-certification-session-secret-at-least-32-characters", accounts: authAccounts },
    capacityPolicy: { loginRateLimit: 20 },
    teacherAccountRepository: teacherAccounts,
    historyRepository: new InMemoryExamHistoryRepository(),
    studentExamRepository: exams,
  });

  await withFetchableServer(server, async (baseUrl) => {
    const timings: Record<string, number> = {};
    let phaseStarted = performance.now();
    const teachers = await Promise.all(authAccounts.map(async (account, index) => {
      const response = await fetch(`${baseUrl}/api/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${index + 1}` },
        body: JSON.stringify({ username: account.username, password: passwords[index] }),
      });
      const session = await expectJson(response);
      return { index, cookie: responseCookie(response), session, subject: subjects[index]! };
    }));
    timings["login"] = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    const teacherExams = await Promise.all(teachers.map(async (teacher) => {
      const response = await fetch(`${baseUrl}/api/admin/exams`, {
        method: "POST",
        headers: {
          cookie: teacher.cookie,
          "content-type": "application/json",
          "x-csrf-token": teacher.session.csrfToken,
          "x-subject-id": teacher.subject.id,
        },
        body: JSON.stringify({
          name: `Capacity subject ${teacher.index + 1}`,
          mode: "exam",
          difficulty: "easy",
          selectedFunctions: FUNCTION_CATALOG.map((definition) => definition.name),
          rosterCsv: rosterCsv(teacher.index),
        }),
      });
      return (await expectJson(response, 201)).exam;
    }));
    assert.equal(new Set(teacherExams.map((exam) => exam.code)).size, teacherCount);
    assert.equal(teacherExams.every((exam) => exam.rosterCount === rosterSize), true);
    timings["publish"] = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    await Promise.all(teacherExams.map(async (exam, index) => {
      let preparation: any;
      do {
        const response = await fetch(`${baseUrl}/api/admin/exams/${exam.code}/preparation/step`, {
          method: "POST",
          headers: {
            cookie: teachers[index]!.cookie,
            "content-type": "application/json",
            "x-csrf-token": teachers[index]!.session.csrfToken,
            "x-subject-id": subjects[index]!.id,
          },
          body: JSON.stringify({ batchSize: 25 }),
        });
        preparation = (await expectJson(response)).preparation;
      } while (preparation.status === "generating");
      assert.equal(preparation.status, "ready");
      assert.equal(preparation.generatedQuestionCount, rosterSize * 40);
    }));
    timings["prepare"] = performance.now() - phaseStarted;

    const activeEntries = teacherExams.flatMap((exam, teacherIndex) =>
      Array.from({ length: activeStudentsPerSubject }, (_, studentIndex) => ({
        exam,
        teacherIndex,
        studentNumber: `T${teacherIndex + 1}-${String(studentIndex + 1).padStart(4, "0")}`,
      })),
    );
    phaseStarted = performance.now();
    const verifiedStudents = await mapWithConcurrency(activeEntries, 20, async (entry, index) => {
      const response = await fetch(`${baseUrl}/api/student/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `198.51.${entry.teacherIndex}.${index + 1}` },
        body: JSON.stringify({ examCode: entry.exam.code, studentNumber: entry.studentNumber }),
      });
      return { ...entry, cookie: responseCookie(response), verified: await expectJson(response) };
    });
    await Promise.all(teachers.map(async (teacher, index) => {
      const response = await fetch(`${baseUrl}/api/admin/exams/${teacherExams[index]!.code}/admit-waiting`, {
        method: "POST",
        headers: {
          cookie: teacher.cookie,
          "x-csrf-token": teacher.session.csrfToken,
          "x-subject-id": teacher.subject.id,
        },
      });
      assert.equal((await expectJson(response)).admittedCount, activeStudentsPerSubject);
    }));
    timings["verifyAndAdmit"] = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    const attempts = await mapWithConcurrency(verifiedStudents, 20, async (student) => {
      const response = await fetch(`${baseUrl}/api/student/start`, {
        method: "POST",
        headers: { cookie: student.cookie, "content-type": "application/json", "x-csrf-token": student.verified.csrfToken },
        body: JSON.stringify({ browserPreflight: {
          secureContext: true,
          fullscreen: true,
          localStorage: true,
          visibility: true,
          network: true,
          browserFamily: "chrome",
          browserVersion: 120,
          browserSupported: true,
        } }),
      });
      return { ...student, attempt: (await expectJson(response)).attempt };
    });
    assert.equal(new Set(attempts.map((entry) => entry.attempt.id)).size, activeEntries.length);
    timings["start"] = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    await mapWithConcurrency(attempts, 20, async (student) => {
      const headers = { cookie: student.cookie, "content-type": "application/json", "x-csrf-token": student.verified.csrfToken };
      const [heartbeat, answer] = await Promise.all([
        fetch(`${baseUrl}/api/student/heartbeat`, { method: "POST", headers }),
        fetch(`${baseUrl}/api/student/answer`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ questionKey: student.attempt.questions[0].key, formula: "=1", expectedVersion: 0 }),
        }),
      ]);
      assert.equal((await expectJson(heartbeat)).status, "active");
      assert.equal((await expectJson(answer)).answer.version, 1);
    });
    await Promise.all(teachers.map(async (teacher, index) => {
      const response = await fetch(`${baseUrl}/api/admin/exams/${teacherExams[index]!.code}/attendance`, {
        headers: { cookie: teacher.cookie, "x-subject-id": teacher.subject.id },
      });
      assert.equal((await expectJson(response)).students.length, rosterSize);
    }));
    timings["pollHeartbeatAutosave"] = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    const manualStudents = attempts.filter((_, index) => index % activeStudentsPerSubject === 0);
    const confirmationTokens = await Promise.all(manualStudents.map(async (student) => {
      const response = await fetch(`${baseUrl}/api/student/submission-confirmation`, {
        method: "POST",
        headers: { cookie: student.cookie, "x-csrf-token": student.verified.csrfToken },
      });
      return (await expectJson(response, 201)).confirmationToken;
    }));
    await new Promise((resolve) => setTimeout(resolve, 1_550));
    await Promise.all(manualStudents.map(async (student, index) => {
      const response = await fetch(`${baseUrl}/api/student/submit`, {
        method: "POST",
        headers: { cookie: student.cookie, "content-type": "application/json", "x-csrf-token": student.verified.csrfToken },
        body: JSON.stringify({ answers: { [student.attempt.questions[0].key]: "=1" }, confirmationToken: confirmationTokens[index] }),
      });
      await expectJson(response);
    }));
    timings["manualSubmission"] = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    await Promise.all(teachers.map(async (teacher, index) => {
      const response = await fetch(`${baseUrl}/api/admin/exams/${teacherExams[index]!.code}/termination-collection`, {
        method: "POST",
        headers: {
          cookie: teacher.cookie,
          "content-type": "application/json",
          "x-csrf-token": teacher.session.csrfToken,
          "x-subject-id": teacher.subject.id,
        },
        body: JSON.stringify({ confirmationCode: teacherExams[index]!.code }),
      });
      await expectJson(response);
    }));
    await new Promise((resolve) => setTimeout(resolve, 8_100));
    await Promise.all(teachers.map(async (teacher, index) => {
      const response = await fetch(`${baseUrl}/api/admin/exams/${teacherExams[index]!.code}/terminate`, {
        method: "POST",
        headers: {
          cookie: teacher.cookie,
          "content-type": "application/json",
          "x-csrf-token": teacher.session.csrfToken,
          "x-subject-id": teacher.subject.id,
        },
        body: JSON.stringify({ confirmationCode: teacherExams[index]!.code }),
      });
      const body = await expectJson(response);
      assert.equal(body.exam.teacherSubmittedCount, activeStudentsPerSubject - 1);
    }));
    timings["collection"] = performance.now() - phaseStarted;

    phaseStarted = performance.now();
    await Promise.all(teachers.map(async (teacher, index) => {
      const ownResponse = await fetch(`${baseUrl}/api/admin/exams/${teacherExams[index]!.code}/results`, {
        headers: { cookie: teacher.cookie, "x-subject-id": teacher.subject.id },
      });
      const ownResults = (await expectJson(ownResponse)).results;
      assert.equal(ownResults.length, rosterSize);
      assert.equal(ownResults.filter((result: any) => result.gradingStatus === "graded").length, activeStudentsPerSubject);
      const otherIndex = (index + 1) % teacherCount;
      const crossed = await fetch(`${baseUrl}/api/admin/exams/${teacherExams[otherIndex]!.code}/results`, {
        headers: { cookie: teacher.cookie, "x-subject-id": teacher.subject.id },
      });
      assert.equal(crossed.status, 404);
    }));
    timings["resultsAndIsolation"] = performance.now() - phaseStarted;

    context.diagnostic(JSON.stringify({
      teacherSessions: teacherCount,
      independentSubjects: teacherCount,
      rosteredCandidates: teacherCount * rosterSize,
      activeCandidates: activeEntries.length,
      manuallySubmitted: manualStudents.length,
      teacherCollected: activeEntries.length - manualStudents.length,
      timingsMs: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Math.round(value)])),
    }));
  });
});
