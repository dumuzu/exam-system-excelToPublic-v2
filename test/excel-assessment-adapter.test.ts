import assert from "node:assert/strict";
import test from "node:test";

import { excelAssessmentAdapter } from "../src/assessment-types/excel/index.ts";
import { gradeSubmission } from "../src/core/formula-grader.ts";

const formalAuthoring: any = {
  mode: "exam",
  difficulty: "normal",
  selectedFunctions: ["SUM"],
};

test("the Excel adapter preserves deterministic participant papers and existing scores", async () => {
  const configuration: any = excelAssessmentAdapter.validateAuthoring({ mode: "exam", input: formalAuthoring });
  assert.equal(configuration.ok, true);

  const preparationInput: any = {
    eventId: "EXCEL-42",
    mode: "exam",
    seed: "20260001",
    scope: { kind: "participant", participantKey: "20260001" },
    configuration: configuration.value,
  };
  const first: any = await excelAssessmentAdapter.preparePaper(preparationInput);
  const repeated: any = await excelAssessmentAdapter.preparePaper(preparationInput);
  const anotherStudent: any = await excelAssessmentAdapter.preparePaper({
    ...preparationInput,
    seed: "20260002",
    scope: { kind: "participant", participantKey: "20260002" },
  });

  assert.equal(first.ok, true);
  assert.deepEqual(repeated, first);
  assert.notDeepEqual(anotherStudent.value.questions, first.value.questions);

  const answers: any = Object.fromEntries(first.value.questions.map((question: any) => [
    question.key,
    question.answerKey.allowedFormula ?? question.answerKey.correctOption,
  ]));
  const validated: any = excelAssessmentAdapter.validateResponse({ mode: "exam", paper: first.value, input: answers });
  assert.equal(validated.ok, true);
  const adapterGrade: any = await excelAssessmentAdapter.gradeResponse({
    mode: "exam",
    paper: first.value,
    response: validated.value,
  });
  assert.deepEqual(adapterGrade, gradeSubmission({ questions: first.value.questions, answers }));

  const studentView: any = excelAssessmentAdapter.createStudentView({ mode: "exam", paper: first.value });
  assert.equal(studentView.questions.length, 50);
  assert.equal(studentView.questions.some((question: any) => "answerKey" in question || "scoringRule" in question), false);
});

test("the Excel adapter keeps formal exam and classroom assignment workspace policies explicit", async () => {
  const formalWorkspace: any = excelAssessmentAdapter.getStudentWorkspaceCapabilities("exam");
  const assignmentWorkspace: any = excelAssessmentAdapter.getStudentWorkspaceCapabilities("assignment");
  assert.deepEqual(
    {
      requiresAdmission: formalWorkspace.requiresAdmission,
      requiresFullscreen: formalWorkspace.requiresFullscreen,
      hasTimeLimit: formalWorkspace.hasTimeLimit,
      proctoringEnabled: formalWorkspace.proctoringEnabled,
      autosaveEnabled: formalWorkspace.autosaveEnabled,
      sharedPaper: formalWorkspace.sharedPaper,
      revealScoreAfterSubmission: formalWorkspace.revealScoreAfterSubmission,
      maximumAttempts: formalWorkspace.maximumAttempts,
    },
    {
      requiresAdmission: true,
      requiresFullscreen: true,
      hasTimeLimit: true,
      proctoringEnabled: true,
      autosaveEnabled: true,
      sharedPaper: false,
      revealScoreAfterSubmission: false,
      maximumAttempts: null,
    },
  );
  assert.deepEqual(
    {
      requiresAdmission: assignmentWorkspace.requiresAdmission,
      requiresFullscreen: assignmentWorkspace.requiresFullscreen,
      hasTimeLimit: assignmentWorkspace.hasTimeLimit,
      proctoringEnabled: assignmentWorkspace.proctoringEnabled,
      autosaveEnabled: assignmentWorkspace.autosaveEnabled,
      sharedPaper: assignmentWorkspace.sharedPaper,
      revealScoreAfterSubmission: assignmentWorkspace.revealScoreAfterSubmission,
      maximumAttempts: assignmentWorkspace.maximumAttempts,
    },
    {
      requiresAdmission: false,
      requiresFullscreen: false,
      hasTimeLimit: false,
      proctoringEnabled: false,
      autosaveEnabled: false,
      sharedPaper: true,
      revealScoreAfterSubmission: true,
      maximumAttempts: 2,
    },
  );

  const configuration: any = excelAssessmentAdapter.validateAuthoring({
    mode: "assignment",
    input: { mode: "assignment", assignmentOptions: { questionsPerFunction: 5 }, selectedFunctions: ["SUM"] },
  });
  assert.equal(configuration.ok, true);
  const shared: any = await excelAssessmentAdapter.preparePaper({
    eventId: "CLASS-42",
    mode: "assignment",
    seed: "ignored-for-shared-paper",
    scope: { kind: "shared" },
    configuration: configuration.value,
  });
  assert.equal(shared.ok, true);
  assert.equal(shared.value.questions.length, 5);
});
