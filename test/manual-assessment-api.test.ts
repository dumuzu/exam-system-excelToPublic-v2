import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import { createSubmissionConfirmation, hashStudentSession } from "../src/server/student-auth.ts";
import { InMemoryExamHistoryRepository } from "../src/server/exam-history-repository.ts";
import { createAppServer } from "../src/server/server.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";
import { InMemoryTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";
import { withFetchableServer } from "../test-support/http-test-server.ts";

const subjectId = "20000000-0000-4000-8000-000000000001";
const teacherId = "manual-teacher-1";
const password = "manual-teacher-test-password";
const passwordHash = hashAdminPassword(password, { salt: "44444444444444444444444444444444" });
const authConfig: any = {
  sessionSecret: "manual-assessment-session-secret-that-is-long-enough",
  accounts: [{ username: "manual-teacher", passwordHash, role: ADMIN_ROLES.TEACHER }],
};
const questions: any[] = [
  {
    key: "single-1",
    type: "single_choice",
    promptMarkdown: "请选择 **正确** 的答案。",
    options: [{ id: "a", markdown: "甲" }, { id: "b", markdown: "乙" }],
    correctOptionIds: ["b"],
  },
  {
    key: "multiple-1",
    type: "multiple_choice",
    promptMarkdown: "请选择所有正确项。",
    options: [{ id: "a", markdown: "一" }, { id: "b", markdown: "二" }, { id: "c", markdown: "三" }],
    correctOptionIds: ["a", "c"],
  },
  {
    key: "blank-1",
    type: "fill_blank",
    promptMarkdown: "补全句子。",
    segments: [
      { kind: "text", markdown: "TypeScript 是 " },
      { kind: "blank", id: "blank-1", acceptedAnswers: ["JavaScript"] },
      { kind: "text", markdown: " 的超集。" },
    ],
  },
  {
    key: "short-1",
    type: "short_answer",
    promptMarkdown: "请用 Markdown 简述类型检查的价值。",
    referenceAnswerMarkdown: "能够在运行前发现一部分类型错误。",
  },
];
const browserPreflight: any = {
  secureContext: true,
  fullscreen: true,
  localStorage: true,
  visibility: true,
  network: true,
  browserFamily: "safari",
  browserVersion: 16.4,
  browserSupported: true,
};

function cookies(response: any): string {
  return response.headers.getSetCookie().map((value: string) => value.split(";", 1)[0]).join("; ");
}

test("ordinary subject teacher can author, publish, deliver and review all manual question types", async () => {
  const teacherAccounts: any = new InMemoryTeacherAccountRepository({
    accounts: [{
      id: teacherId,
      username: "manual-teacher",
      displayName: "Manual Teacher",
      passwordHash,
      role: ADMIN_ROLES.TEACHER,
      status: "active",
      credentialVersion: 1,
      sessionVersion: 1,
    }],
    subjects: [{ id: subjectId, code: "manual-test", nameJa: "テスト", nameZh: "测试", assessmentTypeKey: "manual_questions" }],
    memberships: [{ accountId: teacherId, subjectId, subjectCode: "manual-test", subjectName: "测试", subjectRole: "teacher", status: "active" }],
  });
  const repository: any = new InMemoryStudentExamRepository();
  const server: any = createAppServer({
    authConfig,
    teacherAccountRepository: teacherAccounts,
    historyRepository: new InMemoryExamHistoryRepository(),
    studentExamRepository: repository,
  });

  await withFetchableServer(server, async (baseUrl) => {
    const login: any = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "manual-teacher", password }),
    });
    assert.equal(login.status, 200);
    const session: any = await login.json();
    const teacherCookie = cookies(login);
    const teacherHeaders: any = {
      cookie: teacherCookie,
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
      "x-subject-id": subjectId,
    };

    const modes: any = await fetch(`${baseUrl}/api/admin/exam-modes`, { headers: teacherHeaders });
    assert.deepEqual((await modes.json()).modes, [{ key: "exam", configurable: true, authoringKind: "manual_questions" }]);

    const preview: any = await fetch(`${baseUrl}/api/admin/exam-preview`, {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({ questions }),
    });
    assert.equal(preview.status, 200);
    const previewBody: any = await preview.json();
    assert.equal(previewBody.plan.questionCounts.formula, 4);
    assert.deepEqual(previewBody.plan.manualQuestionCounts, { single_choice: 1, multiple_choice: 1, fill_blank: 1, short_answer: 1 });

    const saved: any = await fetch(`${baseUrl}/api/admin/exam-configurations`, {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({ name: "四题型模板", questions }),
    });
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).configuration.assessmentTypeKey, "manual_questions");

    const published: any = await fetch(`${baseUrl}/api/admin/exams`, {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({ name: "测试科目考试", questions, rosterCsv: "student_number,name\nS001,Student One" }),
    });
    assert.equal(published.status, 201);
    const exam: any = (await published.json()).exam;
    const prepared: any = await fetch(`${baseUrl}/api/admin/exams/${exam.code}/preparation/step`, {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({ batchSize: 25 }),
    });
    assert.equal(prepared.status, 200);
    assert.equal((await prepared.json()).preparation.status, "ready");

    const verification: any = await fetch(`${baseUrl}/api/student/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode: exam.code, studentNumber: "S001" }),
    });
    assert.equal(verification.status, 200);
    const verified: any = await verification.json();
    const studentCookie = cookies(verification);
    const admission: any = await fetch(`${baseUrl}/api/admin/exams/${exam.code}/students/S001/admit`, {
      method: "POST",
      headers: teacherHeaders,
      body: "{}",
    });
    assert.equal(admission.status, 200);

    const start: any = await fetch(`${baseUrl}/api/student/start`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ browserPreflight }),
    });
    assert.equal(start.status, 200);
    const attempt: any = (await start.json()).attempt;
    assert.deepEqual(attempt.questions.map((question: any) => question.questionMode), ["single_choice", "multiple_choice", "fill_blank", "short_answer"]);
    assert.doesNotMatch(JSON.stringify(attempt.questions), /correctOptionIds|acceptedAnswers|referenceAnswerMarkdown/);

    const responses: any[] = ["b", ["a", "c"], { "blank-1": "JavaScript" }, "**静态检查** 可以更早发现错误。"];
    for (let index = 0; index < attempt.questions.length; index += 1) {
      const answer: any = await fetch(`${baseUrl}/api/student/answer`, {
        method: "PUT",
        headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
        body: JSON.stringify({ questionKey: attempt.questions[index].key, answer: responses[index], expectedVersion: index }),
      });
      assert.equal(answer.status, 200);
    }

    const rawStudentToken = studentCookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("student_session="))!.slice("student_session=".length);
    const confirmationToken = createSubmissionConfirmation({
      examCode: exam.code,
      studentNumber: "S001",
      sessionTokenHash: hashStudentSession(rawStudentToken),
      sessionSecret: authConfig.sessionSecret,
      now: Date.now() - 2_000,
    });
    const submitted: any = await fetch(`${baseUrl}/api/student/submit`, {
      method: "POST",
      headers: { cookie: studentCookie, "content-type": "application/json", "x-csrf-token": verified.csrfToken },
      body: JSON.stringify({ confirmationToken }),
    });
    assert.equal(submitted.status, 200);

    const collected: any = await fetch(`${baseUrl}/api/admin/exams/${exam.code}/students/S001/result`, { headers: teacherHeaders });
    assert.equal(collected.status, 200);
    const result: any = (await collected.json()).result;
    assert.deepEqual(result.questions.slice(0, 3).map((question: any) => question.resultStatus), ["correct", "correct", "correct"]);
    assert.equal(result.questions[3].resultStatus, "review_required");
    assert.equal(result.questions[3].answer, responses[3]);
    assert.equal(result.questions[3].referenceAnswer, questions[3].referenceAnswerMarkdown);

    assert.equal((await repository.listResults(exam.code))[0].gradingStatus, "review_required");
    const adjusted: any = await fetch(`${baseUrl}/api/admin/grade-results/${result.questions[3].gradeResultId}/adjust`, {
      method: "POST",
      headers: teacherHeaders,
      body: JSON.stringify({ newScore: 1, reason: "人工复核完成" }),
    });
    assert.equal(adjusted.status, 200);
    assert.equal((await repository.listResults(exam.code))[0].gradingStatus, "graded");
  });
});
