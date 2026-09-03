import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl: any = new URL("../public/exam/index.html", import.meta.url);
const scriptUrl: any = new URL("../public/exam/exam.js", import.meta.url);
const behaviorGuardUrl: any = new URL("../public/exam/exam-behavior-guard.js", import.meta.url);
const submissionRequestUrl: any = new URL("../public/exam/submission-request.js", import.meta.url);
const cssUrl: any = new URL("../public/exam/exam.css", import.meta.url);

test("violation overlay identifies leaving the exam window as cheating and enforces a five-second return delay", async () => {
  const [html, script] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(scriptUrl, "utf8")]);
  assert.match(html, /id="violation-occurred-at"/);
  assert.match(html, /id="violation-countdown"/);
  assert.match(html, /3回/);
  assert.match(html, /Leaving this exam window is cheating/);
  assert.match(script, /VIOLATION_ACKNOWLEDGEMENT_SECONDS\s*=\s*5/);
  assert.match(script, /WAIT \$\{secondsRemaining\} SECONDS, THEN CLICK/);
});

test("active answer sheets suppress trackpad navigation and debounce transient focus loss", async () => {
  const [script, behaviorGuard, css] = await Promise.all([
    readFile(scriptUrl, "utf8"),
    readFile(behaviorGuardUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(script, /createAssessmentNavigationGuard/);
  assert.match(script, /createTransientFocusGuard/);
  assert.doesNotMatch(script, /addEventListener\("resize"[^)]*reportViolation/);
  assert.match(behaviorGuard, /TRANSIENT_FOCUS_LOSS_MS\s*=\s*1_200/);
  assert.match(behaviorGuard, /event\.ctrlKey/);
  assert.match(css, /html, body \{ overscroll-behavior-x: none/);
  assert.match(css, /\.sheetWrap \{[^}]*overscroll-behavior-x: contain/s);
});

test("formula workspace provides accessible completion help without the redundant instruction strip", async () => {
  const [html, script] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(scriptUrl, "utf8")]);
  assert.match(html, /id="formulaSuggestions"[^>]+role="listbox"/);
  assert.match(html, /id="formulaFunctionHelp"[^>]+aria-live="polite"/);
  assert.match(html, /aria-autocomplete="list"/);
  assert.doesNotMatch(html, /class="formula-entry-label"/);
  assert.match(script, /getFunctionCompletions/);
  assert.match(script, /applyFunctionCompletion/);
});

test("student questions render Japanese and English prompts together", async () => {
  const [html, script] = await Promise.all([readFile(htmlUrl, "utf8"), readFile(scriptUrl, "utf8")]);
  assert.match(html, /id="questionPromptEn"/);
  assert.match(script, /question\.promptEn/);
});

test("formal submission is guarded against startup and dialog click-through", async () => {
  const [html, script, submissionRequest] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(scriptUrl, "utf8"),
    readFile(submissionRequestUrl, "utf8"),
  ]);
  assert.match(script, /MANUAL_SUBMISSION_GUARD_MILLISECONDS\s*=\s*5_000/);
  assert.match(script, /SUBMISSION_DIALOG_CONFIRMATION_MILLISECONDS\s*=\s*1_200/);
  assert.match(script, /\/api\/student\/submission-confirmation/);
  assert.match(script, /submissionConfirmationToken/);
  assert.match(script, /manualSubmissionUnlockedAt/);
  assert.match(script, /submitDialogReadyAt/);
  assert.match(script, /function closeOpenExamDialogs\(\)/);
  assert.match(script, /closeOpenExamDialogs\(\);\s*document\.querySelector\("#questionCard"\)\.inert = false/);
  assert.match(script, /submitDeadlineWithRetry/);
  assert.match(script, /deadlineSubmissionActive/);
  assert.match(script, /#fullscreen-button"\)\.addEventListener\("click", async \(event\)/);
  assert.match(html, /id="finalSubmitDialog"/);
  assert.match(html, /id="final-submit-confirm"/);
  assert.match(submissionRequest, /SUBMISSION_CONFIRMATION_REQUIRED/);
});

test("classroom assignment has a dedicated no-timer, no-proctoring flow with visible results and a second submission", async () => {
  const [html, script, submissionRequest, css] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(scriptUrl, "utf8"),
    readFile(submissionRequestUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(html, /id="assignmentIntroCard" hidden/);
  assert.match(html, /終了すると入力内容は保存されません/);
  assert.match(html, /最大2回/);
  assert.match(html, /id="assignmentResult" hidden/);
  assert.match(html, /id="assignment-retry"/);
  assert.match(html, /id="submitError"[^>]+role="alert"/);
  assert.match(script, /function isAssignmentMode\(\)/);
  assert.match(script, /studentState\.practiceAnswers/);
  assert.match(script, /submitWithRetry\(\{ request, answers: answerValues\(\), csrfToken:/);
  assert.match(submissionRequest, /NOT SUBMITTED — CHECK THE CONNECTION AND RETRY/);
  assert.match(submissionRequest, /EVENT CLOSED OR REMOVED/);
  assert.match(script, /studentState\.monitoring = studentState\.experience\.proctoringEnabled/);
  assert.match(css, /body\[data-mode="assignment"\][^{]*\.examCountdown/s);
  assert.match(css, /body\[data-mode="assignment"\][^{]*\.examRules/s);
});
