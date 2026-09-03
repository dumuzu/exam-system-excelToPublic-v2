import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decodeManagedAccountId,
  validateAccountCreation,
  validateAccountMembershipMutation,
  validateAccountPage,
} from "../src/features/account-administration/domain/account-input.ts";
import {
  composeSubjectAssessment,
  supportsSubjectAssessment,
  validateConfigurationPayload,
  validatePlanPayload,
} from "../src/features/assessment-authoring/domain/assessment-authoring.ts";
import {
  validateAnswerPayload,
  validateBrowserPreflight,
  validateGradeAdjustment,
  validateStudentVerificationPayload,
  validateSubmissionPayload,
} from "../src/features/exam-delivery/domain/exam-input.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("account administration validates typed commands without trusting extra fields", () => {
  assert.deepEqual(validateAccountPage(new URL("https://exam.test/accounts?page=2&pageSize=50")), { page: 2, pageSize: 50 });
  assert.equal(validateAccountPage(new URL("https://exam.test/accounts?page=0&pageSize=100")), null);
  assert.equal(decodeManagedAccountId("teacher%3A01"), "teacher:01");
  assert.equal(decodeManagedAccountId("..%2Fsecret"), null);

  assert.deepEqual(validateAccountCreation({
    username: "Teacher_01",
    displayName: " 王老师 ",
    password: "Strong-password-2026",
    confirmed: true,
  }), {
    username: "teacher_01",
    displayName: "王老师",
    password: "Strong-password-2026",
    confirmed: true,
    platformRole: "teacher",
  });
  assert.equal(validateAccountCreation({
    username: "teacher_01",
    displayName: "王老师",
    password: "Strong-password-2026",
    confirmed: true,
    permissions: ["manage_accounts"],
  }), null);
  assert.deepEqual(validateAccountMembershipMutation({
    subjectId: "subject:test",
    subjectRole: "teacher",
    confirmed: true,
  }), { subjectId: "subject:test", subjectRole: "teacher", confirmed: true });
  assert.equal(validateAccountMembershipMutation({
    subjectId: "subject:test",
    subjectRole: "teacher",
    confirmed: false,
  }), null);
});

test("assessment authoring composes manual questions and preserves publication audit binding", () => {
  assert.deepEqual(validatePlanPayload({ selectedFunctions: [] }), {
    valid: false,
    code: "NO_FUNCTIONS_SELECTED",
    error: "请至少勾选一个函数。",
  });
  assert.equal(validateConfigurationPayload({ name: "", selectedFunctions: ["SUM"] }).valid, false);

  const subject = { assessmentTypeKey: "manual_questions" };
  const composition = composeSubjectAssessment(subject, {
    questions: [{
      key: "q1",
      type: "single_choice",
      promptMarkdown: "请选择正确答案",
      options: [{ id: "a", markdown: "答案 A" }, { id: "b", markdown: "答案 B" }],
      correctOptionIds: ["a"],
    }],
  });
  assert.equal(supportsSubjectAssessment(subject), true);
  assert.equal(composition.ok, true);
  if (!composition.ok) return;
  assert.equal(composition.plan["assessmentTypeKey"], "manual_questions");
  assert.equal(composition.publicationAudit.ok, true);
  assert.match(String(composition.publicationAudit.blueprints[0]?.["contentHash"]), /^[0-9a-f]{64}$/);

  assert.deepEqual(composeSubjectAssessment({ assessmentTypeKey: "future_subject" }, {}).errors[0]?.code, "ASSESSMENT_TYPE_UNSUPPORTED");
});

test("exam delivery bounds autosave, submission, browser and grading inputs", () => {
  assert.deepEqual(validateStudentVerificationPayload({ examCode: " ex-01 ", studentNumber: "００１" }), {
    valid: true,
    examCode: "EX-01",
    studentNumber: "001",
  });
  assert.ok(validateBrowserPreflight({
    secureContext: true,
    fullscreen: true,
    localStorage: true,
    visibility: true,
    network: true,
    browserSupported: true,
    browserFamily: "chrome",
    browserVersion: 140,
  }));
  assert.deepEqual(validateAnswerPayload({
    questionKey: "q_1",
    answer: ["a", "b"],
    expectedVersion: 3,
    clientSavedAt: "2026-08-30T00:00:00.000Z",
  }), {
    questionKey: "q_1",
    answerValue: ["a", "b"],
    formula: "",
    expectedVersion: 3,
    clientSavedAt: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(validateAnswerPayload({ questionKey: "q_1", answer: ["a", "a"], expectedVersion: 3 }), null);
  assert.deepEqual(validateSubmissionPayload({ answers: { q_1: { blank_1: "回答" } } }), {
    answers: { q_1: { blank_1: "回答" } },
    confirmationToken: null,
  });
  assert.deepEqual(validateGradeAdjustment({ newScore: 92.126, reason: "复核后修正" }), {
    newScore: 92.13,
    reason: "复核后修正",
  });
});

test("HTTP entry delegates the extracted rules to feature-first modules", async () => {
  const serverSource = await readFile(path.join(repositoryRoot, "src", "server", "server.ts"), "utf8");
  assert.match(serverSource, /features\/account-administration\/domain\/account-input\.ts/);
  assert.match(serverSource, /features\/assessment-authoring\/domain\/assessment-authoring\.ts/);
  assert.match(serverSource, /features\/exam-delivery\/domain\/exam-input\.ts/);
  for (const extractedDefinition of [
    "function validateAccountCreation",
    "function composeSubjectAssessment",
    "function validateAnswerPayload",
    "function validateSubmissionPayload",
  ]) assert.doesNotMatch(serverSource, new RegExp(extractedDefinition));

  for (const modulePath of [
    "src/features/account-administration/domain/account-input.ts",
    "src/features/assessment-authoring/domain/assessment-authoring.ts",
    "src/features/exam-delivery/domain/exam-input.ts",
  ]) {
    const source = await readFile(path.join(repositoryRoot, modulePath), "utf8");
    assert.doesNotMatch(source, /\bany\b/);
    assert.match(source, /[\u3400-\u9fff]/);
  }
});
