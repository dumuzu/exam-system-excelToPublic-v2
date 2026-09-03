import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { composeExamPlan } from "../src/core/exam-composer.ts";
import { InMemoryExamHistoryRepository } from "../src/server/exam-history-repository.ts";
import { InMemoryStudentExamRepository } from "../src/server/student-exam-repository.ts";
import {
  buildPublishAssessmentBody,
  createAuthoringDraft,
} from "../src/client/features/exam-authoring/model/authoringDraft.ts";

test("authoring defaults formal exams to 90 minutes and keeps assignments untimed", () => {
  const initialExcelDraft = createAuthoringDraft("excel_formula");
  assert.equal(initialExcelDraft.kind, "excel");
  if (initialExcelDraft.kind !== "excel") throw new Error("Expected an Excel authoring draft.");
  const excelDraft = { ...initialExcelDraft, name: "Duration test", selectedFunctions: ["SUM"] };
  const manualDraft = createAuthoringDraft("manual_questions");

  assert.equal(excelDraft.durationMinutes, 90);
  assert.equal(manualDraft.durationMinutes, 90);
  assert.equal(buildPublishAssessmentBody(excelDraft, "student_number,name\nS001,Student").durationMinutes, 90);
  assert.equal(buildPublishAssessmentBody({ ...excelDraft, mode: "assignment" }, "student_number,name\nS001,Student").durationMinutes, null);
});

test("saved configurations and published exams retain a teacher-selected duration", async () => {
  const history = new InMemoryExamHistoryRepository();
  const saved = await history.save({
    name: "Short exam",
    mode: "exam",
    durationMinutes: 45,
    assignmentOptions: {},
    selectedFunctions: ["SUM"],
    plan: composeExamPlan({ selectedFunctions: ["SUM"] }).plan,
    createdBy: "teacher",
  });
  assert.equal(saved.durationMinutes, 45);

  const repository = new InMemoryStudentExamRepository();
  const published = await repository.publishExam({
    title: "Short exam",
    mode: "exam",
    durationMinutes: 45,
    selectedFunctions: ["SUM"],
    plan: composeExamPlan({ selectedFunctions: ["SUM"] }).plan,
    roster: [{ studentNumber: "S001", name: "Student" }],
    createdByLogin: "teacher",
  });
  assert.equal(published.durationMinutes, 45);
  assert.equal((await repository.listExamEvents())[0]?.durationMinutes, 45);
  await repository.prepareNextBatch({ examCode: published.code, batchSize: 1 });
  await repository.verifyIdentity({ examCode: published.code, studentNumber: "S001" });
  await repository.admitStudent({ examCode: published.code, studentNumber: "S001" });
  const startedAt = new Date("2026-09-03T00:00:00.000Z");
  const attempt = await repository.startAttempt({
    examCode: published.code,
    studentNumber: "S001",
    sessionTokenHash: "duration-session",
    browserPreflight: { fullscreen: true },
    now: startedAt,
  });
  assert.equal(attempt.deadlineAt, "2026-09-03T00:45:00.000Z");
});

test("teacher UI exposes a bounded duration field and aligns event columns by meaning", async () => {
  const [workspace, table, styles] = await Promise.all([
    readFile(new URL("../src/client/features/exam-authoring/components/AuthoringWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exams/components/ExamEventTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/shared/styles/examList.css", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /id="durationMinutes"/);
  assert.match(workspace, /min=\{1\}/);
  assert.match(workspace, /max=\{240\}/);
  assert.match(table, /examMetricCell/);
  assert.match(table, /examActionCell/);
  assert.match(styles, /\.examMetricCell/);
  assert.match(styles, /\.examActionCell/);
});

test("migration 030 preserves existing formal durations and keeps assignments untimed", async () => {
  const sql = await readFile(new URL("../db/migrations/030_exam_configuration_duration.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN duration_minutes SMALLINT/i);
  assert.match(sql, /configuration_mode = 'exam' AND duration_minutes BETWEEN 1 AND 240/i);
  assert.match(sql, /configuration_mode = 'assignment' AND duration_minutes IS NULL/i);
  assert.match(sql, /VALUES \(30, '030_exam_configuration_duration\.sql'/i);
});
