import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("teacher assignment UI presents 5, 10 and 15 exercises per selected function and no choice controls", async () => {
  const [editor, draftModel] = await Promise.all([
    readFile(new URL("../src/client/features/exam-authoring/components/ExcelAuthoringEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-authoring/model/authoringDraft.ts", import.meta.url), "utf8"),
  ]);
  assert.match(draftModel, /formulaQuestionCountMode:\s*"per_function"/);
  assert.match(editor, /questionsPerFunctionOptions/);
  assert.match(editor, /:\s*\[5, 10, 15\]/);
  assert.match(editor, /name="questionsPerFunction"/);
  assert.doesNotMatch(editor, /choice-count-control|choiceCount/);
});

test("teacher composition UI accepts and previews only identity columns from CSV and Excel rosters", async () => {
  const [field, workspace, styles, copy] = await Promise.all([
    readFile(new URL("../src/client/features/exam-authoring/components/RosterImportField.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-authoring/components/AuthoringWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-authoring/examAuthoring.css", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-authoring/copy.ts", import.meta.url), "utf8"),
  ]);

  assert.match(field, /accept="\.csv,\.xls,\.xlsx/);
  assert.match(field, /\bmultiple\b/);
  assert.match(field, /result\.previewRows\.slice/);
  assert.match(field, /role="columnheader"/);
  assert.match(field, /t\.rosterStudentNumber/);
  assert.match(field, /t\.rosterName/);
  assert.match(field, /className="rosterPreviewRow"/);
  assert.match(workspace, /importRosterFiles\(files, maximumStudents\)/);
  assert.match(workspace, /setRoster\(await/);
  assert.match(styles, /\.rosterImportResult/);
  assert.match(styles, /\.rosterPreview/);
  assert.match(styles, /\.rosterPreviewHeader/);
  assert.match(styles, /\.rosterPreviewRow/);
  assert.match(field, /Array\.from\(event\.currentTarget\.files \?\? \[\]\)/);
  assert.match(copy, /请上传出席文件，会自动读取学号和姓名/);
});

test("teacher composition UI exposes global function selection and exam difficulty controls", async () => {
  const [editor, draftModel, copy] = await Promise.all([
    readFile(new URL("../src/client/features/exam-authoring/components/ExcelAuthoringEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-authoring/model/authoringDraft.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-authoring/copy.ts", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /const allSelected = functions\.length > 0/);
  assert.match(editor, /onSelectFunctions\(allSelected \? \[\] : functions\.map/);
  assert.match(editor, /\["easy", "normal", "hard", "hell"\]/);
  assert.match(draftModel, /difficulty:\s*"normal"/);
  assert.match(copy, /difficultyLabels/);
  assert.match(copy, /selectAll/);
  assert.match(copy, /clearAll/);
});

test("teacher results separate highest-score summaries from warning and forced-submission logs", async () => {
  const [table, audit, api, route] = await Promise.all([
    readFile(new URL("../src/client/features/results/components/ResultTable.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/results/components/AuditLog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/results/api/resultApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/results/routes/results.lazy.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(table, /highestScore/);
  assert.match(table, /policySuspensionCount/);
  assert.match(table, /forcedSubmissionCount/);
  assert.match(audit, /policySuspensions/);
  assert.match(audit, /forcedSubmissionEvents/);
  assert.match(api, /warnings\.csv/);
  assert.match(route, /warningCsvUrl/);
  assert.match(route, /resultCsvUrl/);
  assert.doesNotMatch(`${table}\n${route}`, /choiceCorrect|formulaCorrect|accuracy-bars/);
});

test("room management resumes suspended attempts and performs collection before final shutdown", async () => {
  const [route, actionDialog, roomApi, termination] = await Promise.all([
    readFile(new URL("../src/client/features/exam-room/routes/examRoom.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/components/RoomActionDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/api/examRoomApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/shared/api/examTermination.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /useAuthorizeRoomResumeMutation/);
  assert.match(route, /DestructiveConfirmDialog/);
  assert.match(actionDialog, /target\?\.student\.status === "policy_suspended"/);
  assert.match(roomApi, /executeExamTermination/);
  assert.match(termination, /termination-collection/);
  assert.match(termination, /collectUntil/);
  assert.match(termination, /while \(!response\.exam\.completed\)/);
  assert.match(termination, /pendingSubmissionCount/);
  assert.match(termination, /\/terminate/);
});

test("room management presents durable collection failures and a per-attempt retry action", async () => {
  const [panel, dialog, api, copy] = await Promise.all([
    readFile(new URL("../src/client/features/exam-room/components/TerminationFailuresPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/components/RoomFailureRetryDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/api/examRoomApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/copy.ts", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /className="terminationFailurePanel"/);
  assert.match(panel, /className="terminationFailureList"/);
  assert.match(dialog, /retryFailureTitle/);
  assert.match(api, /termination-failures`/);
  assert.match(api, /termination-failures\/\$\{encodeURIComponent\(attemptId\)\}\/retry/);
  assert.match(api, /retryRoomTerminationFailure/);
  assert.match(copy, /答案収集の失敗|收卷失败记录/);
});

test("classroom room management uses assignment-specific progress and adaptive polling", async () => {
  const [route, queries, roomView, styles] = await Promise.all([
    readFile(new URL("../src/client/features/exam-room/routes/examRoom.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/api/examRoomQueries.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/model/roomView.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exam-room/styles/examRoom.css", import.meta.url), "utf8"),
  ]);

  assert.match(roomView, /ASSIGNMENT_ROOM_REFRESH_INTERVAL_MS\s*=\s*12_000/);
  assert.match(queries, /refetchIntervalInBackground:\s*false/);
  assert.match(roomView, /assignment_submitted_once/);
  assert.match(roomView, /assignment_completed_twice/);
  assert.match(route, /room\?\.mode === "assignment"/);
  assert.match(styles, /\.examRoomFlow/);
  assert.match(styles, /assignment_completed_twice/);
});

test("role-aware dashboard hides composition and results cards without permission", async () => {
  const source: any = await readFile(new URL("../src/client/features/dashboard/components/OperationsTable.tsx", import.meta.url), "utf8");
  assert.match(source, /permission:\s*"compose_exam"/);
  assert.match(source, /permission:\s*"view_results"/);
  assert.match(source, /operations\.filter\(\(operation\) => subject\.permissions\.includes\(operation\.permission\)\)/);
});

test("exam management explains assignment shutdown and blocks unsafe deletion", async () => {
  const [route, api, httpClient] = await Promise.all([
    readFile(new URL("../src/client/features/exams/routes/exams.lazy.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/client/features/exams/api/examApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/client/shared/api/httpClient.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /assignmentTerminateDescription/);
  assert.match(route, /EXAM_HAS_IN_PROGRESS_ATTEMPTS/);
  assert.match(route, /deleteBlocked/);
  assert.match(route, /EXAM_MUST_BE_TERMINATED/);
  assert.match(route, /DestructiveConfirmDialog/);
  assert.match(api, /confirmationCode:\s*exam\.code/);
  assert.match(httpClient, /this\.code = code/);
});
