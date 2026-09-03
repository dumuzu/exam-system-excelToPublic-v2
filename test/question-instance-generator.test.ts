import assert from "node:assert/strict";
import test from "node:test";

import { generateSumStarterQuestion } from "../src/core/question-instance-generator.ts";

test("SUM starter question is stable for the same student and exam", () => {
  const first: any = generateSumStarterQuestion({ examCode: "SUM-2026", studentNumber: "20260001" });
  const resumed: any = generateSumStarterQuestion({ examCode: "SUM-2026", studentNumber: "20260001" });
  assert.deepEqual(resumed, first);
  assert.equal(first.studentPayload.table.rows.reduce((sum: any, row: any) => sum + row.Sales, 0), first.answerKey.expectedValue);
});

test("SUM starter question changes its table data or column order for another student", () => {
  const first: any = generateSumStarterQuestion({ examCode: "SUM-2026", studentNumber: "20260001" });
  const second: any = generateSumStarterQuestion({ examCode: "SUM-2026", studentNumber: "20260002" });
  assert.notDeepEqual(second.studentPayload.table, first.studentPayload.table);
  assert.match(first.answerKey.allowedFormula, /^=SUM\([A-C]2:[A-C]6\)$/);
  assert.match(second.answerKey.allowedFormula, /^=SUM\([A-C]2:[A-C]6\)$/);
  assert.equal("expectedValue" in first.studentPayload, false);
});
