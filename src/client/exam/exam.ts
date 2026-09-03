import { renderJapaneseWithReadings } from "./japanese-readings.js";
import { detectSupportedBrowser } from "./browser-compatibility.js";
import { renderSafeMarkdown } from "../shared/safe-markdown.js";
import { getFullscreenElement, isFullscreenAvailable, observeFullscreenChanges, requestFullscreen } from "./fullscreen-compatibility.js";
import {
  createAssessmentNavigationGuard,
  createBrowserIntegritySignal,
  createFullscreenRecoveryGuard,
  createTransientFocusGuard,
  getFullscreenRecoveryGraceMs,
} from "./exam-behavior-guard.js";
import {
  createFormalSubmissionPayload,
  describeSubmissionFailure,
  submitDeadlineWithRetry,
  submitWithRetry,
} from "./submission-request.js";
import {
  STUDENT_ENTRY_CONTROLLER_READY_EVENT,
  STUDENT_ENTRY_SHOW_EVENT,
  STUDENT_ENTRY_VERIFIED_EVENT,
} from "./student-entry-bridge.js";

type FormulaAssistantModule = typeof import("./formula-assistant.js");
type StudentDisplayLocale = "legacy_bilingual" | "ja" | "zh" | "en";

const document: any = globalThis.document;
const window: any = globalThis.window;
const location: any = globalThis.location;
const navigator: any = globalThis.navigator;
const VIOLATION_ACKNOWLEDGEMENT_SECONDS: any = 5;
const MANUAL_SUBMISSION_GUARD_MILLISECONDS: any = 5_000;
const SUBMISSION_DIALOG_CONFIRMATION_MILLISECONDS: any = 1_200;
const FINAL_SUBMISSION_CONFIRMATION_MILLISECONDS: any = 1_500;
const ADMISSION_POLL_BASE_MILLISECONDS: any = 5_000;
const ADMISSION_POLL_JITTER_MILLISECONDS: any = 2_000;
const ADMISSION_POLL_MAX_MILLISECONDS: any = 15_000;
let formulaAssistantModule: FormulaAssistantModule | null = null;
let formulaAssistantPromise: Promise<FormulaAssistantModule> | null = null;
let selectionPaintFrame: number | null = null;
let questionIndexFrame: number | null = null;
let formulaAssistantFrame: number | null = null;
let markdownPreviewFrame: number | null = null;
let pendingMarkdownPreview = "";
let formulaAssistantRevision = 0;

function scheduleFrame(callback: () => void): number {
  return typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 16);
}

function loadFormulaAssistant(): Promise<FormulaAssistantModule> {
  formulaAssistantPromise ??= import("./formula-assistant.js").then((module) => {
    formulaAssistantModule = module;
    return module;
  });
  return formulaAssistantPromise;
}

function createElement(tagName: any, className: any, text: any) {
  const element: any = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function displayName(value: any) { const name: any = String(value ?? ""); return name.includes("?") && /\p{L}/u.test(name.replaceAll("?", "")) ? name.replaceAll(/\?+/g, " ").replaceAll(/\s+/g, " ").trim() : name; }

async function request(path: any, options = {}) {
  const response: any = await fetch(path, { credentials: "same-origin", ...options });
  const contentType: any = response.headers.get("content-type") ?? "";
  const body: any = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error: any = new Error(body?.error ?? "通信に失敗しました。");
    error.status = response.status;
    error.code = body?.code ?? null;
    throw error;
  }
  return body;
}

function storageAvailable() {
  try {
    const key: any = "excel-web-exam-preflight";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function isSecureEnvironment() {
  return window.isSecureContext || ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function updateFullscreenState() {
  document.querySelector("#fullscreen-state").textContent = getFullscreenElement(document)
    ? "全画面モード：ON"
    : "全画面モード：OFF";
}

function browserPreflight() {
  const browser: any = detectSupportedBrowser(navigator.userAgent);
  return {
    secureContext: isSecureEnvironment(),
    fullscreen: Boolean(getFullscreenElement(document)),
    localStorage: storageAvailable(),
    visibility: typeof document.visibilityState === "string",
    network: typeof window.fetch === "function",
    browserFamily: browser.family,
    browserVersion: browser.version,
    browserSupported: browser.supported,
  };
}

function runPreflight() {
  const browser: any = detectSupportedBrowser(navigator.userAgent);
  const checks: any = [
    [`対応ブラウザ（Chrome / Edge 109+、Firefox 115+、macOS Safari 16.4+）: ${browser.family} ${browser.version ?? "?"}`, browser.supported],
    ["安全な接続（HTTPS / localhost）", isSecureEnvironment()],
    ["全画面 API", isFullscreenAvailable(document, document.documentElement)],
    ["ローカル保存", storageAvailable()],
    ["ページ表示の監視", typeof document.visibilityState === "string"],
    ["ネットワーク通信", typeof window.fetch === "function"],
  ];
  const list: any = document.querySelector("#preflight-list");
  const items = checks.map(([label, passed]: any) => {
    const item: any = document.createElement("li");
    item.append(createElement("span", "", label), createElement("strong", passed ? "pass" : "check", passed ? "OK" : "確認"));
    return item;
  });
  list.replaceChildren(...items);
  updateFullscreenState();
  document.querySelector("#fullscreen-button").disabled = !browser.supported
    || !isFullscreenAvailable(document, document.documentElement);
}

const studentState: any = { csrfToken: null, attempt: null, pendingIdentity: null, verifiedExam: null, experience: null, practiceAnswers: {}, currentIndex: 0, histories: new Map(), suppressHistory: false, saveTimer: null, savePromise: null, countdownTimer: null, admissionTimer: null, admissionFailures: 0, heartbeatTimer: null, heartbeatFailures: 0, violationTimer: null, fullscreenRecoveryTimer: null, fullscreenRecoveryAttemptId: null, violationActive: false, policySuspended: false, terminationCollecting: false, monitoring: false, selecting: false, selectionStart: null, selectionEnd: null, lastViolationAt: 0, formulaCompletion: null, formulaSuggestionIndex: 0, manualSubmissionUnlockedAt: 0, submitUnlockTimer: null, submitDialogReadyAt: 0, submitConfirmTimer: null, submissionConfirmationToken: null, finalSubmitDialogReadyAt: 0, finalSubmitConfirmTimer: null, deadlineSubmissionActive: false, deadlineRecoveryTimer: null, deadlineRecoveryDelay: 4_000, deadlineFinalSyncRequested: false };
const questionCard: any = document.querySelector("#questionCard");
const syncExamViewport = () => document.body.classList.toggle("examInProgress", !questionCard.hidden);
// 旧版 Firefox 也能稳定切换考试专用视口，不依赖 CSS :has()。
new MutationObserver(syncExamViewport).observe(questionCard, { attributes: true, attributeFilter: ["hidden"] });
syncExamViewport();
const terminalEntryStatuses: any = new Set(["submitted", "auto_submitted", "teacher_submitted", "policy_submitted", "review_required"]);
const startableEntryStatuses: any = new Set(["admitted", "resume_available"]);
const navigationGuard: any = createAssessmentNavigationGuard({
  documentRef: document,
  windowRef: window,
  shouldProtect: () => Boolean(
    studentState.attempt
    && !studentState.attempt.submission
    && !document.querySelector("#questionCard").hidden
  ),
  onNavigationBlocked: () => {
    document.querySelector("#submission-status").textContent = "戻る操作を無効にしました。答案はこのページに保持されています。 / Back navigation was blocked. Your answer sheet remains on this page.";
  },
});
const focusGuard: any = createTransientFocusGuard({
  documentRef: document,
  windowRef: window,
  shouldMonitor: () => studentState.monitoring && Boolean(getFullscreenElement(document)),
  onConfirmedLoss: (signal) => reportViolation(signal),
});
const fullscreenRecoveryGuard: any = createFullscreenRecoveryGuard({
  shouldMonitor: () => studentState.monitoring
    && studentState.experience?.requiresFullscreen
    && !studentState.violationActive
    && !studentState.policySuspended,
  hasFullscreen: () => Boolean(getFullscreenElement(document)),
  onRecoveryStarted: (deadlineAt, graceMs, interruptionCount) => {
    focusGuard.cancelPendingLoss();
    showFullscreenRecovery(deadlineAt, graceMs, interruptionCount);
  },
  onRecovered: () => dismissFullscreenRecovery(),
  onConfirmedExit: (signal, graceMs) => confirmFullscreenExit(signal, graceMs),
});

function isAssignmentMode() { return studentState.experience?.mode === "assignment"; }
function isStudentDisplayLocale(value: unknown): value is StudentDisplayLocale {
  return value === "legacy_bilingual" || value === "ja" || value === "zh" || value === "en";
}
function resultStudentDisplayLocale(result: unknown): StudentDisplayLocale | null {
  if (!result || typeof result !== "object" || !("exam" in result)) return null;
  const exam = (result as { exam?: unknown }).exam;
  if (!exam || typeof exam !== "object" || !("studentLocale" in exam)) return null;
  const locale = (exam as { studentLocale?: unknown }).studentLocale;
  return isStudentDisplayLocale(locale) ? locale : null;
}
function studentDisplayLocale(): StudentDisplayLocale {
  const locale: unknown = studentState.verifiedExam?.exam?.studentLocale;
  return isStudentDisplayLocale(locale) ? locale : "legacy_bilingual";
}
function applyStudentDisplayLocale(result: unknown) {
  const currentLocale: unknown = studentState.verifiedExam?.exam?.studentLocale;
  const datasetLocale: unknown = document.documentElement.dataset.studentLocale;
  const locale = resultStudentDisplayLocale(result)
    ?? (isStudentDisplayLocale(currentLocale) ? currentLocale : null)
    ?? (isStudentDisplayLocale(datasetLocale) ? datasetLocale : "legacy_bilingual");
  document.documentElement.dataset.studentLocale = locale;
  document.documentElement.lang = locale === "zh" ? "zh-CN" : locale === "en" ? "en" : "ja";
}
function applyStudentExperience(result: any) {
  applyStudentDisplayLocale(result);
  studentState.experience = result?.experience ?? {
    mode: result?.exam?.mode ?? "exam",
    requiresAdmission: true,
    requiresFullscreen: true,
    hasTimeLimit: true,
    proctoringEnabled: true,
    autosaveEnabled: true,
    revealScoreAfterSubmission: false,
  };
  document.body.dataset.mode = studentState.experience.mode;
}

function columnLetter(index: any) { return String.fromCharCode(65 + index); }

function selectionRange() {
  if (!studentState.selectionStart || !studentState.selectionEnd) return null;
  const firstRow: any = Math.min(studentState.selectionStart.row, studentState.selectionEnd.row);
  const lastRow: any = Math.max(studentState.selectionStart.row, studentState.selectionEnd.row);
  const firstColumn: any = Math.min(studentState.selectionStart.column, studentState.selectionEnd.column);
  const lastColumn: any = Math.max(studentState.selectionStart.column, studentState.selectionEnd.column);
  const start: any = `${columnLetter(firstColumn)}${firstRow + 2}`;
  const end: any = `${columnLetter(lastColumn)}${lastRow + 2}`;
  return { firstRow, lastRow, firstColumn, lastColumn, reference: start === end ? start : `${start}:${end}` };
}

function paintSelection() {
  const range: any = selectionRange();
  if (!range) return;
  for (const cell of document.querySelectorAll(".dataCell")) {
    const row: any = Number(cell.dataset.row); const column: any = Number(cell.dataset.column);
    const selected: any = row >= range.firstRow && row <= range.lastRow && column >= range.firstColumn && column <= range.lastColumn;
    cell.classList.toggle("isSelected", selected);
    cell.classList.toggle("isSelectionEdge", selected && (row === range.firstRow || row === range.lastRow || column === range.firstColumn || column === range.lastColumn));
  }
  for (const header of document.querySelectorAll(".columnLetter[data-column]")) header.classList.toggle("isSelected", Number(header.dataset.column) >= range.firstColumn && Number(header.dataset.column) <= range.lastColumn);
  for (const header of document.querySelectorAll(".rowNumber[data-row]")) header.classList.toggle("isSelected", Number(header.dataset.row) >= range.firstRow && Number(header.dataset.row) <= range.lastRow);
}

function scheduleSelectionPaint() {
  if (selectionPaintFrame !== null) return;
  selectionPaintFrame = scheduleFrame(() => {
    selectionPaintFrame = null;
    paintSelection();
  });
}

function insertSelectedRange() {
  const range: any = selectionRange();
  const input: any = document.querySelector("#formula-answer");
  if (!range || input.disabled) return;
  const start: any = input.selectionStart ?? input.value.length;
  const end: any = input.selectionEnd ?? start;
  input.value = `${input.value.slice(0, start)}${range.reference}${input.value.slice(end)}`;
  input.focus();
  input.setSelectionRange(start + range.reference.length, start + range.reference.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function hideFormulaSuggestions() {
  formulaAssistantRevision += 1;
  const input: any = document.querySelector("#formula-answer");
  const suggestions: any = document.querySelector("#formulaSuggestions");
  suggestions.hidden = true;
  suggestions.replaceChildren();
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  studentState.formulaCompletion = null;
  studentState.formulaSuggestionIndex = 0;
}

function acceptFormulaSuggestion(index = studentState.formulaSuggestionIndex) {
  const input: any = document.querySelector("#formula-answer");
  const selected: any = studentState.formulaCompletion?.items[index];
  if (!selected || !formulaAssistantModule) return;
  const completion: any = formulaAssistantModule.applyFunctionCompletion(input.value, input.selectionStart ?? input.value.length, selected.name);
  input.value = completion.value;
  input.focus();
  input.setSelectionRange(completion.cursor, completion.cursor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderFormulaAssistant({ preserveIndex = false } = {}) {
  const revision = ++formulaAssistantRevision;
  const assistant = await loadFormulaAssistant();
  if (revision !== formulaAssistantRevision || !studentState.attempt) return;
  const input: any = document.querySelector("#formula-answer");
  const suggestions: any = document.querySelector("#formulaSuggestions");
  const completion: any = assistant.getFunctionCompletions(input.value, input.selectionStart ?? input.value.length);
  if (!preserveIndex) studentState.formulaSuggestionIndex = 0;
  studentState.formulaSuggestionIndex = Math.max(0, Math.min(studentState.formulaSuggestionIndex, completion.items.length - 1));
  studentState.formulaCompletion = completion;
  const options = completion.items.map((item: any, index: any) => {
    const option: any = document.createElement("button");
    option.type = "button";
    option.id = `formula-suggestion-${index}`;
    option.className = `formulaSuggestion${index === studentState.formulaSuggestionIndex ? " isActive" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", index === studentState.formulaSuggestionIndex ? "true" : "false");
    option.tabIndex = -1;
    const heading: any = document.createElement("span"); heading.append(createElement("strong", "", item.name), createElement("code", "", item.syntax));
    option.append(heading, createElement("small", "", `${item.descriptionJa} / ${item.descriptionEn}`));
    option.addEventListener("pointerdown", (event: any) => { event.preventDefault(); acceptFormulaSuggestion(index); });
    return option;
  });
  suggestions.replaceChildren(...options);

  suggestions.hidden = completion.items.length === 0;
  input.setAttribute("aria-expanded", completion.items.length ? "true" : "false");
  if (completion.items.length) input.setAttribute("aria-activedescendant", `formula-suggestion-${studentState.formulaSuggestionIndex}`);
  else input.removeAttribute("aria-activedescendant");

  const help: any = assistant.findActiveFunctionHelp(input.value, input.selectionStart ?? input.value.length);
  const helpPanel: any = document.querySelector("#formulaFunctionHelp");
  helpPanel.hidden = !help;
  document.querySelector("#formula-help-syntax").textContent = help?.syntax ?? "";
  document.querySelector("#formula-help-ja").textContent = help?.descriptionJa ?? "";
  document.querySelector("#formula-help-en").textContent = help?.descriptionEn ?? "";
}

function scheduleFormulaAssistantRender() {
  if (formulaAssistantFrame !== null) return;
  formulaAssistantFrame = scheduleFrame(() => {
    formulaAssistantFrame = null;
    void renderFormulaAssistant();
  });
}

function stopAdmissionPolling() {
  clearTimeout(studentState.admissionTimer);
  studentState.admissionTimer = null;
}

function admissionPollDelay() {
  const backoff: any = Math.min(
    ADMISSION_POLL_MAX_MILLISECONDS,
    ADMISSION_POLL_BASE_MILLISECONDS * (2 ** Math.min(studentState.admissionFailures, 2)),
  );
  return backoff + Math.floor(Math.random() * ADMISSION_POLL_JITTER_MILLISECONDS);
}

function scheduleAdmissionPoll() {
  stopAdmissionPolling();
  studentState.admissionTimer = setTimeout(async () => {
    studentState.admissionTimer = null;
    try {
      const result: any = await request("/api/student/admission");
      studentState.admissionFailures = 0;
      if (startableEntryStatuses.has(result.status)) {
        studentState.csrfToken = result.csrfToken;
        showRulesWaiting(result);
        return;
      }
    } catch {
      studentState.admissionFailures += 1;
    }
    scheduleAdmissionPoll();
  }, admissionPollDelay());
}

function startAdmissionPolling() {
  studentState.admissionFailures = 0;
  scheduleAdmissionPoll();
}

function showTerminalEntry(result: any) {
  studentState.verifiedExam = result;
  applyStudentExperience(result);
  document.querySelector("#identity-card").hidden = true;
  document.querySelector("#identity-confirm-card").hidden = true;
  document.querySelector("#waiting-card").hidden = true;
  document.querySelector("#assignmentIntroCard").hidden = true;
  document.querySelector("#preflight-card").hidden = true;
  document.querySelector("#questionCard").hidden = true;
  document.querySelector("#submittedCard").hidden = true;
  document.querySelector("#terminalEntryCard").hidden = false;
  document.querySelector("#terminal-student").textContent = displayName(result.student.name);
  document.querySelector("#terminal-student-number").textContent = result.student.studentNumber;
  document.querySelector("#terminal-exam").textContent = result.exam.titleJa;
  const policy: any = result.status === "policy_submitted";
  document.querySelector("#terminalEntryMessage").textContent = policy
    ? "規則違反により0点で提出されています。再受験には毎回教師の許可が必要です。 / Submitted with zero for policy violations. Every new attempt requires teacher approval."
    : "提出済みのため、この答案には再入場できません。 / This submitted answer sheet cannot be reopened.";
  document.querySelector("#terminal-status").textContent = "教師の指示を待ってください。 / Wait for your teacher.";
  if (studentState.experience.requiresAdmission) startAdmissionPolling();
}

function showRulesWaiting(result: any) {
  studentState.verifiedExam = result;
  applyStudentExperience(result);
  stopAdmissionPolling();
  document.querySelector("#identity-card").hidden = true;
  document.querySelector("#identity-confirm-card").hidden = true;
  document.querySelector("#terminalEntryCard").hidden = true;
  document.querySelector("#waiting-student").textContent = displayName(result.student.name);
  document.querySelector("#waiting-student-number").textContent = result.student.studentNumber;
  document.querySelector("#waiting-exam").textContent = result.exam.titleJa;
  document.querySelector("#waiting-duration").textContent = String(result.exam.durationMinutes);
  const waitingStatus: any = document.querySelector("#waitingStatus");
  const admitted: any = startableEntryStatuses.has(result.status);
  const resume: any = result.status === "resume_available";
  const policySuspended: any = result.status === "policy_suspended";
  waitingStatus.classList.toggle("isAdmitted", admitted);
  waitingStatus.querySelector("strong").textContent = policySuspended ? "規則違反により答案が一時停止されています。" : resume ? "保存済み答案を続きから再開します。" : admitted ? "先生が入室を許可しました。" : "先生の入室許可を待っています。";
  waitingStatus.querySelector("small").textContent = policySuspended ? "Your answer sheet is paused. The timer will resume only after teacher approval." : resume ? "Your saved answers and remaining time will be restored." : admitted ? "Your teacher approved your entry." : "Waiting for the teacher to approve your entry.";
  document.querySelector("#rules-continue").hidden = !admitted;
  document.querySelector("#waiting-card").hidden = false;
  if (!admitted) startAdmissionPolling();
}

function showAssignmentIntro(result: any) {
  studentState.verifiedExam = result;
  applyStudentExperience(result);
  stopAdmissionPolling();
  document.querySelector("#identity-card").hidden = true;
  document.querySelector("#identity-confirm-card").hidden = true;
  document.querySelector("#waiting-card").hidden = true;
  document.querySelector("#terminalEntryCard").hidden = true;
  document.querySelector("#preflight-card").hidden = true;
  document.querySelector("#questionCard").hidden = true;
  document.querySelector("#submittedCard").hidden = true;
  document.querySelector("#assignment-student").textContent = displayName(result.student.name);
  document.querySelector("#assignment-student-number").textContent = result.student.studentNumber;
  document.querySelector("#assignment-exam").textContent = result.exam.titleJa;
  document.querySelector("#assignment-start-status").textContent = "";
  document.querySelector("#assignmentIntroCard").hidden = false;
}

function draftKey(attemptId: any, questionKey: any) { return `exam-platform-draft:${attemptId}:${questionKey}`; }
function currentQuestion() { return studentState.attempt?.questions[studentState.currentIndex] ?? null; }
function answerValues() { return isAssignmentMode() ? studentState.practiceAnswers : studentState.attempt?.answers?.values ?? (studentState.attempt?.answer ? { [studentState.attempt.answer.questionKey]: studentState.attempt.answer.formula } : {}); }
function answerVersion() { return studentState.attempt?.answers?.version ?? studentState.attempt?.answer?.version ?? 0; }
function isManualQuestion(question: any) { return ["single_choice", "multiple_choice", "fill_blank", "short_answer"].includes(question?.questionMode); }
function isManualAttempt() { return isManualQuestion(studentState.attempt?.questions?.[0]); }
function hasAnswer(value: any): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.values(value).some(hasAnswer));
}
function sameAnswer(left: any, right: any): boolean { return JSON.stringify(left ?? "") === JSON.stringify(right ?? ""); }
function storedDraft(question: any): any {
  const raw: any = localStorage.getItem(draftKey(studentState.attempt.id, question.key));
  if (raw === null || !isManualQuestion(question)) return raw;
  try { return JSON.parse(raw); } catch { return null; }
}
function draftValue(question: any) {
  return isAssignmentMode()
    ? studentState.practiceAnswers[question.key]
    : storedDraft(question);
}
function storeDraft(question: any, value: any) {
  localStorage.setItem(draftKey(studentState.attempt.id, question.key), isManualQuestion(question) ? JSON.stringify(value) : String(value));
}

function closeOpenExamDialogs() {
  clearTimeout(studentState.submitConfirmTimer);
  clearTimeout(studentState.finalSubmitConfirmTimer);
  clearInterval(studentState.violationTimer);
  clearFullscreenRecoveryCountdown();
  fullscreenRecoveryGuard.cancelPendingRecovery();
  studentState.submissionConfirmationToken = null;
  studentState.violationActive = false;
  for (const selector of ["#submitDialog", "#finalSubmitDialog", "#violationDialog"]) {
    const dialog: any = document.querySelector(selector);
    if (dialog.open) dialog.close();
  }
}

function setSubmitted(submission: any) {
  studentState.monitoring = false;
  focusGuard.cancelPendingLoss();
  fullscreenRecoveryGuard.cancelPendingRecovery();
  navigationGuard.release();
  clearInterval(studentState.countdownTimer); clearInterval(studentState.heartbeatTimer); clearTimeout(studentState.saveTimer); clearTimeout(studentState.submitUnlockTimer); clearTimeout(studentState.submitConfirmTimer); clearTimeout(studentState.finalSubmitConfirmTimer); clearTimeout(studentState.deadlineRecoveryTimer);
  closeOpenExamDialogs();
  document.querySelector("#questionCard").inert = false;
  studentState.terminationCollecting = false;
  studentState.deadlineSubmissionActive = false;
  if (!isAssignmentMode()) for (const question of studentState.attempt?.questions ?? []) localStorage.removeItem(draftKey(studentState.attempt.id, question.key));
  document.querySelector("#questionCard").hidden = true;
  document.querySelector("#submittedCard").hidden = false;
  document.querySelector("#submitted-time").textContent = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(submission.submittedAt));
  document.querySelector("#submitted-type").textContent = submission.type === "timer" ? "時間終了による自動提出" : submission.type === "teacher" ? "教師による一括回収" : submission.type === "policy" ? "規則による自動提出" : "手動提出";
  const assignmentResult: any = document.querySelector("#assignmentResult");
  assignmentResult.hidden = !isAssignmentMode();
  document.querySelector("#assignment-retry").hidden = !isAssignmentMode() || submission.attemptsRemaining < 1;
  if (isAssignmentMode()) {
    document.querySelector("#assignment-score").textContent = `${submission.score} / ${submission.maximumScore}`;
    document.querySelector("#assignment-correct-count").textContent = `${submission.correctCount} / ${submission.questionCount} 正解 / correct`;
    document.querySelector(".submittedCard > p:not(.kicker):not(.submittedNote)").textContent = "採点が完了しました。問題と回答は再表示できません。 / Grading is complete. Questions and answers cannot be reopened.";
    document.querySelector(".submittedNote").textContent = submission.attemptsRemaining > 0
      ? "もう一度提出できます。2回目も同じ課題に最初から回答します。 / You may submit once more, starting the same practice from the beginning."
      : "2回の提出が完了しました。 / Both submissions are complete.";
  } else {
    document.querySelector(".submittedCard > p:not(.kicker):not(.submittedNote)").textContent = "提出後は問題や回答を再度見ることはできません。採点結果は先生から案内されます。";
    document.querySelector(".submittedNote").textContent = "この画面を閉じて、先生の指示を待ってください。";
  }
}

const violationCopy: any = {
  page_hidden: { ja: "試験ウィンドウから離れました。不正行為として記録されました。", en: "You left the exam window. This is cheating and has been recorded." },
  copy_blocked: { ja: "コピー操作は禁止されています。", en: "Copying exam content is prohibited." },
  paste_blocked: { ja: "貼り付け操作は禁止されています。", en: "Pasting content into the exam is prohibited." },
};

function getViolationCopy(eventType: string, fullscreenGraceMs: number | null) {
  if (eventType !== "fullscreen_exit") return violationCopy[eventType];
  const graceSeconds = Math.max(1, (fullscreenGraceMs ?? getFullscreenRecoveryGraceMs(1)) / 1_000);
  return {
    ja: `${graceSeconds}秒以内に全画面へ戻らなかったため、警告として記録しました。`,
    en: `You did not return to fullscreen within ${graceSeconds} seconds. One warning has been recorded.`,
  };
}

function browserMonotonicNow() {
  return window.performance?.now?.() ?? Date.now();
}

function clearFullscreenRecoveryCountdown() {
  clearInterval(studentState.fullscreenRecoveryTimer);
  studentState.fullscreenRecoveryTimer = null;
}

function showFullscreenRecovery(deadlineAt: number, graceMs: number, interruptionCount: number) {
  const graceSeconds = graceMs / 1_000;
  const nextGraceSeconds = getFullscreenRecoveryGraceMs(interruptionCount + 1) / 1_000;
  clearTimeout(studentState.submitConfirmTimer);
  clearTimeout(studentState.finalSubmitConfirmTimer);
  studentState.submissionConfirmationToken = null;
  for (const selector of ["#submitDialog", "#finalSubmitDialog"]) {
    const openDialog: any = document.querySelector(selector);
    if (openDialog.open) openDialog.close();
  }

  const dialog: any = document.querySelector("#violationDialog");
  const questionCard: any = document.querySelector("#questionCard");
  questionCard.inert = true;
  document.querySelector("#violation-message-ja").textContent = `全画面モードが解除されました。今回は${graceSeconds}秒以内に戻れば警告には記録されません。次回の復帰猶予は${nextGraceSeconds}秒です。`;
  document.querySelector("#violationMessageEn").textContent = `Fullscreen interruption ${interruptionCount}: return within ${graceSeconds} seconds to avoid a warning. The next recovery grace period is ${nextGraceSeconds} seconds.`;
  document.querySelector("#violation-occurred-at").textContent = `全画面解除 ${interruptionCount} 回目 · 現在は未記録 / INTERRUPTION ${interruptionCount} · NOT RECORDED YET`;
  const confirm: any = document.querySelector("#violation-confirm");
  confirm.replaceChildren(document.createTextNode("全画面に戻る"), document.createElement("br"), createElement("small", "", "RETURN TO FULLSCREEN"));
  confirm.disabled = false;
  if (!dialog.open) dialog.showModal();

  const countdown: any = document.querySelector("#violation-countdown");
  const renderCountdown = () => {
    const secondsRemaining = Math.max(0, Math.ceil((deadlineAt - browserMonotonicNow()) / 1_000));
    countdown.textContent = `警告記録まで ${secondsRemaining} 秒 / ${secondsRemaining} SECONDS BEFORE A WARNING IS RECORDED`;
  };
  clearFullscreenRecoveryCountdown();
  renderCountdown();
  studentState.fullscreenRecoveryTimer = setInterval(renderCountdown, 250);
}

function dismissFullscreenRecovery() {
  clearFullscreenRecoveryCountdown();
  if (studentState.violationActive || studentState.policySuspended) return;
  const dialog: any = document.querySelector("#violationDialog");
  if (dialog.open) dialog.close();
  document.querySelector("#questionCard").inert = false;
}

function confirmFullscreenExit(signal: any, graceMs: number) {
  clearFullscreenRecoveryCountdown();
  const graceSeconds = graceMs / 1_000;
  document.querySelector("#violation-countdown").textContent = `${graceSeconds}秒の復帰猶予が終了しました。警告を記録しています… / ${graceSeconds}-SECOND GRACE PERIOD ENDED. RECORDING WARNING…`;
  document.querySelector("#violation-confirm").disabled = true;
  void reportViolation(signal, { acknowledgementSeconds: 0, fullscreenGraceMs: graceMs });
}

function showPolicySuspension(suspension: any) {
  const alreadySuspended: any = studentState.policySuspended;
  studentState.policySuspended = true;
  studentState.monitoring = false;
  focusGuard.cancelPendingLoss();
  fullscreenRecoveryGuard.cancelPendingRecovery();
  clearFullscreenRecoveryCountdown();
  if (studentState.attempt) studentState.attempt.status = "policy_suspended";
  clearInterval(studentState.countdownTimer);
  clearTimeout(studentState.saveTimer);
  const dialog: any = document.querySelector("#violationDialog");
  document.querySelector("#violation-message-ja").textContent = "禁止操作が3回記録されたため、答案を一時停止しました。答案と残り時間は保存されています。先生が再開を許可するまで待ってください。";
  document.querySelector("#violationMessageEn").textContent = "Three prohibited actions were recorded. Your answer sheet is paused, with answers and remaining time preserved. Wait for your teacher to reopen it.";
  document.querySelector("#violation-countdown").textContent = "先生の再開許可を待っています。 / WAITING FOR TEACHER APPROVAL.";
  const confirm: any = document.querySelector("#violation-confirm");
  confirm.replaceChildren(document.createTextNode("再開許可を待っています"), document.createElement("br"), createElement("small", "", "WAITING FOR TEACHER"));
  confirm.disabled = true;
  if (!dialog.open) dialog.showModal();
  document.querySelector("#attempt-deadline").textContent = `一時停止 · 残り ${Math.ceil((suspension?.remainingSeconds ?? 0) / 60)} 分 / PAUSED`;
  if (!alreadySuspended) startHeartbeat();
}

async function restorePolicySuspension(heartbeat: any) {
  if (!studentState.policySuspended) return;
  studentState.policySuspended = false;
  studentState.attempt.status = "in_progress";
  if (heartbeat.deadlineAt) studentState.attempt.deadlineAt = heartbeat.deadlineAt;
  studentState.monitoring = false;
  document.querySelector("#violation-message-ja").textContent = "先生が再開を許可しました。全画面に戻ると、保存済み答案と残り時間から続けられます。";
  document.querySelector("#violationMessageEn").textContent = "Your teacher reopened the exam. Return to fullscreen to continue with your saved answers and remaining time.";
  document.querySelector("#violation-countdown").textContent = "「試験に戻る」を押してください。 / CLICK “RETURN TO EXAM”.";
  const confirm: any = document.querySelector("#violation-confirm");
  confirm.replaceChildren(document.createTextNode("試験に戻る"), document.createElement("br"), createElement("small", "", "RETURN TO EXAM"));
  confirm.disabled = false;
  startCountdown();
  await saveAnswer();
}

async function reportViolation(integritySignal: any, { acknowledgementSeconds = VIOLATION_ACKNOWLEDGEMENT_SECONDS, fullscreenGraceMs = null }: any = {}) {
  if (!studentState.monitoring || !studentState.csrfToken || studentState.violationActive || Date.now() - studentState.lastViolationAt < 900) return;
  const eventType: any = integritySignal.sourceEventType;
  studentState.violationActive = true;
  studentState.lastViolationAt = Date.now();
  try {
    const result: any = await request("/api/student/proctor-events", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken }, body: JSON.stringify({ eventType }) });
    const dialog: any = document.querySelector("#violationDialog");
    const copy = getViolationCopy(eventType, fullscreenGraceMs);
    document.querySelector("#violation-message-ja").textContent = copy.ja;
    document.querySelector("#violationMessageEn").textContent = copy.en;
    const occurredAt: any = new Date(result.occurredAt);
    document.querySelector("#violation-occurred-at").textContent = `記録時刻 / RECORDED AT　${new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "medium" }).format(occurredAt)}`;
    if (result.suspension) { showPolicySuspension(result.suspension); return; }
    if (!dialog.open) dialog.showModal();
    const confirm: any = document.querySelector("#violation-confirm");
    const countdown: any = document.querySelector("#violation-countdown");
    const returnLabelJa: any = "試験に戻る";
    const returnLabelEn: any = "RETURN TO EXAM";
    confirm.replaceChildren(document.createTextNode(returnLabelJa), document.createElement("br"), createElement("small", "", returnLabelEn));
    let secondsRemaining: any = acknowledgementSeconds;
    confirm.disabled = true;
    const enableReturn = () => {
      countdown.textContent = acknowledgementSeconds === 0
        ? `警告を記録しました。「${returnLabelJa}」を押してください。 / WARNING RECORDED. CLICK “${returnLabelEn}”.`
        : `「${returnLabelJa}」を押してください。 / CLICK “${returnLabelEn}”.`;
      confirm.disabled = false;
    };
    const renderCountdown: any = () => {
      countdown.textContent = `あと ${secondsRemaining} 秒待ってから「${returnLabelJa}」を押してください。 / WAIT ${secondsRemaining} SECONDS, THEN CLICK “${returnLabelEn}”.`;
    };
    clearInterval(studentState.violationTimer);
    if (secondsRemaining <= 0) {
      enableReturn();
      return;
    }
    renderCountdown();
    studentState.violationTimer = setInterval(() => {
      secondsRemaining -= 1;
      if (secondsRemaining <= 0) {
        clearInterval(studentState.violationTimer);
        studentState.violationTimer = null;
        enableReturn();
        return;
      }
      renderCountdown();
    }, 1000);
  } catch {
    studentState.violationActive = false;
    document.querySelector("#submission-status").textContent = "監考イベントを記録できません。先生に知らせてください。";
    if (eventType === "fullscreen_exit") {
      document.querySelector("#violation-countdown").textContent = "警告を記録できませんでした。全画面へ戻り、先生に知らせてください。 / RETURN TO FULLSCREEN AND TELL YOUR TEACHER.";
      document.querySelector("#violation-confirm").disabled = false;
    }
  }
}

function startHeartbeat() {
  clearInterval(studentState.heartbeatTimer);
  const send: any = async () => {
    if (!studentState.attempt || studentState.attempt.submission || !studentState.csrfToken) return;
    try {
      const heartbeat: any = await request("/api/student/heartbeat", { method: "POST", headers: { "x-csrf-token": studentState.csrfToken } });
      studentState.heartbeatFailures = 0;
      if (heartbeat.status === "termination_collecting") {
        studentState.terminationCollecting = true;
        studentState.monitoring = false;
        clearInterval(studentState.countdownTimer);
        document.querySelector("#submission-status").textContent = "先生が答案を回収しています。最新の入力を保存しています。 / The teacher is collecting answers. Saving your latest input…";
        await flushCurrentAnswer();
        document.querySelector("#questionCard").inert = true;
      } else if (heartbeat.status === "policy_suspended") showPolicySuspension(heartbeat);
      else if (heartbeat.status === "active") await restorePolicySuspension(heartbeat);
    }
    catch (error: any) {
      if (studentState.terminationCollecting && error.status === 409) {
        try {
          const current: any = await request("/api/student/attempt");
          if (current.attempt?.submission) {
            studentState.attempt.submission = current.attempt.submission;
            document.querySelector("#questionCard").inert = false;
            setSubmitted(current.attempt.submission);
            return;
          }
        } catch { /* keep the collection screen while the final snapshot is committed */ }
      }
      studentState.heartbeatFailures += 1;
      if (studentState.heartbeatFailures >= 2) document.querySelector("#submission-status").textContent = "通信が不安定です。入力内容はこの端末にも保存しています。";
    }
  };
  send(); studentState.heartbeatTimer = setInterval(send, 5_000);
}

function saveAnswer() {
  if (isAssignmentMode()) return Promise.resolve(true);
  if (studentState.savePromise) return studentState.savePromise;
  if (!studentState.attempt || studentState.attempt.submission || !studentState.csrfToken) return Promise.resolve(true);
  const question: any = currentQuestion();
  if (!question) return Promise.resolve(true);
  const status: any = document.querySelector("#save-status");
  const input: any = document.querySelector("#formula-answer");
  const manual: any = isManualQuestion(question);
  const answer: any = manual ? (draftValue(question) ?? answerValues()[question.key] ?? "") : input.value;
  const rawDraft: any = localStorage.getItem(draftKey(studentState.attempt.id, question.key));
  if (rawDraft === null && sameAnswer(answerValues()[question.key], answer)) return Promise.resolve(true);
  status.textContent = "保存中…";
  studentState.savePromise = (async () => {
    try {
      const result: any = await request("/api/student/answer", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken },
        body: JSON.stringify({ questionKey: question.key, ...(manual ? { answer } : { formula: answer }), expectedVersion: answerVersion(), clientSavedAt: new Date().toISOString() }),
      });
      studentState.attempt.answer = result.answer;
      studentState.attempt.answers ??= { values: {}, version: 0, savedAt: null };
      studentState.attempt.answers.values[question.key] = answer;
      studentState.attempt.answers.version = result.answer.version;
      studentState.attempt.answers.savedAt = result.answer.savedAt;
      const currentDraft: any = draftValue(question);
      if (sameAnswer(currentDraft, answer)) {
        localStorage.removeItem(draftKey(studentState.attempt.id, question.key));
        status.textContent = `保存済み ${new Intl.DateTimeFormat("ja-JP", { timeStyle: "medium" }).format(new Date(result.answer.savedAt))}`;
      } else {
        status.textContent = "未保存";
        studentState.saveTimer = setTimeout(saveAnswer, 700);
      }
      return true;
    } catch (error: any) {
      status.textContent = error.status === 409 ? "別の画面で更新されました。ページを再読み込みしてください。" : "保存できません。入力内容はこの端末に一時保存しました。";
      return false;
    } finally {
      studentState.savePromise = null;
    }
  })();
  return studentState.savePromise;
}

async function flushCurrentAnswer() {
  if (isAssignmentMode()) return true;
  const question: any = currentQuestion();
  if (!question) return true;
  for (let attempt: any = 0; attempt < 3; attempt += 1) {
    if (localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null) return true;
    if (!await saveAnswer()) return false;
  }
  return localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null;
}

async function submitAttempt({ confirmationToken = null, allowUnsavedServerSnapshot = false } = {}) {
  if (!studentState.attempt || studentState.attempt.submission || !studentState.csrfToken) return;
  clearTimeout(studentState.saveTimer);
  if (!allowUnsavedServerSnapshot && !await flushCurrentAnswer()) {
    throw new Error("The latest answer could not be saved.");
  }
  const assignmentSubmission: any = isAssignmentMode();
  const result: any = assignmentSubmission
    ? await submitWithRetry({ request, answers: answerValues(), csrfToken: studentState.csrfToken })
    : await request("/api/student/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": studentState.csrfToken,
        },
        body: JSON.stringify(createFormalSubmissionPayload(confirmationToken)),
      });
  if (assignmentSubmission
    && Number(result.submission?.attemptNumber) !== Number(studentState.attempt.attemptNumber)) {
    const mismatch: any = new Error("Submission result does not belong to the current attempt.");
    mismatch.code = "SUBMISSION_ATTEMPT_MISMATCH";
    mismatch.status = 409;
    throw mismatch;
  }
  studentState.attempt.submission = result.submission;
  setSubmitted(result.submission);
}

function scheduleDeadlineSubmissionRecovery(delay = studentState.deadlineRecoveryDelay) {
  clearTimeout(studentState.deadlineRecoveryTimer);
  if (!studentState.deadlineSubmissionActive || studentState.attempt?.submission) return;
  const boundedDelay = Math.min(15_000, Math.max(4_000, delay));
  studentState.deadlineRecoveryDelay = boundedDelay;
  studentState.deadlineRecoveryTimer = setTimeout(async () => {
    if (!studentState.deadlineSubmissionActive || studentState.attempt?.submission) return;
    try {
      const current: any = await request("/api/student/attempt");
      if (current.attempt?.submission) {
        studentState.attempt.submission = current.attempt.submission;
        setSubmitted(current.attempt.submission);
        return;
      }
      await submitAttempt({ allowUnsavedServerSnapshot: true });
    } catch {
      document.querySelector("#submission-status").textContent = "自動提出の確認を続けています。画面を閉じないでください。 / Still confirming automatic submission. Keep this page open.";
    }
    if (!studentState.attempt?.submission) scheduleDeadlineSubmissionRecovery(Math.ceil(boundedDelay * 1.6));
  }, boundedDelay + Math.floor(Math.random() * 1_000));
}

async function submitAtDeadline() {
  if (studentState.deadlineSubmissionActive) return;
  studentState.deadlineSubmissionActive = true;
  closeOpenExamDialogs();
  document.querySelector("#questionCard").inert = true;
  document.querySelector("#submission-status").textContent = "制限時間が終了しました。答案を自動提出しています… / Time is up. Submitting your answers automatically…";
  try {
    await submitDeadlineWithRetry({
      prepareBestEffort: flushCurrentAnswer,
      submit: () => submitAttempt({ allowUnsavedServerSnapshot: true }),
    });
  } catch {
    document.querySelector("#submission-status").textContent = "自動提出をまだ確認できません。再接続後も自動確認を続けます。画面を閉じず、先生に知らせてください。 / Automatic submission is not confirmed yet. This page will keep checking after reconnection.";
    scheduleDeadlineSubmissionRecovery();
  }
}

function startCountdown() {
  clearInterval(studentState.countdownTimer);
  if (!studentState.experience?.hasTimeLimit || !studentState.attempt?.deadlineAt) return;
  const update: any = () => {
    const remaining: any = Math.max(0, new Date(studentState.attempt.deadlineAt).getTime() - Date.now());
    const seconds: any = Math.ceil(remaining / 1000);
    const hours: any = Math.floor(seconds / 3600);
    const minutes: any = Math.floor((seconds % 3600) / 60);
    const rest: any = seconds % 60;
    document.querySelector("#attempt-deadline").textContent = `残り ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    if (remaining > 0 && remaining <= 3_000 && !studentState.deadlineFinalSyncRequested) {
      studentState.deadlineFinalSyncRequested = true;
      void flushCurrentAnswer();
    }
    if (remaining === 0) {
      clearInterval(studentState.countdownTimer);
      void submitAtDeadline();
    }
  };
  update();
  studentState.countdownTimer = setInterval(update, 1000);
}

function renderQuestion(index: any) {
  studentState.currentIndex = Math.max(0, Math.min(index, studentState.attempt.questions.length - 1));
  const question: any = currentQuestion();
  studentState.selectionStart = null; studentState.selectionEnd = null;
  document.querySelector("#question-position").textContent = `${studentState.currentIndex + 1} / ${studentState.attempt.questions.length}`;
  const displayLocale: any = studentDisplayLocale();
  document.querySelector("#question-title").textContent = displayLocale === "en" ? `Question ${studentState.currentIndex + 1}` : displayLocale === "zh" ? `问题 ${studentState.currentIndex + 1}` : `問題 ${studentState.currentIndex + 1}`;
  if (isManualQuestion(question)) {
    document.querySelector("#excel-quick-guide").hidden = true;
    document.querySelector("#manual-quick-guide").hidden = false;
    renderSafeMarkdown(document.querySelector("#question-prompt"), question.promptMarkdown ?? "");
    document.querySelector("#question-prompt").hidden = false;
    document.querySelector("#questionPromptEn").textContent = "";
    document.querySelector("#question-tip").hidden = true;
    document.querySelector("#functionCountBadge").hidden = true;
    document.querySelector("#formula-workbench").hidden = true;
    document.querySelector("#choiceWorkbench").hidden = true;
    document.querySelector("#manual-workbench").hidden = false;
    const image: any = document.querySelector("#manualPromptImage");
    image.hidden = !question.image?.dataUrl;
    image.src = question.image?.dataUrl ?? "";
    image.alt = question.image?.alt ?? "";
    document.querySelector("#previous-button").disabled = studentState.currentIndex === 0;
    document.querySelector("#next-button").disabled = studentState.currentIndex === studentState.attempt.questions.length - 1;
    const savedValue: any = draftValue(question) ?? answerValues()[question.key] ?? (question.questionMode === "multiple_choice" ? [] : question.questionMode === "fill_blank" ? {} : "");
    renderManualResponse(question, savedValue);
    document.querySelector(".questionMain").classList.toggle("hasAnswer", hasAnswer(savedValue));
    document.querySelector("#save-status").textContent = localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null ? "保存済み" : "未保存";
    document.querySelector("#undo-button").disabled = true;
    document.querySelector("#redo-button").disabled = true;
    hideFormulaSuggestions(); document.querySelector("#formulaFunctionHelp").hidden = true;
    renderQuestionIndex();
    return;
  }
  document.querySelector("#manual-workbench").hidden = true;
  document.querySelector("#excel-quick-guide").hidden = false;
  document.querySelector("#manual-quick-guide").hidden = true;
  document.querySelector("#manualPromptImage").hidden = true;
  renderJapaneseWithReadings(document.querySelector("#question-prompt"), question.promptJa);
  document.querySelector("#question-prompt").hidden = displayLocale === "en";
  document.querySelector("#questionPromptEn").textContent = displayLocale === "ja" ? "" : question.promptEn ?? "";
  document.querySelector("#questionPromptEn").hidden = displayLocale === "ja";
  document.querySelector("#answer-cell").textContent = question.answerCell ?? "—";
  document.querySelector("#previous-button").disabled = studentState.currentIndex === 0;
  document.querySelector("#next-button").disabled = studentState.currentIndex === studentState.attempt.questions.length - 1;
  const isChoice: any = question.questionMode === "choice" || question.kind === "choice";
  const functionCountBadge: any = document.querySelector("#functionCountBadge");
  functionCountBadge.hidden = isChoice || !question.compositionLabelJa;
  functionCountBadge.textContent = functionCountBadge.hidden
    ? ""
    : displayLocale === "en"
      ? question.compositionLabelEn ?? "Multi-function question"
      : displayLocale === "legacy_bilingual"
        ? `${question.compositionLabelJa} / ${question.compositionLabelEn ?? "Multi-function question"}`
        : question.compositionLabelJa;
  const tip: any = document.querySelector("#question-tip");
  tip.hidden = isChoice || !question.tipJa;
  if (!tip.hidden) renderJapaneseWithReadings(tip, question.tipJa);
  else tip.replaceChildren();
  document.querySelector("#formula-workbench").hidden = isChoice;
  document.querySelector("#choiceWorkbench").hidden = !isChoice;
  const savedValue: any = draftValue(question) ?? answerValues()[question.key] ?? "";
  const input: any = document.querySelector("#formula-answer");
  input.placeholder = "=FUNCTION(...)";
  studentState.suppressHistory = true; input.value = savedValue; studentState.suppressHistory = false;
  document.querySelector(".questionMain").classList.toggle("hasAnswer", Boolean(savedValue.trim()));
  document.querySelector("#save-status").textContent = isAssignmentMode()
    ? "このページ内のみ保持 / Not saved after exit"
    : localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null ? "保存済み" : "未保存";
  if (!studentState.histories.has(question.key)) studentState.histories.set(question.key, { undo: [], redo: [], last: savedValue });
  updateHistoryControls();
  if (isChoice) {
    const options: any = document.querySelector("#choice-options");
    const optionNodes = question.options.map((value: any) => {
      const label: any = document.createElement("label"); const radio: any = document.createElement("input"); radio.type = "radio"; radio.name = "choice-answer"; radio.value = value; radio.checked = savedValue === value;
      radio.addEventListener("change", () => setCurrentAnswer(value)); label.append(radio, document.createTextNode(value)); return label;
    });
    options.replaceChildren(...optionNodes);
  } else renderSheet(question);
  if (isChoice) { hideFormulaSuggestions(); document.querySelector("#formulaFunctionHelp").hidden = true; }
  else void renderFormulaAssistant();
  renderQuestionIndex();
}

function renderManualResponse(question: any, savedValue: any) {
  const choiceSection: any = document.querySelector("#manualChoiceResponse");
  const fillSection: any = document.querySelector("#manualFillResponse");
  const shortSection: any = document.querySelector("#manualShortResponse");
  choiceSection.hidden = true; fillSection.hidden = true; shortSection.hidden = true;
  if (question.questionMode === "single_choice" || question.questionMode === "multiple_choice") {
    choiceSection.hidden = false;
    const multiple: any = question.questionMode === "multiple_choice";
    const selected: any = new Set(multiple && Array.isArray(savedValue) ? savedValue : typeof savedValue === "string" && savedValue ? [savedValue] : []);
    const options: any = document.querySelector("#manual-choice-options");
    const optionNodes = (question.options ?? []).map((option: any) => {
      const label: any = document.createElement("label");
      const input: any = document.createElement("input"); input.type = multiple ? "checkbox" : "radio"; input.name = `manual-${question.key}`; input.value = option.id; input.checked = selected.has(option.id);
      input.addEventListener("change", () => {
        if (multiple) {
          if (input.checked) selected.add(option.id); else selected.delete(option.id);
          setManualAnswer([...selected]);
        } else setManualAnswer(option.id);
      });
      const content: any = document.createElement("div"); renderSafeMarkdown(content, option.markdown);
      label.append(input, content); return label;
    });
    options.replaceChildren(...optionNodes);
    return;
  }
  if (question.questionMode === "fill_blank") {
    fillSection.hidden = false;
    const values: any = savedValue && typeof savedValue === "object" && !Array.isArray(savedValue) ? { ...savedValue } : {};
    const segments: Node[] = [];
    for (const segment of question.segments ?? []) {
      if (segment.kind === "text") {
        const content: any = document.createElement("span"); renderSafeMarkdown(content, segment.markdown); segments.push(content); continue;
      }
      const input: any = document.createElement("input"); input.type = "text"; input.maxLength = 500; input.value = values[segment.id] ?? ""; input.autocomplete = "off"; input.setAttribute("aria-label", `空欄 ${segment.id}`);
      input.addEventListener("input", () => { values[segment.id] = input.value; setManualAnswer(values); }); segments.push(input);
    }
    fillSection.replaceChildren(...segments);
    return;
  }
  shortSection.hidden = false;
  const textarea: any = document.querySelector("#manual-short-answer"); textarea.value = typeof savedValue === "string" ? savedValue : "";
  renderSafeMarkdown(document.querySelector("#manual-short-preview"), textarea.value);
}

function scheduleMarkdownPreview(markdown: string) {
  pendingMarkdownPreview = markdown;
  if (markdownPreviewFrame !== null) return;
  markdownPreviewFrame = scheduleFrame(() => {
    markdownPreviewFrame = null;
    renderSafeMarkdown(document.querySelector("#manual-short-preview"), pendingMarkdownPreview);
  });
}

function renderSheet(question: any) {
  document.querySelector("#identity-card").hidden = true;
  const table: any = document.querySelector("#question-table");
  const letters: any = document.createElement("tr");
  letters.append(createElement("th", "cornerCell", ""));
  question.table.columns.forEach((_: any, columnIndex: any) => {
    const header: any = createElement("th", "columnLetter", columnLetter(columnIndex)); header.dataset.column = String(columnIndex);
    header.addEventListener("mousedown", (event: any) => { event.preventDefault(); studentState.selectionStart = { row: 0, column: columnIndex }; studentState.selectionEnd = { row: question.table.rows.length - 1, column: columnIndex }; paintSelection(); insertSelectedRange(); });
    letters.append(header);
  });
  const head: any = document.createElement("tr");
  head.append(createElement("th", "rowNumber", "1"));
  for (const column of question.table.columns) head.append(createElement("th", "fieldHeader", column));
  const body: any = question.table.rows.map((row: any, index: any) => {
    const tableRow: any = document.createElement("tr");
    const rowHeader: any = createElement("th", "rowNumber", String(index + 2)); rowHeader.dataset.row = String(index); tableRow.append(rowHeader);
    question.table.columns.forEach((column: any, columnIndex: any) => {
      const cell: any = createElement("td", "dataCell", String(row[column] ?? "")); cell.dataset.row = String(index); cell.dataset.column = String(columnIndex); cell.dataset.ref = `${columnLetter(columnIndex)}${index + 2}`;
      cell.addEventListener("mousedown", (event: any) => { event.preventDefault(); studentState.selecting = true; studentState.selectionStart = { row: index, column: columnIndex }; studentState.selectionEnd = { row: index, column: columnIndex }; paintSelection(); });
      cell.addEventListener("mouseenter", () => { if (studentState.selecting) { studentState.selectionEnd = { row: index, column: columnIndex }; scheduleSelectionPaint(); } });
      tableRow.append(cell);
    });
    return tableRow;
  });
  table.replaceChildren(letters, head, ...body);
}

function renderQuestionIndex() {
  const container: any = document.querySelector("#questionIndex");
  const questions: any[] = studentState.attempt.questions;
  let buttons: any[] = [...container.querySelectorAll("button")];
  if (buttons.length !== questions.length) {
    buttons = questions.map((_: any, index: any) => {
      const button: any = createElement("button", "", String(index + 1));
      button.type = "button";
      button.addEventListener("click", () => navigateToQuestion(index));
      return button;
    });
    container.replaceChildren(...buttons);
  }
  const values: any = answerValues();
  let answered = 0;
  questions.forEach((question: any, index: any) => {
    const hasCurrentAnswer = hasAnswer(draftValue(question) ?? values[question.key]);
    if (hasCurrentAnswer) answered += 1;
    buttons[index].classList.toggle("isCurrent", index === studentState.currentIndex);
    buttons[index].classList.toggle("isAnswered", hasCurrentAnswer);
  });
  document.querySelector("#answered-count").textContent = `${answered} / ${questions.length} 回答済み`;
}

function scheduleQuestionIndexRender() {
  if (questionIndexFrame !== null) return;
  questionIndexFrame = scheduleFrame(() => {
    questionIndexFrame = null;
    if (studentState.attempt) renderQuestionIndex();
  });
}

async function navigateToQuestion(index: any) {
  if (index === studentState.currentIndex) return;
  clearTimeout(studentState.saveTimer); await flushCurrentAnswer(); renderQuestion(index);
}

function setCurrentAnswer(value: any, { record = true } = {}) {
  const question: any = currentQuestion(); if (!question) return;
  const input: any = document.querySelector("#formula-answer"); const history: any = studentState.histories.get(question.key) ?? { undo: [], redo: [], last: "" };
  if (record && value !== history.last) { history.undo.push(history.last); if (history.undo.length > 100) history.undo.shift(); history.redo = []; }
  history.last = value; studentState.histories.set(question.key, history);
  studentState.suppressHistory = true; input.value = value; studentState.suppressHistory = false;
  for (const radio of document.querySelectorAll('input[name="choice-answer"]')) radio.checked = radio.value === value;
  if (isAssignmentMode()) studentState.practiceAnswers[question.key] = value;
  else localStorage.setItem(draftKey(studentState.attempt.id, question.key), value);
  document.querySelector(".questionMain").classList.toggle("hasAnswer", Boolean(value.trim()));
  document.querySelector("#save-status").textContent = isAssignmentMode() ? "このページ内のみ保持 / Not saved after exit" : "未保存";
  clearTimeout(studentState.saveTimer);
  if (!isAssignmentMode()) studentState.saveTimer = setTimeout(saveAnswer, 700);
  updateHistoryControls(); scheduleQuestionIndexRender();
  if (question.questionMode !== "choice" && question.kind !== "choice") scheduleFormulaAssistantRender();
}

function setManualAnswer(value: any) {
  const question: any = currentQuestion(); if (!question || !isManualQuestion(question)) return;
  storeDraft(question, value);
  document.querySelector(".questionMain").classList.toggle("hasAnswer", hasAnswer(value));
  document.querySelector("#save-status").textContent = "未保存";
  clearTimeout(studentState.saveTimer);
  studentState.saveTimer = setTimeout(saveAnswer, 700);
  scheduleQuestionIndexRender();
}

function updateHistoryControls() {
  const history: any = studentState.histories.get(currentQuestion()?.key);
  document.querySelector("#undo-button").disabled = !history?.undo.length;
  document.querySelector("#redo-button").disabled = !history?.redo.length;
}

function changeHistory(direction: any) {
  const question: any = currentQuestion(); if (!question) return; const history: any = studentState.histories.get(question.key); if (!history) return;
  const source: any = direction === "undo" ? history.undo : history.redo; const destination: any = direction === "undo" ? history.redo : history.undo; if (!source.length) return;
  destination.push(history.last); const value: any = source.pop(); history.last = value; setCurrentAnswer(value, { record: false });
}

function renderAttempt(attempt: any) {
  const attemptId = String(attempt?.id ?? "");
  // 同一答案では復帰猶予の使用回数を維持し、新しい答案だけ10秒から再開する。
  if (!attemptId || studentState.fullscreenRecoveryAttemptId !== attemptId) {
    fullscreenRecoveryGuard.resetRecoveryHistory();
    studentState.fullscreenRecoveryAttemptId = attemptId || null;
  } else {
    fullscreenRecoveryGuard.cancelPendingRecovery();
  }
  studentState.attempt = attempt;
  applyStudentExperience(attempt);
  focusGuard.cancelPendingLoss();
  clearFullscreenRecoveryCountdown();
  studentState.practiceAnswers = {};
  studentState.histories.clear();
  document.querySelector("#identity-card").hidden = true; document.querySelector("#waiting-card").hidden = true; document.querySelector("#assignmentIntroCard").hidden = true; document.querySelector("#preflight-card").hidden = true;
  if (attempt.submission) { setSubmitted(attempt.submission); return; }
  document.querySelector("#submittedCard").hidden = true; document.querySelector("#questionCard").hidden = false; document.querySelector("#questionCard").inert = false;
  const submitDialog: any = document.querySelector("#submitDialog");
  if (submitDialog.open) submitDialog.close();
  const finalSubmitDialog: any = document.querySelector("#finalSubmitDialog");
  if (finalSubmitDialog.open) finalSubmitDialog.close();
  studentState.submissionConfirmationToken = null;
  studentState.deadlineSubmissionActive = false;
  studentState.deadlineFinalSyncRequested = false;
  studentState.deadlineRecoveryDelay = 4_000;
  clearTimeout(studentState.deadlineRecoveryTimer);
  const submitButton: any = document.querySelector("#submit-button");
  clearTimeout(studentState.submitUnlockTimer);
  studentState.manualSubmissionUnlockedAt = isAssignmentMode()
    ? 0
    : Date.now() + MANUAL_SUBMISSION_GUARD_MILLISECONDS;
  submitButton.disabled = !isAssignmentMode();
  submitButton.replaceChildren(
    document.createTextNode(isAssignmentMode() ? "答案を提出する" : "問題を確認してください"),
    document.createElement("br"),
    Object.assign(document.createElement("small"), {
      textContent: isAssignmentMode() ? "FINAL SUBMISSION" : "SUBMISSION UNLOCKS IN 5 SECONDS",
    }),
  );
  if (!isAssignmentMode()) {
    studentState.submitUnlockTimer = setTimeout(() => {
      if (studentState.attempt !== attempt || attempt.submission) return;
      submitButton.disabled = false;
      submitButton.replaceChildren(
        document.createTextNode("答案を提出する"),
        document.createElement("br"),
        Object.assign(document.createElement("small"), { textContent: "FINAL SUBMISSION" }),
      );
    }, MANUAL_SUBMISSION_GUARD_MILLISECONDS);
  }
  document.querySelector("#attempt-student-name").textContent = displayName(attempt.student.name);
  document.querySelector("#attempt-student-number").textContent = attempt.student.studentNumber;
  studentState.monitoring = studentState.experience.proctoringEnabled;
  navigationGuard.arm();
  renderQuestion(0);
  if (studentState.experience.hasTimeLimit) startCountdown();
  if (studentState.experience.proctoringEnabled) startHeartbeat();
}

document.querySelector("#fullscreen-button").addEventListener("click", async (event: any) => {
  if (!isFullscreenAvailable(document, document.documentElement) || !studentState.csrfToken) return;
  const button: any = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  try {
    await requestFullscreen(document.documentElement);
    updateFullscreenState();
    if (!getFullscreenElement(document)) return;
    const result: any = await request("/api/student/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken },
      body: JSON.stringify({ browserPreflight: browserPreflight() }),
    });
    renderAttempt(result.attempt);
  } catch (error: any) {
    updateFullscreenState();
    const startMessages: any = {
      DUPLICATE_SESSION: "以前の接続がまだ有効です。約1分待ってから、もう一度開始してください。 / The previous connection is still active. Wait about one minute and try again.",
      NOT_ADMITTED: "教師の入室許可をもう一度確認してください。 / Ask your teacher to confirm admission again.",
      RESUME_NOT_AUTHORIZED: "続きから再開するには教師の許可が必要です。 / Teacher authorization is required to resume.",
      ATTEMPT_LOCKED: "この答案はすでに終了しているため開始できません。 / This attempt is already closed and cannot be started.",
      ROOM_COLLECTION_ACTIVE: "先生が答案を回収しています。この試験には入場できません。 / The teacher is collecting answers. You cannot enter this exam.",
      EXAM_CLOSED: "この試験は終了しました。再入場や回答の再開はできません。 / This exam has ended. You cannot re-enter or resume answering.",
      PAPER_NOT_PREPARED: "この学生の試験問題を準備できていません。先生に知らせてください。 / This student's paper is not ready. Ask your teacher.",
    };
    document.querySelector("#fullscreen-state").textContent = startMessages[error.code]
      ?? "試験を開始できませんでした。先生に知らせてください。 / The exam could not be started. Ask your teacher.";
  } finally {
    button.disabled = false;
  }
});
observeFullscreenChanges(document, () => {
  updateFullscreenState();
  fullscreenRecoveryGuard.handleFullscreenChange();
});

document.querySelector("#assignment-start").addEventListener("click", async (event: any) => {
  const button: any = event.currentTarget;
  button.disabled = true;
  document.querySelector("#assignment-start-status").textContent = "開始しています… / Starting…";
  try {
    const result: any = await request("/api/student/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken },
      body: "{}",
    });
    renderAttempt(result.attempt);
  } catch (error: any) {
    document.querySelector("#assignment-start-status").textContent = error.code === "ATTEMPT_LOCKED"
      ? "提出回数の上限に達しています。 / You have used both submissions."
      : "課題を開始できませんでした。先生に知らせてください。 / The practice could not be started. Ask your teacher.";
  } finally {
    button.disabled = false;
  }
});

const identityForm: any = document.querySelector("#identityForm");
const identityMessage: any = document.querySelector("#identity-message");
identityForm.addEventListener("submit", (event: any) => {
  event.preventDefault();
  if (document.documentElement.dataset["studentEntryReact"] === "ready") return;
  identityMessage.textContent = "画面を読み込めませんでした。再読み込みしてください。";
});

document.addEventListener(STUDENT_ENTRY_VERIFIED_EVENT, (event: any) => {
  const detail: any = event.detail;
  if (!detail?.identity || !detail.result) return;
  studentState.pendingIdentity = detail.identity;
  studentState.csrfToken = detail.result.csrfToken;
  applyStudentExperience(detail.result);
  if (terminalEntryStatuses.has(detail.result.status)) showTerminalEntry(detail.result);
  else if (isAssignmentMode()) showAssignmentIntro(detail.result);
  else showRulesWaiting(detail.result);
});

document.querySelector("#rules-continue").addEventListener("click", () => {
  document.querySelector("#waiting-card").hidden = true;
  document.querySelector("#preflight-card").hidden = false;
  runPreflight();
});

runPreflight();

document.querySelector("#terminal-back").addEventListener("click", () => {
  stopAdmissionPolling();
  document.querySelector("#terminalEntryCard").hidden = true;
  document.dispatchEvent(new Event(STUDENT_ENTRY_SHOW_EVENT));
});
document.querySelector("#terminal-recheck").addEventListener("click", async (event: any) => {
  if (!studentState.pendingIdentity) return;
  const button: any = event.currentTarget;
  button.disabled = true;
  document.querySelector("#terminal-status").textContent = "確認中… / Checking eligibility…";
  try {
    const result: any = await request("/api/student/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(studentState.pendingIdentity) });
    studentState.csrfToken = result.csrfToken;
    applyStudentExperience(result);
    if (terminalEntryStatuses.has(result.status)) showTerminalEntry(result);
    else if (isAssignmentMode()) showAssignmentIntro(result);
    else showRulesWaiting(result);
  } catch { document.querySelector("#terminal-status").textContent = "確認できませんでした。先生に知らせてください。 / Check failed. Ask your teacher."; }
  finally { button.disabled = false; }
});

document.querySelector("#formula-answer").addEventListener("input", (event: any) => {
  if (!studentState.attempt || studentState.suppressHistory) return;
  setCurrentAnswer(event.target.value);
});
document.querySelector("#formula-answer").addEventListener("keydown", (event: any) => {
  const suggestions: any = studentState.formulaCompletion?.items ?? [];
  if (!suggestions.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction: any = event.key === "ArrowDown" ? 1 : -1;
    studentState.formulaSuggestionIndex = (studentState.formulaSuggestionIndex + direction + suggestions.length) % suggestions.length;
    void renderFormulaAssistant({ preserveIndex: true });
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault(); acceptFormulaSuggestion();
  } else if (event.key === "Escape") {
    event.preventDefault(); hideFormulaSuggestions();
  }
});
document.querySelector("#formula-answer").addEventListener("click", () => scheduleFormulaAssistantRender());
document.querySelector("#formula-answer").addEventListener("focus", () => scheduleFormulaAssistantRender());
document.querySelector("#formula-answer").addEventListener("blur", () => setTimeout(hideFormulaSuggestions, 120));
document.querySelector("#manual-short-answer").addEventListener("input", (event: any) => {
  if (!studentState.attempt || currentQuestion()?.questionMode !== "short_answer") return;
  setManualAnswer(event.target.value);
  scheduleMarkdownPreview(event.target.value);
});

document.querySelector("#submit-button").addEventListener("click", () => {
  if (!isAssignmentMode() && Date.now() < studentState.manualSubmissionUnlockedAt) {
    document.querySelector("#submission-status").textContent = "試験問題を確認してから提出してください。 / Review the questions before submitting.";
    return;
  }
  const values: any = answerValues();
  const unanswered: any = studentState.attempt.questions.filter((question: any) => !hasAnswer(draftValue(question) ?? values[question.key])).length;
  document.querySelector("#submit-summary").textContent = unanswered
    ? `未回答の問題が ${unanswered} 問あります。`
    : "すべての問題に回答しています。";
  document.querySelector("#submit-lock-copy").textContent = isAssignmentMode()
    ? "提出後は今回の答案を再表示できません。残り回数がある場合も空白から始まります。 / After submission, this answer sheet cannot be reopened. Any remaining submission starts blank."
    : "提出後はこの答案を再閲覧・再回答できません。再受験には毎回教師の許可が必要です。 / After confirmation, this answer sheet is locked. A teacher must approve every new attempt.";
  const submitError: any = document.querySelector("#submitError");
  submitError.hidden = true;
  submitError.textContent = "";
  const confirmButton: any = document.querySelector("#submit-confirm");
  clearTimeout(studentState.submitConfirmTimer);
  studentState.submitDialogReadyAt = Date.now() + SUBMISSION_DIALOG_CONFIRMATION_MILLISECONDS;
  confirmButton.disabled = true;
  confirmButton.textContent = "内容を確認してください / REVIEW FIRST";
  document.querySelector("#submitDialog").showModal();
  studentState.submitConfirmTimer = setTimeout(() => {
    if (!document.querySelector("#submitDialog").open) return;
    confirmButton.disabled = false;
    confirmButton.textContent = isAssignmentMode()
      ? "確認して提出 / CONFIRM SUBMISSION"
      : "最終確認へ進む / CONTINUE";
  }, SUBMISSION_DIALOG_CONFIRMATION_MILLISECONDS);
});
document.querySelector("#previous-button").addEventListener("click", () => navigateToQuestion(studentState.currentIndex - 1));
document.querySelector("#next-button").addEventListener("click", () => navigateToQuestion(studentState.currentIndex + 1));
document.querySelector("#undo-button").addEventListener("click", () => changeHistory("undo"));
document.querySelector("#redo-button").addEventListener("click", () => changeHistory("redo"));
document.querySelector("#submit-cancel").addEventListener("click", () => {
  clearTimeout(studentState.submitConfirmTimer);
  document.querySelector("#submitDialog").close();
});
document.querySelector("#submitDialog").addEventListener("cancel", (event: any) => {
  event.preventDefault();
  clearTimeout(studentState.submitConfirmTimer);
  document.querySelector("#submitDialog").close();
});
document.querySelector("#submit-confirm").addEventListener("click", async (event: any) => {
  const button: any = event.currentTarget;
  if (Date.now() < studentState.submitDialogReadyAt) return;
  const submitError: any = document.querySelector("#submitError");
  button.disabled = true;
  button.textContent = isAssignmentMode() ? "送信中… / SUBMITTING…" : "最終確認を準備中… / PREPARING…";
  submitError.hidden = true;
  try {
    if (isAssignmentMode()) {
      await submitAttempt();
      document.querySelector("#submitDialog").close();
      return;
    }
    const confirmation: any = await request("/api/student/submission-confirmation", {
      method: "POST",
      headers: { "x-csrf-token": studentState.csrfToken },
    });
    if (studentState.deadlineSubmissionActive || studentState.attempt?.submission) return;
    studentState.submissionConfirmationToken = confirmation.confirmationToken;
    document.querySelector("#submitDialog").close();
    document.querySelector("#final-submit-student-number").textContent = studentState.attempt.student.studentNumber;
    const finalError: any = document.querySelector("#final-submit-error");
    finalError.hidden = true;
    finalError.textContent = "";
    const finalButton: any = document.querySelector("#final-submit-confirm");
    clearTimeout(studentState.finalSubmitConfirmTimer);
    studentState.finalSubmitDialogReadyAt = Date.now() + FINAL_SUBMISSION_CONFIRMATION_MILLISECONDS;
    finalButton.disabled = true;
    finalButton.replaceChildren(
      document.createTextNode("内容を確認してください"),
      document.createElement("br"),
      Object.assign(document.createElement("small"), { textContent: "REVIEW FIRST" }),
    );
    document.querySelector("#finalSubmitDialog").showModal();
    studentState.finalSubmitConfirmTimer = setTimeout(() => {
      if (!document.querySelector("#finalSubmitDialog").open) return;
      finalButton.disabled = false;
      finalButton.replaceChildren(
        document.createTextNode("最終確定して提出"),
        document.createElement("br"),
        Object.assign(document.createElement("small"), { textContent: "FINAL CONFIRM & SUBMIT" }),
      );
    }, FINAL_SUBMISSION_CONFIRMATION_MILLISECONDS);
  } catch (error: any) {
    const copy: any = describeSubmissionFailure(error);
    submitError.textContent = copy.dialog;
    submitError.hidden = false;
    document.querySelector("#submission-status").textContent = copy.status;
  } finally {
    button.textContent = isAssignmentMode()
      ? "確認して提出 / CONFIRM SUBMISSION"
      : "最終確認へ進む / CONTINUE";
    button.disabled = false;
  }
});
document.querySelector("#final-submit-cancel").addEventListener("click", () => {
  clearTimeout(studentState.finalSubmitConfirmTimer);
  studentState.submissionConfirmationToken = null;
  document.querySelector("#finalSubmitDialog").close();
});
document.querySelector("#finalSubmitDialog").addEventListener("cancel", (event: any) => {
  event.preventDefault();
  clearTimeout(studentState.finalSubmitConfirmTimer);
  studentState.submissionConfirmationToken = null;
  document.querySelector("#finalSubmitDialog").close();
});
document.querySelector("#final-submit-confirm").addEventListener("click", async (event: any) => {
  if (studentState.deadlineSubmissionActive
    || Date.now() < studentState.finalSubmitDialogReadyAt
    || !studentState.submissionConfirmationToken) return;
  const button: any = event.currentTarget;
  const submitError: any = document.querySelector("#final-submit-error");
  button.disabled = true;
  button.textContent = "送信中… / SUBMITTING…";
  submitError.hidden = true;
  try {
    await submitAttempt({ confirmationToken: studentState.submissionConfirmationToken });
    studentState.submissionConfirmationToken = null;
    document.querySelector("#finalSubmitDialog").close();
  } catch (error: any) {
    const copy: any = describeSubmissionFailure(error);
    submitError.textContent = copy.dialog;
    submitError.hidden = false;
    document.querySelector("#submission-status").textContent = copy.status;
  } finally {
    button.replaceChildren(
      document.createTextNode("最終確定して提出"),
      document.createElement("br"),
      Object.assign(document.createElement("small"), { textContent: "FINAL CONFIRM & SUBMIT" }),
    );
    button.disabled = false;
  }
});

document.querySelector("#assignment-retry").addEventListener("click", async (event: any) => {
  if (!studentState.pendingIdentity) return;
  const button: any = event.currentTarget;
  button.disabled = true;
  try {
    const result: any = await request("/api/student/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(studentState.pendingIdentity),
    });
    studentState.csrfToken = result.csrfToken;
    if (terminalEntryStatuses.has(result.status)) showTerminalEntry(result);
    else showAssignmentIntro(result);
  } catch {
    document.querySelector(".submittedNote").textContent = "2回目を開始できませんでした。先生に知らせてください。 / The second submission could not be started. Ask your teacher.";
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("keydown", (event: any) => {
  if (!studentState.attempt || document.querySelector("#questionCard").hidden || !(event.ctrlKey || event.metaKey)) return;
  const key: any = event.key.toLowerCase();
  if (key === "z") { event.preventDefault(); changeHistory(event.shiftKey ? "redo" : "undo"); }
  if (key === "y") { event.preventDefault(); changeHistory("redo"); }
});

document.addEventListener("mouseup", () => { if (studentState.selecting) { studentState.selecting = false; insertSelectedRange(); } });
document.addEventListener("copy", (event: any) => { if (studentState.monitoring) { event.preventDefault(); reportViolation(createBrowserIntegritySignal("copy_blocked")); } });
document.addEventListener("paste", (event: any) => { if (studentState.monitoring) { event.preventDefault(); reportViolation(createBrowserIntegritySignal("paste_blocked")); } });
window.addEventListener("beforeunload", (event: any) => { if (studentState.monitoring) { event.preventDefault(); event.returnValue = ""; } });
document.querySelector("#violation-confirm").addEventListener("click", async () => {
  const dialog: any = document.querySelector("#violationDialog");
  if (studentState.policySuspended) return;
  if (studentState.attempt?.submission) { dialog.close(); studentState.violationActive = false; return; }
  try {
    await requestFullscreen(document.documentElement);
    if (getFullscreenElement(document)) {
      fullscreenRecoveryGuard.handleFullscreenChange();
      if (dialog.open) dialog.close();
      document.querySelector("#questionCard").inert = false;
      studentState.violationActive = false;
      studentState.monitoring = studentState.experience.proctoringEnabled;
    }
  }
  catch { document.querySelector("#violationMessageEn").textContent = "Fullscreen could not be restored. Ask your teacher for help."; }
});
document.querySelector("#violationDialog").addEventListener("cancel", (event: any) => event.preventDefault());

// 所有旧考试控制器监听器完成注册后再开放 React 身份确认，避免接管事件丢失。
document.documentElement.dataset["studentEntryController"] = "ready";
document.dispatchEvent(new Event(STUDENT_ENTRY_CONTROLLER_READY_EVENT));
