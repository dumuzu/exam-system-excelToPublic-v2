import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAssessmentKernel } from "../src/core/assessment-kernel.ts";
import { textAssessmentAdapter } from "../test-support/text-assessment-adapter.ts";

test("the reusable kernel and non-Excel adapter do not import Excel implementation modules", async () => {
  const sources: any = await Promise.all([
    readFile(new URL("../src/core/assessment-kernel.ts", import.meta.url), "utf8"),
    readFile(new URL("../test-support/text-assessment-adapter.ts", import.meta.url), "utf8"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /assessment-types[/\\]excel|exam-composer|formula-grader|paper-question-factory/);
  }
});

test("a non-Excel adapter runs authoring, preparation, validation, and grading through the reusable kernel", async () => {
  const kernel: any = createAssessmentKernel([textAssessmentAdapter]);
  const prepared: any = await kernel.prepare({
    assessmentTypeKey: "short_text",
    eventId: "HISTORY-1",
    mode: "exam",
    seed: "student-7",
    scope: { kind: "participant", participantKey: "student-7" },
    authoring: { prompt: "Capital of Japan?", expected: "Tokyo" },
  });

  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.value.studentView, { id: "HISTORY-1-question", prompt: "Capital of Japan?" });
  assert.equal(prepared.value.workspace.responseKind, "short_text");
  assert.equal(prepared.value.workspace.requiresFullscreen, true);
  assert.equal("expected" in prepared.value.studentView, false);

  const evaluation: any = await prepared.value.evaluate("  TOKYO  ");
  assert.deepEqual(evaluation, {
    ok: true,
    value: {
      response: "TOKYO",
      grade: { awardedScore: 1, maximumScore: 1 },
    },
  });
});

test("the kernel rejects unknown assessment types, unsupported modes, and invalid responses by default", async () => {
  const examOnlyAdapter: any = {
    ...textAssessmentAdapter,
    descriptor: { ...textAssessmentAdapter.descriptor, key: "exam_only_text", supportedModes: ["exam"] },
  };
  const kernel: any = createAssessmentKernel([textAssessmentAdapter, examOnlyAdapter]);
  const unknown: any = await kernel.prepare({
    assessmentTypeKey: "missing",
    eventId: "EVENT",
    mode: "exam",
    seed: "seed",
    scope: { kind: "shared" },
    authoring: {},
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors[0].code, "UNKNOWN_ASSESSMENT_TYPE");

  const unsupportedMode: any = await kernel.prepare({
    assessmentTypeKey: "exam_only_text",
    eventId: "EVENT",
    mode: "assignment",
    seed: "seed",
    scope: { kind: "shared" },
    authoring: { prompt: "One word", expected: "yes" },
  });
  assert.equal(unsupportedMode.ok, false);
  assert.equal(unsupportedMode.errors[0].code, "UNSUPPORTED_ASSESSMENT_MODE");

  const prepared: any = await kernel.prepare({
    assessmentTypeKey: "short_text",
    eventId: "EVENT",
    mode: "assignment",
    seed: "seed",
    scope: { kind: "shared" },
    authoring: { prompt: "One word", expected: "yes" },
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.workspace.requiresFullscreen, false);
  assert.equal(prepared.value.workspace.sharedPaper, true);
  const invalidResponse: any = await prepared.value.evaluate({ answer: "yes" });
  assert.equal(invalidResponse.ok, false);
  assert.equal(invalidResponse.errors[0].code, "INVALID_TEXT_RESPONSE");
});
