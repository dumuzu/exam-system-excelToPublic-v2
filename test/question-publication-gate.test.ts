import assert from "node:assert/strict";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { FUNCTION_CATALOG } from "../src/core/function-catalog.ts";
import { auditExamPublication } from "../src/core/question-publication-gate.ts";

test("publication gate replays every executable blueprint variant before approving an exam", () => {
  const composition: any = composeExamPlan({
    mode: "exam",
    difficulty: "hell",
    selectedFunctions: FUNCTION_CATALOG.map((item) => item.name),
  });

  const audit: any = auditExamPublication({ plan: composition.plan, warnings: composition.warnings });

  assert.equal(audit.ok, true);
  assert.equal(audit.status, "approved");
  assert.equal(audit.summary.formulaQuestionCount, 50);
  assert.equal(audit.summary.choiceQuestionCount, 0);
  assert.equal(audit.summary.samplePaperCount, 2);
  assert.ok(audit.summary.replayedVariantCount >= 50);
  assert.ok(audit.blueprints.length >= 30);
  assert.equal(audit.blueprints.every((item: any) => item.reviewStatus === "approved" && /^[a-f0-9]{64}$/.test(item.contentHash)), true);
});

test("publication gate blocks a tampered formal plan instead of creating an unsafe event", () => {
  const plan: any = structuredClone(composeExamPlan({ selectedFunctions: ["SUM", "ROUND"] }).plan);
  plan.questionCounts.formula = 49;

  const audit: any = auditExamPublication({ plan });

  assert.equal(audit.ok, false);
  assert.equal(audit.status, "blocked");
  assert.equal(audit.errors.some((error: any) => error.code === "FORMAL_EXAM_STRUCTURE_INVALID"), true);
});

test("publication gate approves a structurally valid bilingual easy exam", () => {
  const composition: any = composeExamPlan({
    mode: "exam",
    difficulty: "easy",
    selectedFunctions: FUNCTION_CATALOG.map((item) => item.name),
  });
  const audit: any = auditExamPublication({ plan: composition.plan });

  assert.equal(audit.ok, true);
  assert.equal(audit.summary.choiceQuestionCount, 10);
  assert.equal(audit.summary.formulaQuestionCount, 30);
});
