import { renderJapaneseWithReadings } from "./japanese-readings.js";
import { detectSupportedBrowser } from "./browser-compatibility.js";
import { renderSafeMarkdown } from "../shared/safe-markdown.js";
import { getFullscreenElement, isFullscreenAvailable, observeFullscreenChanges, requestFullscreen } from "./fullscreen-compatibility.js";
import { createAssessmentNavigationGuard, createBrowserIntegritySignal, createFullscreenRecoveryGuard, createTransientFocusGuard, getFullscreenRecoveryGraceMs, } from "./exam-behavior-guard.js";
import { createFormalSubmissionPayload, describeSubmissionFailure, submitDeadlineWithRetry, submitWithRetry, } from "./submission-request.js";
import { STUDENT_ENTRY_CONTROLLER_READY_EVENT, STUDENT_ENTRY_SHOW_EVENT, STUDENT_ENTRY_VERIFIED_EVENT, } from "./student-entry-bridge.js";
import { applyStudentShellLocale, formatStudentText, isStudentDisplayLocale, resolveStudentDisplayLocale, } from "./student-localization.js";
const document = globalThis.document;
const window = globalThis.window;
const location = globalThis.location;
const navigator = globalThis.navigator;
const VIOLATION_ACKNOWLEDGEMENT_SECONDS = 5;
const MANUAL_SUBMISSION_GUARD_MILLISECONDS = 5_000;
const SUBMISSION_DIALOG_CONFIRMATION_MILLISECONDS = 1_200;
const FINAL_SUBMISSION_CONFIRMATION_MILLISECONDS = 1_500;
const ADMISSION_POLL_BASE_MILLISECONDS = 5_000;
const ADMISSION_POLL_JITTER_MILLISECONDS = 2_000;
const ADMISSION_POLL_MAX_MILLISECONDS = 15_000;
let formulaAssistantModule = null;
let formulaAssistantPromise = null;
let selectionPaintFrame = null;
let questionIndexFrame = null;
let formulaAssistantFrame = null;
let markdownPreviewFrame = null;
let pendingMarkdownPreview = "";
let formulaAssistantRevision = 0;
function scheduleFrame(callback) {
    return typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(callback)
        : window.setTimeout(callback, 16);
}
function loadFormulaAssistant() {
    formulaAssistantPromise ??= import("./formula-assistant.js").then((module) => {
        formulaAssistantModule = module;
        return module;
    });
    return formulaAssistantPromise;
}
function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className)
        element.className = className;
    if (text !== undefined)
        element.textContent = text;
    return element;
}
function displayName(value) { const name = String(value ?? ""); return name.includes("?") && /\p{L}/u.test(name.replaceAll("?", "")) ? name.replaceAll(/\?+/g, " ").replaceAll(/\s+/g, " ").trim() : name; }
async function request(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", ...options });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
        const error = new Error(body?.error ?? "通信に失敗しました。");
        error.status = response.status;
        error.code = body?.code ?? null;
        throw error;
    }
    return body;
}
function storageAvailable() {
    try {
        const key = "excel-web-exam-preflight";
        localStorage.setItem(key, "1");
        localStorage.removeItem(key);
        return true;
    }
    catch {
        return false;
    }
}
function isSecureEnvironment() {
    return window.isSecureContext || ["localhost", "127.0.0.1"].includes(window.location.hostname);
}
function updateFullscreenState() {
    document.querySelector("#fullscreen-state").textContent = getFullscreenElement(document)
        ? t("全画面モード：ON", "全屏模式：已开启", "Fullscreen: on")
        : t("全画面モード：OFF", "全屏模式：未开启", "Fullscreen: off");
}
function browserPreflight() {
    const browser = detectSupportedBrowser(navigator.userAgent);
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
    const browser = detectSupportedBrowser(navigator.userAgent);
    const checks = [
        [`${t("対応ブラウザ", "支持的浏览器", "Supported browser")} (Chrome / Edge 109+, Firefox 115+, macOS Safari 16.4+): ${browser.family} ${browser.version ?? "?"}`, browser.supported],
        [t("安全な接続（HTTPS / localhost）", "安全连接（HTTPS / localhost）", "Secure connection (HTTPS / localhost)"), isSecureEnvironment()],
        [t("全画面 API", "全屏功能", "Fullscreen support"), isFullscreenAvailable(document, document.documentElement)],
        [t("ローカル保存", "本地保存", "Local storage"), storageAvailable()],
        [t("ページ表示の監視", "页面可见性检测", "Page visibility monitoring"), typeof document.visibilityState === "string"],
        [t("ネットワーク通信", "网络连接", "Network access"), typeof window.fetch === "function"],
    ];
    const list = document.querySelector("#preflight-list");
    const items = checks.map(([label, passed]) => {
        const item = document.createElement("li");
        item.append(createElement("span", "", label), createElement("strong", passed ? "pass" : "check", passed ? "OK" : t("確認", "检查", "Check")));
        return item;
    });
    list.replaceChildren(...items);
    updateFullscreenState();
    document.querySelector("#fullscreen-button").disabled = !browser.supported
        || !isFullscreenAvailable(document, document.documentElement);
}
const studentState = { csrfToken: null, attempt: null, pendingIdentity: null, verifiedExam: null, studentLocale: "legacy_bilingual", experience: null, practiceAnswers: {}, currentIndex: 0, histories: new Map(), suppressHistory: false, saveTimer: null, savePromise: null, countdownTimer: null, admissionTimer: null, admissionFailures: 0, heartbeatTimer: null, heartbeatFailures: 0, violationTimer: null, fullscreenRecoveryTimer: null, fullscreenRecoveryAttemptId: null, violationActive: false, policySuspended: false, terminationCollecting: false, monitoring: false, selecting: false, selectionStart: null, selectionEnd: null, lastViolationAt: 0, formulaCompletion: null, formulaSuggestionIndex: 0, manualSubmissionUnlockedAt: 0, submitUnlockTimer: null, submitDialogReadyAt: 0, submitConfirmTimer: null, submissionConfirmationToken: null, finalSubmitDialogReadyAt: 0, finalSubmitConfirmTimer: null, deadlineSubmissionActive: false, deadlineRecoveryTimer: null, deadlineRecoveryDelay: 4_000, deadlineFinalSyncRequested: false };
const questionCard = document.querySelector("#questionCard");
const syncExamViewport = () => document.body.classList.toggle("examInProgress", !questionCard.hidden);
// 旧版 Firefox 也能稳定切换考试专用视口，不依赖 CSS :has()。
new MutationObserver(syncExamViewport).observe(questionCard, { attributes: true, attributeFilter: ["hidden"] });
syncExamViewport();
const terminalEntryStatuses = new Set(["submitted", "auto_submitted", "teacher_submitted", "policy_submitted", "review_required"]);
const startableEntryStatuses = new Set(["admitted", "resume_available"]);
const navigationGuard = createAssessmentNavigationGuard({
    documentRef: document,
    windowRef: window,
    shouldProtect: () => Boolean(studentState.attempt
        && !studentState.attempt.submission
        && !document.querySelector("#questionCard").hidden),
    onNavigationBlocked: () => {
        document.querySelector("#submission-status").textContent = t("戻る操作を無効にしました。答案はこのページに保持されています。", "已阻止返回操作，答卷仍保留在此页面。", "Back navigation was blocked. Your answer sheet remains on this page.");
    },
});
const focusGuard = createTransientFocusGuard({
    documentRef: document,
    windowRef: window,
    shouldMonitor: () => studentState.monitoring && Boolean(getFullscreenElement(document)),
    onConfirmedLoss: (signal) => reportViolation(signal),
});
const fullscreenRecoveryGuard = createFullscreenRecoveryGuard({
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
function resultStudentDisplayLocale(result) {
    if (!result || typeof result !== "object" || !("exam" in result))
        return null;
    const exam = result.exam;
    if (!exam || typeof exam !== "object" || !("studentLocale" in exam))
        return null;
    const locale = exam.studentLocale;
    return isStudentDisplayLocale(locale) ? locale : null;
}
function studentDisplayLocale() {
    const locale = studentState.studentLocale;
    return isStudentDisplayLocale(locale) ? locale : "legacy_bilingual";
}
function studentText(copy) {
    return formatStudentText(copy, studentDisplayLocale());
}
function t(ja, zh, en) {
    return studentText({ ja, zh, en });
}
function studentDateLocale() {
    return studentDisplayLocale() === "zh" ? "zh-CN" : studentDisplayLocale() === "en" ? "en-US" : "ja-JP";
}
function setLocalizedPair(primary, secondary, copy) {
    const locale = studentDisplayLocale();
    primary.textContent = locale === "legacy_bilingual" ? copy.ja : copy[locale];
    secondary.textContent = locale === "legacy_bilingual" ? copy.en : "";
    secondary.hidden = locale !== "legacy_bilingual";
}
function applyStudentDisplayLocale(result) {
    const datasetLocale = document.documentElement.dataset.studentLocale;
    const locale = resolveStudentDisplayLocale(resultStudentDisplayLocale(result), studentState.studentLocale, datasetLocale);
    studentState.studentLocale = locale;
    applyStudentShellLocale(document, locale);
}
function applyStudentExperience(result) {
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
function columnLetter(index) { return String.fromCharCode(65 + index); }
function selectionRange() {
    if (!studentState.selectionStart || !studentState.selectionEnd)
        return null;
    const firstRow = Math.min(studentState.selectionStart.row, studentState.selectionEnd.row);
    const lastRow = Math.max(studentState.selectionStart.row, studentState.selectionEnd.row);
    const firstColumn = Math.min(studentState.selectionStart.column, studentState.selectionEnd.column);
    const lastColumn = Math.max(studentState.selectionStart.column, studentState.selectionEnd.column);
    const start = `${columnLetter(firstColumn)}${firstRow + 2}`;
    const end = `${columnLetter(lastColumn)}${lastRow + 2}`;
    return { firstRow, lastRow, firstColumn, lastColumn, reference: start === end ? start : `${start}:${end}` };
}
function paintSelection() {
    const range = selectionRange();
    if (!range)
        return;
    for (const cell of document.querySelectorAll(".dataCell")) {
        const row = Number(cell.dataset.row);
        const column = Number(cell.dataset.column);
        const selected = row >= range.firstRow && row <= range.lastRow && column >= range.firstColumn && column <= range.lastColumn;
        cell.classList.toggle("isSelected", selected);
        cell.classList.toggle("isSelectionEdge", selected && (row === range.firstRow || row === range.lastRow || column === range.firstColumn || column === range.lastColumn));
    }
    for (const header of document.querySelectorAll(".columnLetter[data-column]"))
        header.classList.toggle("isSelected", Number(header.dataset.column) >= range.firstColumn && Number(header.dataset.column) <= range.lastColumn);
    for (const header of document.querySelectorAll(".rowNumber[data-row]"))
        header.classList.toggle("isSelected", Number(header.dataset.row) >= range.firstRow && Number(header.dataset.row) <= range.lastRow);
}
function scheduleSelectionPaint() {
    if (selectionPaintFrame !== null)
        return;
    selectionPaintFrame = scheduleFrame(() => {
        selectionPaintFrame = null;
        paintSelection();
    });
}
function insertSelectedRange() {
    const range = selectionRange();
    const input = document.querySelector("#formula-answer");
    if (!range || input.disabled)
        return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = `${input.value.slice(0, start)}${range.reference}${input.value.slice(end)}`;
    input.focus();
    input.setSelectionRange(start + range.reference.length, start + range.reference.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}
function hideFormulaSuggestions() {
    formulaAssistantRevision += 1;
    const input = document.querySelector("#formula-answer");
    const suggestions = document.querySelector("#formulaSuggestions");
    suggestions.hidden = true;
    suggestions.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    studentState.formulaCompletion = null;
    studentState.formulaSuggestionIndex = 0;
}
function acceptFormulaSuggestion(index = studentState.formulaSuggestionIndex) {
    const input = document.querySelector("#formula-answer");
    const selected = studentState.formulaCompletion?.items[index];
    if (!selected || !formulaAssistantModule)
        return;
    const completion = formulaAssistantModule.applyFunctionCompletion(input.value, input.selectionStart ?? input.value.length, selected.name);
    input.value = completion.value;
    input.focus();
    input.setSelectionRange(completion.cursor, completion.cursor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function renderFormulaAssistant({ preserveIndex = false } = {}) {
    const revision = ++formulaAssistantRevision;
    const assistant = await loadFormulaAssistant();
    if (revision !== formulaAssistantRevision || !studentState.attempt)
        return;
    const input = document.querySelector("#formula-answer");
    const suggestions = document.querySelector("#formulaSuggestions");
    const completion = assistant.getFunctionCompletions(input.value, input.selectionStart ?? input.value.length);
    if (!preserveIndex)
        studentState.formulaSuggestionIndex = 0;
    studentState.formulaSuggestionIndex = Math.max(0, Math.min(studentState.formulaSuggestionIndex, completion.items.length - 1));
    studentState.formulaCompletion = completion;
    const options = completion.items.map((item, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.id = `formula-suggestion-${index}`;
        option.className = `formulaSuggestion${index === studentState.formulaSuggestionIndex ? " isActive" : ""}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", index === studentState.formulaSuggestionIndex ? "true" : "false");
        option.tabIndex = -1;
        const heading = document.createElement("span");
        heading.append(createElement("strong", "", item.name), createElement("code", "", item.syntax));
        option.append(heading, createElement("small", "", studentDisplayLocale() === "ja"
            ? item.descriptionJa
            : studentDisplayLocale() === "legacy_bilingual"
                ? `${item.descriptionJa} / ${item.descriptionEn}`
                : item.descriptionEn));
        option.addEventListener("pointerdown", (event) => { event.preventDefault(); acceptFormulaSuggestion(index); });
        return option;
    });
    suggestions.replaceChildren(...options);
    suggestions.hidden = completion.items.length === 0;
    input.setAttribute("aria-expanded", completion.items.length ? "true" : "false");
    if (completion.items.length)
        input.setAttribute("aria-activedescendant", `formula-suggestion-${studentState.formulaSuggestionIndex}`);
    else
        input.removeAttribute("aria-activedescendant");
    const help = assistant.findActiveFunctionHelp(input.value, input.selectionStart ?? input.value.length);
    const helpPanel = document.querySelector("#formulaFunctionHelp");
    helpPanel.hidden = !help;
    document.querySelector("#formula-help-syntax").textContent = help?.syntax ?? "";
    document.querySelector("#formula-help-ja").textContent = !help ? "" : studentDisplayLocale() === "en" || studentDisplayLocale() === "zh" ? help.descriptionEn : help.descriptionJa;
    document.querySelector("#formula-help-en").textContent = studentDisplayLocale() === "legacy_bilingual" ? help?.descriptionEn ?? "" : "";
}
function scheduleFormulaAssistantRender() {
    if (formulaAssistantFrame !== null)
        return;
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
    const backoff = Math.min(ADMISSION_POLL_MAX_MILLISECONDS, ADMISSION_POLL_BASE_MILLISECONDS * (2 ** Math.min(studentState.admissionFailures, 2)));
    return backoff + Math.floor(Math.random() * ADMISSION_POLL_JITTER_MILLISECONDS);
}
function scheduleAdmissionPoll() {
    stopAdmissionPolling();
    studentState.admissionTimer = setTimeout(async () => {
        studentState.admissionTimer = null;
        try {
            const result = await request("/api/student/admission");
            studentState.admissionFailures = 0;
            if (startableEntryStatuses.has(result.status)) {
                studentState.csrfToken = result.csrfToken;
                showRulesWaiting(result);
                return;
            }
        }
        catch {
            studentState.admissionFailures += 1;
        }
        scheduleAdmissionPoll();
    }, admissionPollDelay());
}
function startAdmissionPolling() {
    studentState.admissionFailures = 0;
    scheduleAdmissionPoll();
}
function showTerminalEntry(result) {
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
    const policy = result.status === "policy_submitted";
    document.querySelector("#terminalEntryMessage").textContent = policy
        ? t("規則違反により0点で提出されています。再受験には毎回教師の許可が必要です。", "因违规该答卷已按0分提交；再次考试需要教师批准。", "This answer sheet was submitted with a score of zero for policy violations. Teacher approval is required for another attempt.")
        : t("提出済みのため、この答案には再入場できません。", "该答卷已提交，无法再次进入。", "This submitted answer sheet cannot be reopened.");
    document.querySelector("#terminal-status").textContent = t("教師の指示を待ってください。", "请等待教师指示。", "Wait for your teacher.");
    if (studentState.experience.requiresAdmission)
        startAdmissionPolling();
}
function showRulesWaiting(result) {
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
    document.querySelector("#waiting-duration-unit").textContent = t("分", "分钟", "minutes");
    const waitingStatus = document.querySelector("#waitingStatus");
    const admitted = startableEntryStatuses.has(result.status);
    const resume = result.status === "resume_available";
    const policySuspended = result.status === "policy_suspended";
    waitingStatus.classList.toggle("isAdmitted", admitted);
    const waitingCopy = policySuspended
        ? { ja: "規則違反により答案が一時停止されています。", zh: "答卷因违规已暂停，等待教师恢复。", en: "Your answer sheet is paused. The timer will resume only after teacher approval." }
        : resume
            ? { ja: "保存済み答案を続きから再開します。", zh: "将恢复已保存的答案和剩余时间。", en: "Your saved answers and remaining time will be restored." }
            : admitted
                ? { ja: "先生が入室を許可しました。", zh: "教师已批准进入考场。", en: "Your teacher approved your entry." }
                : { ja: "先生の入室許可を待っています。", zh: "正在等待教师批准进入考场。", en: "Waiting for the teacher to approve your entry." };
    setLocalizedPair(waitingStatus.querySelector("strong"), waitingStatus.querySelector("small"), waitingCopy);
    document.querySelector("#rules-continue").hidden = !admitted;
    document.querySelector("#waiting-card").hidden = false;
    if (!admitted)
        startAdmissionPolling();
}
function showAssignmentIntro(result) {
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
function draftKey(attemptId, questionKey) { return `exam-platform-draft:${attemptId}:${questionKey}`; }
function currentQuestion() { return studentState.attempt?.questions[studentState.currentIndex] ?? null; }
function answerValues() { return isAssignmentMode() ? studentState.practiceAnswers : studentState.attempt?.answers?.values ?? (studentState.attempt?.answer ? { [studentState.attempt.answer.questionKey]: studentState.attempt.answer.formula } : {}); }
function answerVersion() { return studentState.attempt?.answers?.version ?? studentState.attempt?.answer?.version ?? 0; }
function isManualQuestion(question) { return ["single_choice", "multiple_choice", "fill_blank", "short_answer"].includes(question?.questionMode); }
function isManualAttempt() { return isManualQuestion(studentState.attempt?.questions?.[0]); }
function hasAnswer(value) {
    if (typeof value === "string")
        return value.trim().length > 0;
    if (Array.isArray(value))
        return value.length > 0;
    return Boolean(value && typeof value === "object" && Object.values(value).some(hasAnswer));
}
function sameAnswer(left, right) { return JSON.stringify(left ?? "") === JSON.stringify(right ?? ""); }
function storedDraft(question) {
    const raw = localStorage.getItem(draftKey(studentState.attempt.id, question.key));
    if (raw === null || !isManualQuestion(question))
        return raw;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function draftValue(question) {
    return isAssignmentMode()
        ? studentState.practiceAnswers[question.key]
        : storedDraft(question);
}
function storeDraft(question, value) {
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
        const dialog = document.querySelector(selector);
        if (dialog.open)
            dialog.close();
    }
}
function setSubmitted(submission) {
    studentState.monitoring = false;
    focusGuard.cancelPendingLoss();
    fullscreenRecoveryGuard.cancelPendingRecovery();
    navigationGuard.release();
    clearInterval(studentState.countdownTimer);
    clearInterval(studentState.heartbeatTimer);
    clearTimeout(studentState.saveTimer);
    clearTimeout(studentState.submitUnlockTimer);
    clearTimeout(studentState.submitConfirmTimer);
    clearTimeout(studentState.finalSubmitConfirmTimer);
    clearTimeout(studentState.deadlineRecoveryTimer);
    closeOpenExamDialogs();
    document.querySelector("#questionCard").inert = false;
    studentState.terminationCollecting = false;
    studentState.deadlineSubmissionActive = false;
    if (!isAssignmentMode())
        for (const question of studentState.attempt?.questions ?? [])
            localStorage.removeItem(draftKey(studentState.attempt.id, question.key));
    document.querySelector("#questionCard").hidden = true;
    document.querySelector("#submittedCard").hidden = false;
    document.querySelector("#submitted-time").textContent = new Intl.DateTimeFormat(studentDateLocale(), { dateStyle: "medium", timeStyle: "medium" }).format(new Date(submission.submittedAt));
    document.querySelector("#submitted-type").textContent = submission.type === "timer"
        ? t("時間終了による自動提出", "到时自动提交", "Submitted automatically when time expired")
        : submission.type === "teacher"
            ? t("教師による一括回収", "教师统一收卷", "Collected by the teacher")
            : submission.type === "policy"
                ? t("規則による自動提出", "因考试规则自动提交", "Submitted automatically by exam policy")
                : t("手動提出", "学生提交", "Submitted by student");
    const assignmentResult = document.querySelector("#assignmentResult");
    assignmentResult.hidden = !isAssignmentMode();
    document.querySelector("#assignment-retry").hidden = !isAssignmentMode() || submission.attemptsRemaining < 1;
    if (isAssignmentMode()) {
        document.querySelector("#assignment-score").textContent = `${submission.score} / ${submission.maximumScore}`;
        document.querySelector("#assignment-correct-count").textContent = t(`${submission.correctCount} / ${submission.questionCount} 正解`, `答对 ${submission.correctCount} / ${submission.questionCount} 题`, `${submission.correctCount} / ${submission.questionCount} correct`);
        document.querySelector("#submittedBody").textContent = t("採点が完了しました。問題と回答は再表示できません。", "评分已完成，题目和答案不能再次打开。", "Grading is complete. Questions and answers cannot be reopened.");
        document.querySelector(".submittedNote").textContent = submission.attemptsRemaining > 0
            ? t("もう一度提出できます。2回目も同じ課題に最初から回答します。", "还可以提交一次；第2次将从空白答卷重新开始。", "You may submit once more, starting the same practice from the beginning.")
            : t("2回の提出が完了しました。", "两次提交均已完成。", "Both submissions are complete.");
    }
    else {
        document.querySelector("#submittedBody").textContent = t("提出後は問題や回答を再度見ることはできません。採点結果は先生から案内されます。", "提交后不能再次查看题目或答案，评分结果由教师另行通知。", "Questions and answers cannot be reopened after submission. Your teacher will provide the result.");
        document.querySelector(".submittedNote").textContent = t("この画面を閉じて、先生の指示を待ってください。", "请关闭此页面并等待教师指示。", "Close this page and wait for your teacher.");
    }
}
const violationCopy = {
    page_hidden: { ja: "試験ウィンドウから離れました。禁止操作として記録されました。", zh: "你离开了考试窗口，此操作已被记录为违规。", en: "You left the exam window. This prohibited action has been recorded." },
    copy_blocked: { ja: "コピー操作は禁止されています。", zh: "考试期间禁止复制。", en: "Copying exam content is prohibited." },
    paste_blocked: { ja: "貼り付け操作は禁止されています。", zh: "考试期间禁止粘贴。", en: "Pasting content into the exam is prohibited." },
};
function getViolationCopy(eventType, fullscreenGraceMs) {
    if (eventType !== "fullscreen_exit")
        return violationCopy[eventType];
    const graceSeconds = Math.max(1, (fullscreenGraceMs ?? getFullscreenRecoveryGraceMs(1)) / 1_000);
    return {
        ja: `${graceSeconds}秒以内に全画面へ戻らなかったため、警告として記録しました。`,
        zh: `未能在${graceSeconds}秒内恢复全屏，已记录一次警告。`,
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
function showFullscreenRecovery(deadlineAt, graceMs, interruptionCount) {
    const graceSeconds = graceMs / 1_000;
    const nextGraceSeconds = getFullscreenRecoveryGraceMs(interruptionCount + 1) / 1_000;
    clearTimeout(studentState.submitConfirmTimer);
    clearTimeout(studentState.finalSubmitConfirmTimer);
    studentState.submissionConfirmationToken = null;
    for (const selector of ["#submitDialog", "#finalSubmitDialog"]) {
        const openDialog = document.querySelector(selector);
        if (openDialog.open)
            openDialog.close();
    }
    const dialog = document.querySelector("#violationDialog");
    const questionCard = document.querySelector("#questionCard");
    questionCard.inert = true;
    setLocalizedPair(document.querySelector("#violation-message-ja"), document.querySelector("#violationMessageEn"), {
        ja: `全画面モードが解除されました。今回は${graceSeconds}秒以内に戻れば警告には記録されません。次回の復帰猶予は${nextGraceSeconds}秒です。`,
        zh: `已退出全屏。本次在${graceSeconds}秒内恢复不会记录警告；下次恢复时限为${nextGraceSeconds}秒。`,
        en: `Fullscreen interruption ${interruptionCount}: return within ${graceSeconds} seconds to avoid a warning. The next recovery grace period is ${nextGraceSeconds} seconds.`,
    });
    document.querySelector("#violation-occurred-at").textContent = t(`全画面解除 ${interruptionCount} 回目 · 現在は未記録`, `第 ${interruptionCount} 次退出全屏 · 尚未记录`, `Fullscreen interruption ${interruptionCount} · Not recorded yet`);
    const confirm = document.querySelector("#violation-confirm");
    confirm.textContent = t("全画面に戻る", "恢复全屏", "Return to fullscreen");
    confirm.disabled = false;
    if (!dialog.open)
        dialog.showModal();
    const countdown = document.querySelector("#violation-countdown");
    const renderCountdown = () => {
        const secondsRemaining = Math.max(0, Math.ceil((deadlineAt - browserMonotonicNow()) / 1_000));
        countdown.textContent = t(`警告記録まで ${secondsRemaining} 秒`, `${secondsRemaining} 秒后记录警告`, `${secondsRemaining} seconds before a warning is recorded`);
    };
    clearFullscreenRecoveryCountdown();
    renderCountdown();
    studentState.fullscreenRecoveryTimer = setInterval(renderCountdown, 250);
}
function dismissFullscreenRecovery() {
    clearFullscreenRecoveryCountdown();
    if (studentState.violationActive || studentState.policySuspended)
        return;
    const dialog = document.querySelector("#violationDialog");
    if (dialog.open)
        dialog.close();
    document.querySelector("#questionCard").inert = false;
}
function confirmFullscreenExit(signal, graceMs) {
    clearFullscreenRecoveryCountdown();
    const graceSeconds = graceMs / 1_000;
    document.querySelector("#violation-countdown").textContent = t(`${graceSeconds}秒の復帰猶予が終了しました。警告を記録しています…`, `${graceSeconds}秒恢复时限已结束，正在记录警告…`, `${graceSeconds}-second grace period ended. Recording warning…`);
    document.querySelector("#violation-confirm").disabled = true;
    void reportViolation(signal, { acknowledgementSeconds: 0, fullscreenGraceMs: graceMs });
}
function showPolicySuspension(suspension) {
    const alreadySuspended = studentState.policySuspended;
    studentState.policySuspended = true;
    studentState.monitoring = false;
    focusGuard.cancelPendingLoss();
    fullscreenRecoveryGuard.cancelPendingRecovery();
    clearFullscreenRecoveryCountdown();
    if (studentState.attempt)
        studentState.attempt.status = "policy_suspended";
    clearInterval(studentState.countdownTimer);
    clearTimeout(studentState.saveTimer);
    const dialog = document.querySelector("#violationDialog");
    setLocalizedPair(document.querySelector("#violation-message-ja"), document.querySelector("#violationMessageEn"), {
        ja: "禁止操作が3回記録されたため、答案を一時停止しました。答案と残り時間は保存されています。先生が再開を許可するまで待ってください。",
        zh: "已记录3次违规，考试现已暂停。答案和剩余时间已保存，请等待教师恢复考试。",
        en: "Three prohibited actions were recorded. Your answer sheet is paused, with answers and remaining time preserved. Wait for your teacher to reopen it.",
    });
    document.querySelector("#violation-countdown").textContent = t("先生の再開許可を待っています。", "正在等待教师批准恢复考试。", "Waiting for teacher approval.");
    const confirm = document.querySelector("#violation-confirm");
    confirm.textContent = t("再開許可を待っています", "等待教师批准", "Waiting for teacher");
    confirm.disabled = true;
    if (!dialog.open)
        dialog.showModal();
    document.querySelector("#attempt-deadline").textContent = t(`一時停止 · 残り ${Math.ceil((suspension?.remainingSeconds ?? 0) / 60)} 分`, `已暂停 · 剩余 ${Math.ceil((suspension?.remainingSeconds ?? 0) / 60)} 分钟`, `Paused · ${Math.ceil((suspension?.remainingSeconds ?? 0) / 60)} minutes left`);
    if (!alreadySuspended)
        startHeartbeat();
}
async function restorePolicySuspension(heartbeat) {
    if (!studentState.policySuspended)
        return;
    studentState.policySuspended = false;
    studentState.attempt.status = "in_progress";
    if (heartbeat.deadlineAt)
        studentState.attempt.deadlineAt = heartbeat.deadlineAt;
    studentState.monitoring = false;
    setLocalizedPair(document.querySelector("#violation-message-ja"), document.querySelector("#violationMessageEn"), {
        ja: "先生が再開を許可しました。全画面に戻ると、保存済み答案と残り時間から続けられます。",
        zh: "教师已批准恢复考试。返回全屏后可从已保存的答案和剩余时间继续。",
        en: "Your teacher reopened the exam. Return to fullscreen to continue with your saved answers and remaining time.",
    });
    document.querySelector("#violation-countdown").textContent = t("「試験に戻る」を押してください。", "请点击“返回考试”。", "Select “Return to exam”.");
    const confirm = document.querySelector("#violation-confirm");
    confirm.textContent = t("試験に戻る", "返回考试", "Return to exam");
    confirm.disabled = false;
    startCountdown();
    await saveAnswer();
}
async function reportViolation(integritySignal, { acknowledgementSeconds = VIOLATION_ACKNOWLEDGEMENT_SECONDS, fullscreenGraceMs = null } = {}) {
    if (!studentState.monitoring || !studentState.csrfToken || studentState.violationActive || Date.now() - studentState.lastViolationAt < 900)
        return;
    const eventType = integritySignal.sourceEventType;
    studentState.violationActive = true;
    studentState.lastViolationAt = Date.now();
    try {
        const result = await request("/api/student/proctor-events", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken }, body: JSON.stringify({ eventType }) });
        const dialog = document.querySelector("#violationDialog");
        const copy = getViolationCopy(eventType, fullscreenGraceMs);
        setLocalizedPair(document.querySelector("#violation-message-ja"), document.querySelector("#violationMessageEn"), copy);
        const occurredAt = new Date(result.occurredAt);
        document.querySelector("#violation-occurred-at").textContent = `${t("記録時刻", "记录时间", "Recorded at")} ${new Intl.DateTimeFormat(studentDateLocale(), { dateStyle: "medium", timeStyle: "medium" }).format(occurredAt)}`;
        if (result.suspension) {
            showPolicySuspension(result.suspension);
            return;
        }
        if (!dialog.open)
            dialog.showModal();
        const confirm = document.querySelector("#violation-confirm");
        const countdown = document.querySelector("#violation-countdown");
        const returnLabel = t("試験に戻る", "返回考试", "Return to exam");
        confirm.textContent = returnLabel;
        let secondsRemaining = acknowledgementSeconds;
        confirm.disabled = true;
        const enableReturn = () => {
            countdown.textContent = acknowledgementSeconds === 0
                ? t(`警告を記録しました。「${returnLabel}」を押してください。`, `警告已记录，请点击“${returnLabel}”。`, `Warning recorded. Select “${returnLabel}”.`)
                : t(`「${returnLabel}」を押してください。`, `请点击“${returnLabel}”。`, `Select “${returnLabel}”.`);
            confirm.disabled = false;
        };
        const renderCountdown = () => {
            countdown.textContent = t(`あと ${secondsRemaining} 秒待ってから「${returnLabel}」を押してください。`, `请等待 ${secondsRemaining} 秒后点击“${returnLabel}”。`, `Wait ${secondsRemaining} seconds, then select “${returnLabel}”.`);
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
    }
    catch {
        studentState.violationActive = false;
        document.querySelector("#submission-status").textContent = t("監考イベントを記録できません。先生に知らせてください。", "无法记录监考事件，请通知教师。", "The proctoring event could not be recorded. Tell your teacher.");
        if (eventType === "fullscreen_exit") {
            document.querySelector("#violation-countdown").textContent = t("警告を記録できませんでした。全画面へ戻り、先生に知らせてください。", "无法记录警告。请恢复全屏并通知教师。", "The warning could not be recorded. Return to fullscreen and tell your teacher.");
            document.querySelector("#violation-confirm").disabled = false;
        }
    }
}
function startHeartbeat() {
    clearInterval(studentState.heartbeatTimer);
    const send = async () => {
        if (!studentState.attempt || studentState.attempt.submission || !studentState.csrfToken)
            return;
        try {
            const heartbeat = await request("/api/student/heartbeat", { method: "POST", headers: { "x-csrf-token": studentState.csrfToken } });
            studentState.heartbeatFailures = 0;
            if (heartbeat.status === "termination_collecting") {
                studentState.terminationCollecting = true;
                studentState.monitoring = false;
                clearInterval(studentState.countdownTimer);
                document.querySelector("#submission-status").textContent = t("先生が答案を回収しています。最新の入力を保存しています。", "教师正在收卷，正在保存最新答案…", "The teacher is collecting answers. Saving your latest input…");
                await flushCurrentAnswer();
                document.querySelector("#questionCard").inert = true;
            }
            else if (heartbeat.status === "policy_suspended")
                showPolicySuspension(heartbeat);
            else if (heartbeat.status === "active")
                await restorePolicySuspension(heartbeat);
        }
        catch (error) {
            if (studentState.terminationCollecting && error.status === 409) {
                try {
                    const current = await request("/api/student/attempt");
                    if (current.attempt?.submission) {
                        studentState.attempt.submission = current.attempt.submission;
                        document.querySelector("#questionCard").inert = false;
                        setSubmitted(current.attempt.submission);
                        return;
                    }
                }
                catch { /* keep the collection screen while the final snapshot is committed */ }
            }
            studentState.heartbeatFailures += 1;
            if (studentState.heartbeatFailures >= 2)
                document.querySelector("#submission-status").textContent = t("通信が不安定です。入力内容はこの端末にも保存しています。", "网络连接不稳定，输入内容也已暂存在本设备。", "The connection is unstable. Your input is also stored on this device.");
        }
    };
    send();
    studentState.heartbeatTimer = setInterval(send, 5_000);
}
function saveAnswer() {
    if (isAssignmentMode())
        return Promise.resolve(true);
    if (studentState.savePromise)
        return studentState.savePromise;
    if (!studentState.attempt || studentState.attempt.submission || !studentState.csrfToken)
        return Promise.resolve(true);
    const question = currentQuestion();
    if (!question)
        return Promise.resolve(true);
    const status = document.querySelector("#save-status");
    const input = document.querySelector("#formula-answer");
    const manual = isManualQuestion(question);
    const answer = manual ? (draftValue(question) ?? answerValues()[question.key] ?? "") : input.value;
    const rawDraft = localStorage.getItem(draftKey(studentState.attempt.id, question.key));
    if (rawDraft === null && sameAnswer(answerValues()[question.key], answer))
        return Promise.resolve(true);
    status.textContent = t("保存中…", "正在保存…", "Saving…");
    studentState.savePromise = (async () => {
        try {
            const result = await request("/api/student/answer", {
                method: "PUT",
                headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken },
                body: JSON.stringify({ questionKey: question.key, ...(manual ? { answer } : { formula: answer }), expectedVersion: answerVersion(), clientSavedAt: new Date().toISOString() }),
            });
            studentState.attempt.answer = result.answer;
            studentState.attempt.answers ??= { values: {}, version: 0, savedAt: null };
            studentState.attempt.answers.values[question.key] = answer;
            studentState.attempt.answers.version = result.answer.version;
            studentState.attempt.answers.savedAt = result.answer.savedAt;
            const currentDraft = draftValue(question);
            if (sameAnswer(currentDraft, answer)) {
                localStorage.removeItem(draftKey(studentState.attempt.id, question.key));
                status.textContent = `${t("保存済み", "已保存", "Saved")} ${new Intl.DateTimeFormat(studentDateLocale(), { timeStyle: "medium" }).format(new Date(result.answer.savedAt))}`;
            }
            else {
                status.textContent = t("未保存", "未保存", "Not saved");
                studentState.saveTimer = setTimeout(saveAnswer, 700);
            }
            return true;
        }
        catch (error) {
            status.textContent = error.status === 409
                ? t("別の画面で更新されました。ページを再読み込みしてください。", "内容已在其他页面更新，请刷新本页面。", "This answer was updated elsewhere. Reload this page.")
                : t("保存できません。入力内容はこの端末に一時保存しました。", "暂时无法保存到服务器，输入内容已保存在本设备。", "The answer could not be saved to the server. Your input is stored on this device.");
            return false;
        }
        finally {
            studentState.savePromise = null;
        }
    })();
    return studentState.savePromise;
}
async function flushCurrentAnswer() {
    if (isAssignmentMode())
        return true;
    const question = currentQuestion();
    if (!question)
        return true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null)
            return true;
        if (!await saveAnswer())
            return false;
    }
    return localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null;
}
async function submitAttempt({ confirmationToken = null, allowUnsavedServerSnapshot = false } = {}) {
    if (!studentState.attempt || studentState.attempt.submission || !studentState.csrfToken)
        return;
    clearTimeout(studentState.saveTimer);
    if (!allowUnsavedServerSnapshot && !await flushCurrentAnswer()) {
        throw new Error("The latest answer could not be saved.");
    }
    const assignmentSubmission = isAssignmentMode();
    const result = assignmentSubmission
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
        const mismatch = new Error("Submission result does not belong to the current attempt.");
        mismatch.code = "SUBMISSION_ATTEMPT_MISMATCH";
        mismatch.status = 409;
        throw mismatch;
    }
    studentState.attempt.submission = result.submission;
    setSubmitted(result.submission);
}
function scheduleDeadlineSubmissionRecovery(delay = studentState.deadlineRecoveryDelay) {
    clearTimeout(studentState.deadlineRecoveryTimer);
    if (!studentState.deadlineSubmissionActive || studentState.attempt?.submission)
        return;
    const boundedDelay = Math.min(15_000, Math.max(4_000, delay));
    studentState.deadlineRecoveryDelay = boundedDelay;
    studentState.deadlineRecoveryTimer = setTimeout(async () => {
        if (!studentState.deadlineSubmissionActive || studentState.attempt?.submission)
            return;
        try {
            const current = await request("/api/student/attempt");
            if (current.attempt?.submission) {
                studentState.attempt.submission = current.attempt.submission;
                setSubmitted(current.attempt.submission);
                return;
            }
            await submitAttempt({ allowUnsavedServerSnapshot: true });
        }
        catch {
            document.querySelector("#submission-status").textContent = t("自動提出の確認を続けています。画面を閉じないでください。", "仍在确认自动提交，请勿关闭此页面。", "Still confirming automatic submission. Keep this page open.");
        }
        if (!studentState.attempt?.submission)
            scheduleDeadlineSubmissionRecovery(Math.ceil(boundedDelay * 1.6));
    }, boundedDelay + Math.floor(Math.random() * 1_000));
}
async function submitAtDeadline() {
    if (studentState.deadlineSubmissionActive)
        return;
    studentState.deadlineSubmissionActive = true;
    closeOpenExamDialogs();
    document.querySelector("#questionCard").inert = true;
    document.querySelector("#submission-status").textContent = t("制限時間が終了しました。答案を自動提出しています…", "考试时间已结束，正在自动提交答卷…", "Time is up. Submitting your answers automatically…");
    try {
        await submitDeadlineWithRetry({
            prepareBestEffort: flushCurrentAnswer,
            submit: () => submitAttempt({ allowUnsavedServerSnapshot: true }),
        });
    }
    catch {
        document.querySelector("#submission-status").textContent = t("自動提出をまだ確認できません。再接続後も自動確認を続けます。画面を閉じず、先生に知らせてください。", "暂时无法确认自动提交。系统会在重新连接后继续检查，请勿关闭页面并通知教师。", "Automatic submission is not confirmed yet. This page will keep checking after reconnection. Keep it open and tell your teacher.");
        scheduleDeadlineSubmissionRecovery();
    }
}
function startCountdown() {
    clearInterval(studentState.countdownTimer);
    if (!studentState.experience?.hasTimeLimit || !studentState.attempt?.deadlineAt)
        return;
    const update = () => {
        const remaining = Math.max(0, new Date(studentState.attempt.deadlineAt).getTime() - Date.now());
        const seconds = Math.ceil(remaining / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const rest = seconds % 60;
        document.querySelector("#attempt-deadline").textContent = `${t("残り", "剩余", "Remaining")} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
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
function renderQuestion(index) {
    studentState.currentIndex = Math.max(0, Math.min(index, studentState.attempt.questions.length - 1));
    const question = currentQuestion();
    studentState.selectionStart = null;
    studentState.selectionEnd = null;
    document.querySelector("#question-position").textContent = `${studentState.currentIndex + 1} / ${studentState.attempt.questions.length}`;
    const displayLocale = studentDisplayLocale();
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
        const image = document.querySelector("#manualPromptImage");
        image.hidden = !question.image?.dataUrl;
        image.src = question.image?.dataUrl ?? "";
        image.alt = question.image?.alt ?? "";
        document.querySelector("#previous-button").disabled = studentState.currentIndex === 0;
        document.querySelector("#next-button").disabled = studentState.currentIndex === studentState.attempt.questions.length - 1;
        const savedValue = draftValue(question) ?? answerValues()[question.key] ?? (question.questionMode === "multiple_choice" ? [] : question.questionMode === "fill_blank" ? {} : "");
        renderManualResponse(question, savedValue);
        document.querySelector(".questionMain").classList.toggle("hasAnswer", hasAnswer(savedValue));
        document.querySelector("#save-status").textContent = localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null
            ? t("保存済み", "已保存", "Saved")
            : t("未保存", "未保存", "Not saved");
        document.querySelector("#undo-button").disabled = true;
        document.querySelector("#redo-button").disabled = true;
        hideFormulaSuggestions();
        document.querySelector("#formulaFunctionHelp").hidden = true;
        renderQuestionIndex();
        return;
    }
    document.querySelector("#manual-workbench").hidden = true;
    document.querySelector("#excel-quick-guide").hidden = false;
    document.querySelector("#manual-quick-guide").hidden = true;
    document.querySelector("#manualPromptImage").hidden = true;
    const showJapanesePrompt = displayLocale === "ja" || displayLocale === "legacy_bilingual";
    const showEnglishPrompt = displayLocale === "en" || displayLocale === "zh" || displayLocale === "legacy_bilingual";
    renderJapaneseWithReadings(document.querySelector("#question-prompt"), showJapanesePrompt ? question.promptJa : "");
    document.querySelector("#question-prompt").hidden = !showJapanesePrompt;
    document.querySelector("#questionPromptEn").textContent = showEnglishPrompt ? question.promptEn ?? "" : "";
    document.querySelector("#questionPromptEn").hidden = !showEnglishPrompt;
    document.querySelector("#answer-cell").textContent = question.answerCell ?? "—";
    document.querySelector("#previous-button").disabled = studentState.currentIndex === 0;
    document.querySelector("#next-button").disabled = studentState.currentIndex === studentState.attempt.questions.length - 1;
    const isChoice = question.questionMode === "choice" || question.kind === "choice";
    const functionCountBadge = document.querySelector("#functionCountBadge");
    functionCountBadge.hidden = isChoice || !question.compositionLabelJa;
    functionCountBadge.textContent = functionCountBadge.hidden
        ? ""
        : displayLocale === "en" || displayLocale === "zh"
            ? question.compositionLabelEn ?? "Multi-function question"
            : displayLocale === "legacy_bilingual"
                ? `${question.compositionLabelJa} / ${question.compositionLabelEn ?? "Multi-function question"}`
                : question.compositionLabelJa;
    const tip = document.querySelector("#question-tip");
    tip.hidden = isChoice || !question.tipJa || (displayLocale !== "ja" && displayLocale !== "legacy_bilingual");
    if (!tip.hidden)
        renderJapaneseWithReadings(tip, question.tipJa);
    else
        tip.replaceChildren();
    document.querySelector("#formula-workbench").hidden = isChoice;
    document.querySelector("#choiceWorkbench").hidden = !isChoice;
    const savedValue = draftValue(question) ?? answerValues()[question.key] ?? "";
    const input = document.querySelector("#formula-answer");
    input.placeholder = "=FUNCTION(...)";
    studentState.suppressHistory = true;
    input.value = savedValue;
    studentState.suppressHistory = false;
    document.querySelector(".questionMain").classList.toggle("hasAnswer", Boolean(savedValue.trim()));
    document.querySelector("#save-status").textContent = isAssignmentMode()
        ? t("このページ内のみ保持", "仅在本页面内保留", "Kept only on this page")
        : localStorage.getItem(draftKey(studentState.attempt.id, question.key)) === null ? t("保存済み", "已保存", "Saved") : t("未保存", "未保存", "Not saved");
    if (!studentState.histories.has(question.key))
        studentState.histories.set(question.key, { undo: [], redo: [], last: savedValue });
    updateHistoryControls();
    if (isChoice) {
        const options = document.querySelector("#choice-options");
        const optionNodes = question.options.map((value) => {
            const label = document.createElement("label");
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "choice-answer";
            radio.value = value;
            radio.checked = savedValue === value;
            radio.addEventListener("change", () => setCurrentAnswer(value));
            label.append(radio, document.createTextNode(value));
            return label;
        });
        options.replaceChildren(...optionNodes);
    }
    else
        renderSheet(question);
    if (isChoice) {
        hideFormulaSuggestions();
        document.querySelector("#formulaFunctionHelp").hidden = true;
    }
    else
        void renderFormulaAssistant();
    renderQuestionIndex();
}
function renderManualResponse(question, savedValue) {
    const choiceSection = document.querySelector("#manualChoiceResponse");
    const fillSection = document.querySelector("#manualFillResponse");
    const shortSection = document.querySelector("#manualShortResponse");
    choiceSection.hidden = true;
    fillSection.hidden = true;
    shortSection.hidden = true;
    if (question.questionMode === "single_choice" || question.questionMode === "multiple_choice") {
        choiceSection.hidden = false;
        const multiple = question.questionMode === "multiple_choice";
        const selected = new Set(multiple && Array.isArray(savedValue) ? savedValue : typeof savedValue === "string" && savedValue ? [savedValue] : []);
        const options = document.querySelector("#manual-choice-options");
        const optionNodes = (question.options ?? []).map((option) => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = multiple ? "checkbox" : "radio";
            input.name = `manual-${question.key}`;
            input.value = option.id;
            input.checked = selected.has(option.id);
            input.addEventListener("change", () => {
                if (multiple) {
                    if (input.checked)
                        selected.add(option.id);
                    else
                        selected.delete(option.id);
                    setManualAnswer([...selected]);
                }
                else
                    setManualAnswer(option.id);
            });
            const content = document.createElement("div");
            renderSafeMarkdown(content, option.markdown);
            label.append(input, content);
            return label;
        });
        options.replaceChildren(...optionNodes);
        return;
    }
    if (question.questionMode === "fill_blank") {
        fillSection.hidden = false;
        const values = savedValue && typeof savedValue === "object" && !Array.isArray(savedValue) ? { ...savedValue } : {};
        const segments = [];
        for (const segment of question.segments ?? []) {
            if (segment.kind === "text") {
                const content = document.createElement("span");
                renderSafeMarkdown(content, segment.markdown);
                segments.push(content);
                continue;
            }
            const input = document.createElement("input");
            input.type = "text";
            input.maxLength = 500;
            input.value = values[segment.id] ?? "";
            input.autocomplete = "off";
            input.setAttribute("aria-label", `${t("空欄", "填空", "Blank")} ${segment.id}`);
            input.addEventListener("input", () => { values[segment.id] = input.value; setManualAnswer(values); });
            segments.push(input);
        }
        fillSection.replaceChildren(...segments);
        return;
    }
    shortSection.hidden = false;
    const textarea = document.querySelector("#manual-short-answer");
    textarea.value = typeof savedValue === "string" ? savedValue : "";
    renderSafeMarkdown(document.querySelector("#manual-short-preview"), textarea.value);
}
function scheduleMarkdownPreview(markdown) {
    pendingMarkdownPreview = markdown;
    if (markdownPreviewFrame !== null)
        return;
    markdownPreviewFrame = scheduleFrame(() => {
        markdownPreviewFrame = null;
        renderSafeMarkdown(document.querySelector("#manual-short-preview"), pendingMarkdownPreview);
    });
}
function renderSheet(question) {
    document.querySelector("#identity-card").hidden = true;
    const table = document.querySelector("#question-table");
    const letters = document.createElement("tr");
    letters.append(createElement("th", "cornerCell", ""));
    question.table.columns.forEach((_, columnIndex) => {
        const header = createElement("th", "columnLetter", columnLetter(columnIndex));
        header.dataset.column = String(columnIndex);
        header.addEventListener("mousedown", (event) => { event.preventDefault(); studentState.selectionStart = { row: 0, column: columnIndex }; studentState.selectionEnd = { row: question.table.rows.length - 1, column: columnIndex }; paintSelection(); insertSelectedRange(); });
        letters.append(header);
    });
    const head = document.createElement("tr");
    head.append(createElement("th", "rowNumber", "1"));
    for (const column of question.table.columns)
        head.append(createElement("th", "fieldHeader", column));
    const body = question.table.rows.map((row, index) => {
        const tableRow = document.createElement("tr");
        const rowHeader = createElement("th", "rowNumber", String(index + 2));
        rowHeader.dataset.row = String(index);
        tableRow.append(rowHeader);
        question.table.columns.forEach((column, columnIndex) => {
            const cell = createElement("td", "dataCell", String(row[column] ?? ""));
            cell.dataset.row = String(index);
            cell.dataset.column = String(columnIndex);
            cell.dataset.ref = `${columnLetter(columnIndex)}${index + 2}`;
            cell.addEventListener("mousedown", (event) => { event.preventDefault(); studentState.selecting = true; studentState.selectionStart = { row: index, column: columnIndex }; studentState.selectionEnd = { row: index, column: columnIndex }; paintSelection(); });
            cell.addEventListener("mouseenter", () => { if (studentState.selecting) {
                studentState.selectionEnd = { row: index, column: columnIndex };
                scheduleSelectionPaint();
            } });
            tableRow.append(cell);
        });
        return tableRow;
    });
    table.replaceChildren(letters, head, ...body);
}
function renderQuestionIndex() {
    const container = document.querySelector("#questionIndex");
    const questions = studentState.attempt.questions;
    let buttons = [...container.querySelectorAll("button")];
    if (buttons.length !== questions.length) {
        buttons = questions.map((_, index) => {
            const button = createElement("button", "", String(index + 1));
            button.type = "button";
            button.addEventListener("click", () => navigateToQuestion(index));
            return button;
        });
        container.replaceChildren(...buttons);
    }
    const values = answerValues();
    let answered = 0;
    questions.forEach((question, index) => {
        const hasCurrentAnswer = hasAnswer(draftValue(question) ?? values[question.key]);
        if (hasCurrentAnswer)
            answered += 1;
        buttons[index].classList.toggle("isCurrent", index === studentState.currentIndex);
        buttons[index].classList.toggle("isAnswered", hasCurrentAnswer);
    });
    document.querySelector("#answered-count").textContent = t(`${answered} / ${questions.length} 回答済み`, `已作答 ${answered} / ${questions.length}`, `${answered} / ${questions.length} answered`);
}
function scheduleQuestionIndexRender() {
    if (questionIndexFrame !== null)
        return;
    questionIndexFrame = scheduleFrame(() => {
        questionIndexFrame = null;
        if (studentState.attempt)
            renderQuestionIndex();
    });
}
async function navigateToQuestion(index) {
    if (index === studentState.currentIndex)
        return;
    clearTimeout(studentState.saveTimer);
    await flushCurrentAnswer();
    renderQuestion(index);
}
function setCurrentAnswer(value, { record = true } = {}) {
    const question = currentQuestion();
    if (!question)
        return;
    const input = document.querySelector("#formula-answer");
    const history = studentState.histories.get(question.key) ?? { undo: [], redo: [], last: "" };
    if (record && value !== history.last) {
        history.undo.push(history.last);
        if (history.undo.length > 100)
            history.undo.shift();
        history.redo = [];
    }
    history.last = value;
    studentState.histories.set(question.key, history);
    studentState.suppressHistory = true;
    input.value = value;
    studentState.suppressHistory = false;
    for (const radio of document.querySelectorAll('input[name="choice-answer"]'))
        radio.checked = radio.value === value;
    if (isAssignmentMode())
        studentState.practiceAnswers[question.key] = value;
    else
        localStorage.setItem(draftKey(studentState.attempt.id, question.key), value);
    document.querySelector(".questionMain").classList.toggle("hasAnswer", Boolean(value.trim()));
    document.querySelector("#save-status").textContent = isAssignmentMode()
        ? t("このページ内のみ保持", "仅在本页面内保留", "Kept only on this page")
        : t("未保存", "未保存", "Not saved");
    clearTimeout(studentState.saveTimer);
    if (!isAssignmentMode())
        studentState.saveTimer = setTimeout(saveAnswer, 700);
    updateHistoryControls();
    scheduleQuestionIndexRender();
    if (question.questionMode !== "choice" && question.kind !== "choice")
        scheduleFormulaAssistantRender();
}
function setManualAnswer(value) {
    const question = currentQuestion();
    if (!question || !isManualQuestion(question))
        return;
    storeDraft(question, value);
    document.querySelector(".questionMain").classList.toggle("hasAnswer", hasAnswer(value));
    document.querySelector("#save-status").textContent = t("未保存", "未保存", "Not saved");
    clearTimeout(studentState.saveTimer);
    studentState.saveTimer = setTimeout(saveAnswer, 700);
    scheduleQuestionIndexRender();
}
function updateHistoryControls() {
    const history = studentState.histories.get(currentQuestion()?.key);
    document.querySelector("#undo-button").disabled = !history?.undo.length;
    document.querySelector("#redo-button").disabled = !history?.redo.length;
}
function changeHistory(direction) {
    const question = currentQuestion();
    if (!question)
        return;
    const history = studentState.histories.get(question.key);
    if (!history)
        return;
    const source = direction === "undo" ? history.undo : history.redo;
    const destination = direction === "undo" ? history.redo : history.undo;
    if (!source.length)
        return;
    destination.push(history.last);
    const value = source.pop();
    history.last = value;
    setCurrentAnswer(value, { record: false });
}
function renderAttempt(attempt) {
    const attemptId = String(attempt?.id ?? "");
    // 同一答案では復帰猶予の使用回数を維持し、新しい答案だけ10秒から再開する。
    if (!attemptId || studentState.fullscreenRecoveryAttemptId !== attemptId) {
        fullscreenRecoveryGuard.resetRecoveryHistory();
        studentState.fullscreenRecoveryAttemptId = attemptId || null;
    }
    else {
        fullscreenRecoveryGuard.cancelPendingRecovery();
    }
    studentState.attempt = attempt;
    applyStudentExperience(attempt);
    focusGuard.cancelPendingLoss();
    clearFullscreenRecoveryCountdown();
    studentState.practiceAnswers = {};
    studentState.histories.clear();
    document.querySelector("#identity-card").hidden = true;
    document.querySelector("#waiting-card").hidden = true;
    document.querySelector("#assignmentIntroCard").hidden = true;
    document.querySelector("#preflight-card").hidden = true;
    if (attempt.submission) {
        setSubmitted(attempt.submission);
        return;
    }
    document.querySelector("#submittedCard").hidden = true;
    document.querySelector("#questionCard").hidden = false;
    document.querySelector("#questionCard").inert = false;
    const submitDialog = document.querySelector("#submitDialog");
    if (submitDialog.open)
        submitDialog.close();
    const finalSubmitDialog = document.querySelector("#finalSubmitDialog");
    if (finalSubmitDialog.open)
        finalSubmitDialog.close();
    studentState.submissionConfirmationToken = null;
    studentState.deadlineSubmissionActive = false;
    studentState.deadlineFinalSyncRequested = false;
    studentState.deadlineRecoveryDelay = 4_000;
    clearTimeout(studentState.deadlineRecoveryTimer);
    const submitButton = document.querySelector("#submit-button");
    clearTimeout(studentState.submitUnlockTimer);
    studentState.manualSubmissionUnlockedAt = isAssignmentMode()
        ? 0
        : Date.now() + MANUAL_SUBMISSION_GUARD_MILLISECONDS;
    submitButton.disabled = !isAssignmentMode();
    submitButton.textContent = isAssignmentMode()
        ? t("答案を提出する", "提交答卷", "Submit answers")
        : t("問題を確認してください", "请先检查题目", "Review the questions");
    if (!isAssignmentMode()) {
        studentState.submitUnlockTimer = setTimeout(() => {
            if (studentState.attempt !== attempt || attempt.submission)
                return;
            submitButton.disabled = false;
            submitButton.textContent = t("答案を提出する", "提交答卷", "Submit answers");
        }, MANUAL_SUBMISSION_GUARD_MILLISECONDS);
    }
    document.querySelector("#attempt-student-name").textContent = displayName(attempt.student.name);
    document.querySelector("#attempt-student-number").textContent = attempt.student.studentNumber;
    studentState.monitoring = studentState.experience.proctoringEnabled;
    navigationGuard.arm();
    renderQuestion(0);
    if (studentState.experience.hasTimeLimit)
        startCountdown();
    if (studentState.experience.proctoringEnabled)
        startHeartbeat();
}
document.querySelector("#fullscreen-button").addEventListener("click", async (event) => {
    if (!isFullscreenAvailable(document, document.documentElement) || !studentState.csrfToken)
        return;
    const button = event.currentTarget;
    if (button.disabled)
        return;
    button.disabled = true;
    try {
        await requestFullscreen(document.documentElement);
        updateFullscreenState();
        if (!getFullscreenElement(document))
            return;
        const result = await request("/api/student/start", {
            method: "POST",
            headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken },
            body: JSON.stringify({ browserPreflight: browserPreflight() }),
        });
        renderAttempt(result.attempt);
    }
    catch (error) {
        updateFullscreenState();
        const startMessages = {
            DUPLICATE_SESSION: t("以前の接続がまだ有効です。約1分待ってから、もう一度開始してください。", "之前的连接仍然有效，请等待约1分钟后重试。", "The previous connection is still active. Wait about one minute and try again."),
            NOT_ADMITTED: t("教師の入室許可をもう一度確認してください。", "请让教师重新确认入场许可。", "Ask your teacher to confirm admission again."),
            RESUME_NOT_AUTHORIZED: t("続きから再開するには教師の許可が必要です。", "继续考试需要教师批准。", "Teacher authorization is required to resume."),
            ATTEMPT_LOCKED: t("この答案はすでに終了しているため開始できません。", "该答卷已结束，无法再次开始。", "This attempt is already closed and cannot be started."),
            ROOM_COLLECTION_ACTIVE: t("先生が答案を回収しています。この試験には入場できません。", "教师正在收卷，无法进入本场考试。", "The teacher is collecting answers. You cannot enter this exam."),
            EXAM_CLOSED: t("この試験は終了しました。再入場や回答の再開はできません。", "本场考试已结束，无法重新进入或继续作答。", "This exam has ended. You cannot re-enter or resume answering."),
            PAPER_NOT_PREPARED: t("この学生の試験問題を準備できていません。先生に知らせてください。", "该学生的试卷尚未准备，请通知教师。", "This student's paper is not ready. Ask your teacher."),
        };
        document.querySelector("#fullscreen-state").textContent = startMessages[error.code]
            ?? t("試験を開始できませんでした。先生に知らせてください。", "无法开始考试，请通知教师。", "The exam could not be started. Ask your teacher.");
    }
    finally {
        button.disabled = false;
    }
});
observeFullscreenChanges(document, () => {
    updateFullscreenState();
    fullscreenRecoveryGuard.handleFullscreenChange();
});
document.querySelector("#assignment-start").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    document.querySelector("#assignment-start-status").textContent = t("開始しています…", "正在开始…", "Starting…");
    try {
        const result = await request("/api/student/start", {
            method: "POST",
            headers: { "content-type": "application/json", "x-csrf-token": studentState.csrfToken },
            body: "{}",
        });
        renderAttempt(result.attempt);
    }
    catch (error) {
        document.querySelector("#assignment-start-status").textContent = error.code === "ATTEMPT_LOCKED"
            ? t("提出回数の上限に達しています。", "已达到提交次数上限。", "You have used both submissions.")
            : t("課題を開始できませんでした。先生に知らせてください。", "无法开始练习，请通知教师。", "The practice could not be started. Ask your teacher.");
    }
    finally {
        button.disabled = false;
    }
});
const identityForm = document.querySelector("#identityForm");
const identityMessage = document.querySelector("#identity-message");
identityForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (document.documentElement.dataset["studentEntryReact"] === "ready")
        return;
    identityMessage.textContent = "画面を読み込めませんでした。再読み込みしてください。";
});
document.addEventListener(STUDENT_ENTRY_VERIFIED_EVENT, (event) => {
    const detail = event.detail;
    if (!detail?.identity || !detail.result)
        return;
    studentState.pendingIdentity = detail.identity;
    studentState.csrfToken = detail.result.csrfToken;
    applyStudentExperience(detail.result);
    if (terminalEntryStatuses.has(detail.result.status))
        showTerminalEntry(detail.result);
    else if (isAssignmentMode())
        showAssignmentIntro(detail.result);
    else
        showRulesWaiting(detail.result);
});
document.querySelector("#rules-continue").addEventListener("click", () => {
    document.querySelector("#waiting-card").hidden = true;
    document.querySelector("#preflight-card").hidden = false;
    runPreflight();
});
runPreflight();
document.querySelector("#terminal-back").addEventListener("click", () => {
    stopAdmissionPolling();
    studentState.studentLocale = "legacy_bilingual";
    applyStudentShellLocale(document, "legacy_bilingual");
    document.querySelector("#terminalEntryCard").hidden = true;
    document.dispatchEvent(new Event(STUDENT_ENTRY_SHOW_EVENT));
});
document.querySelector("#terminal-recheck").addEventListener("click", async (event) => {
    if (!studentState.pendingIdentity)
        return;
    const button = event.currentTarget;
    button.disabled = true;
    document.querySelector("#terminal-status").textContent = t("確認中…", "正在检查…", "Checking eligibility…");
    try {
        const result = await request("/api/student/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(studentState.pendingIdentity) });
        studentState.csrfToken = result.csrfToken;
        applyStudentExperience(result);
        if (terminalEntryStatuses.has(result.status))
            showTerminalEntry(result);
        else if (isAssignmentMode())
            showAssignmentIntro(result);
        else
            showRulesWaiting(result);
    }
    catch {
        document.querySelector("#terminal-status").textContent = t("確認できませんでした。先生に知らせてください。", "检查失败，请通知教师。", "Check failed. Ask your teacher.");
    }
    finally {
        button.disabled = false;
    }
});
document.querySelector("#formula-answer").addEventListener("input", (event) => {
    if (!studentState.attempt || studentState.suppressHistory)
        return;
    setCurrentAnswer(event.target.value);
});
document.querySelector("#formula-answer").addEventListener("keydown", (event) => {
    const suggestions = studentState.formulaCompletion?.items ?? [];
    if (!suggestions.length)
        return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        studentState.formulaSuggestionIndex = (studentState.formulaSuggestionIndex + direction + suggestions.length) % suggestions.length;
        void renderFormulaAssistant({ preserveIndex: true });
    }
    else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        acceptFormulaSuggestion();
    }
    else if (event.key === "Escape") {
        event.preventDefault();
        hideFormulaSuggestions();
    }
});
document.querySelector("#formula-answer").addEventListener("click", () => scheduleFormulaAssistantRender());
document.querySelector("#formula-answer").addEventListener("focus", () => scheduleFormulaAssistantRender());
document.querySelector("#formula-answer").addEventListener("blur", () => setTimeout(hideFormulaSuggestions, 120));
document.querySelector("#manual-short-answer").addEventListener("input", (event) => {
    if (!studentState.attempt || currentQuestion()?.questionMode !== "short_answer")
        return;
    setManualAnswer(event.target.value);
    scheduleMarkdownPreview(event.target.value);
});
document.querySelector("#submit-button").addEventListener("click", () => {
    if (!isAssignmentMode() && Date.now() < studentState.manualSubmissionUnlockedAt) {
        document.querySelector("#submission-status").textContent = t("試験問題を確認してから提出してください。", "请先检查试题再提交。", "Review the questions before submitting.");
        return;
    }
    const values = answerValues();
    const unanswered = studentState.attempt.questions.filter((question) => !hasAnswer(draftValue(question) ?? values[question.key])).length;
    document.querySelector("#submit-summary").textContent = unanswered
        ? t(`未回答の問題が ${unanswered} 問あります。`, `还有 ${unanswered} 道题未作答。`, `${unanswered} questions are unanswered.`)
        : t("すべての問題に回答しています。", "所有题目均已作答。", "Every question has an answer.");
    document.querySelector("#submit-lock-copy").textContent = isAssignmentMode()
        ? t("提出後は今回の答案を再表示できません。残り回数がある場合も空白から始まります。", "提交后不能再次打开本次答卷；如仍有提交次数，下次将从空白答卷开始。", "After submission, this answer sheet cannot be reopened. Any remaining submission starts blank.")
        : t("提出後はこの答案を再閲覧・再回答できません。再受験には毎回教師の許可が必要です。", "提交后不能再次查看或修改本答卷；再次考试需要教师批准。", "After confirmation, this answer sheet is locked. A teacher must approve every new attempt.");
    const submitError = document.querySelector("#submitError");
    submitError.hidden = true;
    submitError.textContent = "";
    const confirmButton = document.querySelector("#submit-confirm");
    clearTimeout(studentState.submitConfirmTimer);
    studentState.submitDialogReadyAt = Date.now() + SUBMISSION_DIALOG_CONFIRMATION_MILLISECONDS;
    confirmButton.disabled = true;
    confirmButton.textContent = t("内容を確認してください", "请确认内容", "Review first");
    document.querySelector("#submitDialog").showModal();
    studentState.submitConfirmTimer = setTimeout(() => {
        if (!document.querySelector("#submitDialog").open)
            return;
        confirmButton.disabled = false;
        confirmButton.textContent = isAssignmentMode()
            ? t("確認して提出", "确认提交", "Confirm submission")
            : t("最終確認へ進む", "继续最终确认", "Continue");
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
document.querySelector("#submitDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    clearTimeout(studentState.submitConfirmTimer);
    document.querySelector("#submitDialog").close();
});
document.querySelector("#submit-confirm").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (Date.now() < studentState.submitDialogReadyAt)
        return;
    const submitError = document.querySelector("#submitError");
    button.disabled = true;
    button.textContent = isAssignmentMode() ? t("送信中…", "正在提交…", "Submitting…") : t("最終確認を準備中…", "正在准备最终确认…", "Preparing final confirmation…");
    submitError.hidden = true;
    try {
        if (isAssignmentMode()) {
            await submitAttempt();
            document.querySelector("#submitDialog").close();
            return;
        }
        const confirmation = await request("/api/student/submission-confirmation", {
            method: "POST",
            headers: { "x-csrf-token": studentState.csrfToken },
        });
        if (studentState.deadlineSubmissionActive || studentState.attempt?.submission)
            return;
        studentState.submissionConfirmationToken = confirmation.confirmationToken;
        document.querySelector("#submitDialog").close();
        document.querySelector("#final-submit-student-number").textContent = studentState.attempt.student.studentNumber;
        const finalError = document.querySelector("#final-submit-error");
        finalError.hidden = true;
        finalError.textContent = "";
        const finalButton = document.querySelector("#final-submit-confirm");
        clearTimeout(studentState.finalSubmitConfirmTimer);
        studentState.finalSubmitDialogReadyAt = Date.now() + FINAL_SUBMISSION_CONFIRMATION_MILLISECONDS;
        finalButton.disabled = true;
        finalButton.textContent = t("内容を確認してください", "请确认内容", "Review first");
        document.querySelector("#finalSubmitDialog").showModal();
        studentState.finalSubmitConfirmTimer = setTimeout(() => {
            if (!document.querySelector("#finalSubmitDialog").open)
                return;
            finalButton.disabled = false;
            finalButton.textContent = t("最終確定して提出", "最终确认并提交", "Confirm and submit");
        }, FINAL_SUBMISSION_CONFIRMATION_MILLISECONDS);
    }
    catch (error) {
        const copy = describeSubmissionFailure(error, studentDisplayLocale());
        submitError.textContent = copy.dialog;
        submitError.hidden = false;
        document.querySelector("#submission-status").textContent = copy.status;
    }
    finally {
        button.textContent = isAssignmentMode()
            ? t("確認して提出", "确认提交", "Confirm submission")
            : t("最終確認へ進む", "继续最终确认", "Continue");
        button.disabled = false;
    }
});
document.querySelector("#final-submit-cancel").addEventListener("click", () => {
    clearTimeout(studentState.finalSubmitConfirmTimer);
    studentState.submissionConfirmationToken = null;
    document.querySelector("#finalSubmitDialog").close();
});
document.querySelector("#finalSubmitDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    clearTimeout(studentState.finalSubmitConfirmTimer);
    studentState.submissionConfirmationToken = null;
    document.querySelector("#finalSubmitDialog").close();
});
document.querySelector("#final-submit-confirm").addEventListener("click", async (event) => {
    if (studentState.deadlineSubmissionActive
        || Date.now() < studentState.finalSubmitDialogReadyAt
        || !studentState.submissionConfirmationToken)
        return;
    const button = event.currentTarget;
    const submitError = document.querySelector("#final-submit-error");
    button.disabled = true;
    button.textContent = t("送信中…", "正在提交…", "Submitting…");
    submitError.hidden = true;
    try {
        await submitAttempt({ confirmationToken: studentState.submissionConfirmationToken });
        studentState.submissionConfirmationToken = null;
        document.querySelector("#finalSubmitDialog").close();
    }
    catch (error) {
        const copy = describeSubmissionFailure(error, studentDisplayLocale());
        submitError.textContent = copy.dialog;
        submitError.hidden = false;
        document.querySelector("#submission-status").textContent = copy.status;
    }
    finally {
        button.textContent = t("最終確定して提出", "最终确认并提交", "Confirm and submit");
        button.disabled = false;
    }
});
document.querySelector("#assignment-retry").addEventListener("click", async (event) => {
    if (!studentState.pendingIdentity)
        return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const result = await request("/api/student/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(studentState.pendingIdentity),
        });
        studentState.csrfToken = result.csrfToken;
        if (terminalEntryStatuses.has(result.status))
            showTerminalEntry(result);
        else
            showAssignmentIntro(result);
    }
    catch {
        document.querySelector(".submittedNote").textContent = t("2回目を開始できませんでした。先生に知らせてください。", "无法开始第2次作答，请通知教师。", "The second submission could not be started. Ask your teacher.");
    }
    finally {
        button.disabled = false;
    }
});
document.addEventListener("keydown", (event) => {
    if (!studentState.attempt || document.querySelector("#questionCard").hidden || !(event.ctrlKey || event.metaKey))
        return;
    const key = event.key.toLowerCase();
    if (key === "z") {
        event.preventDefault();
        changeHistory(event.shiftKey ? "redo" : "undo");
    }
    if (key === "y") {
        event.preventDefault();
        changeHistory("redo");
    }
});
document.addEventListener("mouseup", () => { if (studentState.selecting) {
    studentState.selecting = false;
    insertSelectedRange();
} });
document.addEventListener("copy", (event) => { if (studentState.monitoring) {
    event.preventDefault();
    reportViolation(createBrowserIntegritySignal("copy_blocked"));
} });
document.addEventListener("paste", (event) => { if (studentState.monitoring) {
    event.preventDefault();
    reportViolation(createBrowserIntegritySignal("paste_blocked"));
} });
window.addEventListener("beforeunload", (event) => { if (studentState.monitoring) {
    event.preventDefault();
    event.returnValue = "";
} });
document.querySelector("#violation-confirm").addEventListener("click", async () => {
    const dialog = document.querySelector("#violationDialog");
    if (studentState.policySuspended)
        return;
    if (studentState.attempt?.submission) {
        dialog.close();
        studentState.violationActive = false;
        return;
    }
    try {
        await requestFullscreen(document.documentElement);
        if (getFullscreenElement(document)) {
            fullscreenRecoveryGuard.handleFullscreenChange();
            if (dialog.open)
                dialog.close();
            document.querySelector("#questionCard").inert = false;
            studentState.violationActive = false;
            studentState.monitoring = studentState.experience.proctoringEnabled;
        }
    }
    catch {
        setLocalizedPair(document.querySelector("#violation-message-ja"), document.querySelector("#violationMessageEn"), {
            ja: "全画面に戻れませんでした。先生に知らせてください。",
            zh: "无法恢复全屏，请通知教师。",
            en: "Fullscreen could not be restored. Ask your teacher for help.",
        });
    }
});
document.querySelector("#violationDialog").addEventListener("cancel", (event) => event.preventDefault());
// 所有旧考试控制器监听器完成注册后再开放 React 身份确认，避免接管事件丢失。
document.documentElement.dataset["studentEntryController"] = "ready";
document.dispatchEvent(new Event(STUDENT_ENTRY_CONTROLLER_READY_EVENT));
