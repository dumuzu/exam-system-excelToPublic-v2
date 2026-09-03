import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("teacher authoring workspace exposes an unlimited plus-menu with all four question types", async () => {
  const [editor, draftModel, workspace] = await Promise.all([
    source("../src/client/features/exam-authoring/components/ManualAuthoringEditor.tsx"),
    source("../src/client/features/exam-authoring/model/authoringDraft.ts"),
    source("../src/client/features/exam-authoring/components/AuthoringWorkspace.tsx"),
  ]);
  assert.match(editor, /<details className="manualAddMenu">/);
  assert.match(editor, /const types = \["single_choice", "multiple_choice", "fill_blank", "short_answer"\]/);
  assert.match(editor, /selectionStart/);
  assert.match(editor, /acceptedAnswers/);
  assert.match(editor, /image\/png/);
  assert.match(editor, /1_500_000/);
  assert.match(draftModel, /assessmentTypeKey === "manual_questions"/);
  assert.match(workspace, /ManualAuthoringEditor/);
});

test("student workspace supports structured responses and safe Markdown without attachment controls", async () => {
  const [html, examSource, markdownSource, serverSource] = await Promise.all([
    source("../public/exam/index.html"),
    source("../src/client/exam/exam.ts"),
    source("../src/client/shared/safe-markdown.ts"),
    source("../src/server/server.ts"),
  ]);
  assert.match(html, /id="manualChoiceResponse"/);
  assert.match(html, /id="manualFillResponse"/);
  assert.match(html, /id="manual-short-answer"[^>]+maxlength="20000"/);
  assert.doesNotMatch(html, /manual-short[^\n]+type="file"/);
  assert.match(examSource, /body: JSON\.stringify\(\{ questionKey: question\.key, \.\.\.\(manual \? \{ answer \}/);
  assert.match(examSource, /renderSafeMarkdown/);
  assert.doesNotMatch(markdownSource, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(markdownSource, /noopener noreferrer nofollow/);
  assert.doesNotMatch(serverSource, /"admin\/manual-authoring\.js"/);
  assert.match(serverSource, /"shared\/safe-markdown\.js"/);
});

test("results workspace provides answer-reference comparison and teacher score adjustment", async () => {
  const [reviewDialog, resultApi, resultRoute] = await Promise.all([
    source("../src/client/features/results/components/ResultReviewDialog.tsx"),
    source("../src/client/features/results/api/resultApi.ts"),
    source("../src/client/features/results/routes/results.lazy.tsx"),
  ]);
  assert.match(reviewDialog, /studentAnswer/);
  assert.match(reviewDialog, /referenceAnswer/);
  assert.match(reviewDialog, /SafeMarkdown/);
  assert.match(resultRoute, /adjust_grades/);
  assert.match(resultApi, /\/api\/admin\/grade-results\//);
});
