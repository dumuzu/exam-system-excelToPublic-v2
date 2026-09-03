import assert from "node:assert/strict";
import test from "node:test";

import { manualAssessmentAdapter } from "../src/assessment-types/manual/index.ts";

const authoring = {
  questions: [
    {
      key: "single-1",
      type: "single_choice",
      promptMarkdown: "**最も適切な**答えを選んでください。",
      options: [
        { id: "a", markdown: "選択肢 A" },
        { id: "b", markdown: "選択肢 B" },
      ],
      correctOptionIds: ["b"],
    },
    {
      key: "multiple-1",
      type: "multiple_choice",
      promptMarkdown: "該当するものをすべて選んでください。",
      options: [
        { id: "a", markdown: "A" },
        { id: "b", markdown: "B" },
        { id: "c", markdown: "C" },
      ],
      correctOptionIds: ["a", "c"],
    },
    {
      key: "blank-1",
      type: "fill_blank",
      promptMarkdown: "空欄を埋めてください。",
      segments: [
        { kind: "text", markdown: "日本の首都は" },
        { kind: "blank", id: "city", acceptedAnswers: ["東京", "とうきょう"] },
        { kind: "text", markdown: "です。" },
      ],
    },
    {
      key: "short-1",
      type: "short_answer",
      promptMarkdown: "理由を **Markdown** で説明してください。",
      image: { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", alt: "参考図" },
      referenceAnswerMarkdown: "## 採点参考\n論点を説明する。",
    },
  ],
};

test("manual adapter prepares four teacher-authored question types without leaking answer keys", async () => {
  const configuration = manualAssessmentAdapter.validateAuthoring({ mode: "exam", input: authoring });
  assert.equal(configuration.ok, true);
  if (!configuration.ok) return;
  const prepared = await manualAssessmentAdapter.preparePaper({
    eventId: "MANUAL-1",
    mode: "exam",
    seed: "student-1",
    scope: { kind: "participant", participantKey: "student-1" },
    configuration: configuration.value,
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const studentView = manualAssessmentAdapter.createStudentView({ mode: "exam", paper: prepared.value });
  assert.deepEqual(studentView.questions.map((question) => question["questionMode"]), [
    "single_choice", "multiple_choice", "fill_blank", "short_answer",
  ]);
  assert.doesNotMatch(JSON.stringify(studentView), /correctOptionIds|acceptedAnswers|referenceAnswerMarkdown/);
  assert.match(String(studentView.questions[3]?.["promptMarkdown"]), /Markdown/);
  assert.equal((studentView.questions[3]?.["image"] as { dataUrl: string }).dataUrl.startsWith("data:image/png;base64,"), true);
});

test("manual adapter automatically grades keyed objective answers and queues short answers for review", async () => {
  const configuration = manualAssessmentAdapter.validateAuthoring({ mode: "exam", input: authoring });
  assert.equal(configuration.ok, true);
  if (!configuration.ok) return;
  const prepared = await manualAssessmentAdapter.preparePaper({
    eventId: "MANUAL-2",
    mode: "exam",
    seed: "student-2",
    scope: { kind: "participant", participantKey: "student-2" },
    configuration: configuration.value,
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const response = manualAssessmentAdapter.validateResponse({
    mode: "exam",
    paper: prepared.value,
    input: {
      "single-1": "b",
      "multiple-1": ["c", "a"],
      "blank-1": { city: " 東京 " },
      "short-1": "## 私の回答\n説明です。",
    },
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  const grade = await manualAssessmentAdapter.gradeResponse({ mode: "exam", paper: prepared.value, response: response.value });
  assert.equal(grade.awardedScore, 3);
  assert.equal(grade.maximumScore, 4);
  assert.equal(grade.gradingStatus, "review_required");
  assert.deepEqual(grade.questionGrades.map((item) => item.resultStatus), ["correct", "correct", "correct", "review_required"]);
  assert.match(String(grade.questionGrades[3]?.referenceAnswer), /採点参考/);
});

test("manual adapter accepts optional answer keys but rejects attachments and unsafe or oversized prompt images", async () => {
  const withoutKeys = manualAssessmentAdapter.validateAuthoring({
    mode: "exam",
    input: {
      questions: [
        { key: "choice", type: "single_choice", promptMarkdown: "Answer", options: [{ id: "a", markdown: "A" }, { id: "b", markdown: "B" }] },
        { key: "blank", type: "fill_blank", promptMarkdown: "Fill", segments: [{ kind: "blank", id: "one" }] },
      ],
    },
  });
  assert.equal(withoutKeys.ok, true);
  if (!withoutKeys.ok) return;
  const paper = await manualAssessmentAdapter.preparePaper({ eventId: "M", mode: "exam", seed: "S", scope: { kind: "participant", participantKey: "S" }, configuration: withoutKeys.value });
  assert.equal(paper.ok, true);
  if (!paper.ok) return;
  const response = manualAssessmentAdapter.validateResponse({ mode: "exam", paper: paper.value, input: { choice: "a", blank: { one: "typed" }, attachment: { name: "answer.pdf" } } });
  assert.equal(response.ok, false);

  const unsafeImage = manualAssessmentAdapter.validateAuthoring({
    mode: "exam",
    input: { questions: [{ key: "x", type: "short_answer", promptMarkdown: "Prompt", image: { dataUrl: "data:image/svg+xml,<svg onload=alert(1)>", alt: "x" } }] },
  });
  assert.equal(unsafeImage.ok, false);
});

test("manual adapter keeps the formal integrity workspace and rejects classroom scope", async () => {
  const workspace = manualAssessmentAdapter.getStudentWorkspaceCapabilities("exam");
  assert.equal(workspace.proctoringEnabled, true);
  assert.equal(workspace.requiresFullscreen, true);
  assert.equal(workspace.responseKind, "manual_question_map");
  assert.equal(workspace.automaticGrading, false);
  assert.throws(() => manualAssessmentAdapter.getStudentWorkspaceCapabilities("assignment"), /UNSUPPORTED/);
});
