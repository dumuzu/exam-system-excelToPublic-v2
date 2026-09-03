import assert from "node:assert/strict";
import test from "node:test";

import { excelAssessmentAdapter } from "../src/assessment-types/excel/index.ts";
import { createAssessmentKernel } from "../src/core/assessment-kernel.ts";
import { browserThreeStrikeIntegrityPolicy, normalizeBrowserIntegritySignal } from "../src/core/integrity-policy.ts";
import { textAssessmentAdapter } from "../test-support/text-assessment-adapter.ts";

test("one assessment kernel supports Excel and non-Excel student responses", async () => {
  const kernel = createAssessmentKernel([excelAssessmentAdapter, textAssessmentAdapter]);
  assert.deepEqual(kernel.descriptors().map((descriptor) => descriptor.key).sort(), ["excel_formula", "short_text"]);

  const written = await kernel.prepare({
    assessmentTypeKey: "short_text",
    eventId: "event-written-1",
    mode: "exam",
    seed: "student-1",
    scope: { kind: "participant", participantKey: "student-1" },
    authoring: { prompt: "Explain the result", expected: "Because the values differ." },
  });
  assert.equal(written.ok, true);
  assert.deepEqual(written.value.studentView, { id: "event-written-1-question", prompt: "Explain the result" });
  assert.deepEqual(await written.value.evaluate("Because the values differ."), {
    ok: true,
    value: {
      response: "Because the values differ.",
      grade: { awardedScore: 1, maximumScore: 1 },
    },
  });

  const excel = await kernel.prepare({
    assessmentTypeKey: "excel_formula",
    eventId: "event-excel-1",
    mode: "assignment",
    seed: "shared",
    scope: { kind: "shared" },
    authoring: { mode: "assignment", assignmentOptions: { questionsPerFunction: 5 }, selectedFunctions: ["SUM"] },
  });
  assert.equal(excel.ok, true);
  assert.equal(excel.value.workspace.responseKind, "excel_formula_map");
});

test("an integrity policy advances independently of assessment response types", () => {
  const normalized = normalizeBrowserIntegritySignal({ eventType: "page_hidden", observedAt: "2026-08-26T00:00:00.000Z" });
  assert.equal(normalized.ok, true);
  const signal = normalized.value;
  const first = browserThreeStrikeIntegrityPolicy.evaluate({ mode: "exam", state: { violationCount: 0, suspended: false }, signal });
  const second = browserThreeStrikeIntegrityPolicy.evaluate({ mode: "exam", state: first.state, signal });
  const third = browserThreeStrikeIntegrityPolicy.evaluate({ mode: "exam", state: second.state, signal });

  assert.deepEqual(first, {
    state: { violationCount: 1, suspended: false },
    actions: ["record", "warn"],
    auditEvent: {
      policyId: "browser_three_strike",
      policyVersion: 1,
      signalKind: "focus_lost",
      sourceEventType: "page_hidden",
      observedAt: "2026-08-26T00:00:00.000Z",
      violationOrdinal: 1,
      decision: "warned",
      details: {},
    },
  });
  assert.deepEqual(third.state, { violationCount: 3, suspended: true });
  assert.deepEqual(third.actions, ["record", "suspend"]);
  assert.equal(third.auditEvent?.decision, "suspended");
});
