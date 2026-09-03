export const TRANSIENT_FOCUS_LOSS_MS = 1_200;
export const FULLSCREEN_RECOVERY_GRACE_PERIODS_MS = Object.freeze([10_000, 5_000, 3_000]);
export const FULLSCREEN_RECOVERY_GRACE_MS = FULLSCREEN_RECOVERY_GRACE_PERIODS_MS[0];
export function getFullscreenRecoveryGraceMs(interruptionCount) {
    if (!Number.isInteger(interruptionCount) || interruptionCount < 1)
        throw new TypeError("INVALID_FULLSCREEN_INTERRUPTION_COUNT");
    const scheduleIndex = Math.min(interruptionCount - 1, FULLSCREEN_RECOVERY_GRACE_PERIODS_MS.length - 1);
    return FULLSCREEN_RECOVERY_GRACE_PERIODS_MS[scheduleIndex] ?? FULLSCREEN_RECOVERY_GRACE_PERIODS_MS[2];
}
const integritySignalDefinitions = Object.freeze({
    page_hidden: { kind: "focus_lost", details: {} },
    fullscreen_exit: { kind: "fullscreen_exited", details: {} },
    copy_blocked: { kind: "clipboard_attempt", details: { operation: "copy" } },
    paste_blocked: { kind: "clipboard_attempt", details: { operation: "paste" } },
});
export function createBrowserIntegritySignal(eventType, observedAt = new Date().toISOString()) {
    const definition = integritySignalDefinitions[eventType];
    if (!definition || !Number.isFinite(Date.parse(observedAt)))
        throw new TypeError("UNKNOWN_INTEGRITY_EVENT");
    return {
        kind: definition.kind,
        sourceEventType: eventType,
        observedAt,
        details: { ...definition.details },
    };
}
// 全屏退出先遮挡试卷并进入恢复宽限；只有超时仍未恢复时才生成一次违规信号。
export function createFullscreenRecoveryGuard({ shouldMonitor, hasFullscreen, onRecoveryStarted, onRecovered, onConfirmedExit, getGraceMs = getFullscreenRecoveryGraceMs, scheduleTimer = (callback, delay) => window.setTimeout(callback, delay), cancelTimer = (timer) => window.clearTimeout(timer), now = () => window.performance?.now?.() ?? Date.now(), }) {
    let pendingTimer = null;
    let recoveryStartedAt = null;
    let activeGraceMs = null;
    let interruptionCount = 0;
    const cancelPendingRecovery = () => {
        if (pendingTimer !== null)
            cancelTimer(pendingTimer);
        pendingTimer = null;
        recoveryStartedAt = null;
        activeGraceMs = null;
    };
    const confirmExit = (startedAt) => {
        if (recoveryStartedAt !== startedAt)
            return;
        const confirmedGraceMs = activeGraceMs ?? getGraceMs(interruptionCount);
        const confirmedInterruptionCount = interruptionCount;
        pendingTimer = null;
        const shouldReport = shouldMonitor() && !hasFullscreen();
        recoveryStartedAt = null;
        activeGraceMs = null;
        if (shouldReport)
            onConfirmedExit(createBrowserIntegritySignal("fullscreen_exit"), confirmedGraceMs, confirmedInterruptionCount);
        else
            onRecovered();
    };
    const handleFullscreenChange = () => {
        if (!shouldMonitor()) {
            const hadPendingRecovery = recoveryStartedAt !== null;
            cancelPendingRecovery();
            if (hadPendingRecovery)
                onRecovered();
            return;
        }
        if (hasFullscreen()) {
            if (recoveryStartedAt === null)
                return;
            const elapsedMs = Math.max(0, now() - recoveryStartedAt);
            const completedGraceMs = activeGraceMs ?? getGraceMs(interruptionCount);
            const completedInterruptionCount = interruptionCount;
            cancelPendingRecovery();
            if (elapsedMs >= completedGraceMs)
                onConfirmedExit(createBrowserIntegritySignal("fullscreen_exit"), completedGraceMs, completedInterruptionCount);
            else
                onRecovered();
            return;
        }
        if (recoveryStartedAt !== null)
            return;
        interruptionCount += 1;
        activeGraceMs = getGraceMs(interruptionCount);
        recoveryStartedAt = now();
        onRecoveryStarted(recoveryStartedAt + activeGraceMs, activeGraceMs, interruptionCount);
        const startedAt = recoveryStartedAt;
        pendingTimer = scheduleTimer(() => confirmExit(startedAt), activeGraceMs);
    };
    const resetRecoveryHistory = () => {
        cancelPendingRecovery();
        interruptionCount = 0;
    };
    return {
        cancelPendingRecovery,
        getInterruptionCount: () => interruptionCount,
        handleFullscreenChange,
        isRecoveryPending: () => recoveryStartedAt !== null,
        resetRecoveryHistory,
        stop: resetRecoveryHistory,
    };
}
function pageHasLostFocus(documentRef) {
    return documentRef.visibilityState === "hidden"
        || (typeof documentRef.hasFocus === "function" && !documentRef.hasFocus());
}
export function createTransientFocusGuard({ documentRef, windowRef, shouldMonitor, onConfirmedLoss, delayMs = TRANSIENT_FOCUS_LOSS_MS, scheduleTimer = (callback, delay) => windowRef.setTimeout(callback, delay), cancelTimer = (timer) => windowRef.clearTimeout(timer), now = () => windowRef.performance?.now?.() ?? Date.now(), }) {
    let pendingTimer = null;
    let lossStartedAt = null;
    const cancelPendingLoss = () => {
        if (pendingTimer !== null)
            cancelTimer(pendingTimer);
        pendingTimer = null;
        lossStartedAt = null;
    };
    const scheduleLossCheck = () => {
        if (!shouldMonitor() || lossStartedAt !== null)
            return;
        lossStartedAt = now();
        pendingTimer = scheduleTimer(() => {
            pendingTimer = null;
            const shouldReport = shouldMonitor() && pageHasLostFocus(documentRef);
            lossStartedAt = null;
            if (shouldReport)
                onConfirmedLoss(createBrowserIntegritySignal("page_hidden"));
        }, delayMs);
    };
    const restoreFocus = () => {
        if (lossStartedAt === null) {
            cancelPendingLoss();
            return;
        }
        const elapsedMs = Math.max(0, now() - lossStartedAt);
        const shouldReport = shouldMonitor() && elapsedMs >= delayMs;
        cancelPendingLoss();
        if (shouldReport)
            onConfirmedLoss(createBrowserIntegritySignal("page_hidden"));
    };
    const handleVisibility = () => {
        if (documentRef.visibilityState === "hidden")
            scheduleLossCheck();
        else
            restoreFocus();
    };
    const handleFocus = () => {
        if (documentRef.visibilityState !== "hidden")
            restoreFocus();
    };
    documentRef.addEventListener("visibilitychange", handleVisibility);
    windowRef.addEventListener("blur", scheduleLossCheck);
    windowRef.addEventListener("focus", handleFocus);
    return {
        cancelPendingLoss,
        stop() {
            cancelPendingLoss();
            documentRef.removeEventListener("visibilitychange", handleVisibility);
            windowRef.removeEventListener("blur", scheduleLossCheck);
            windowRef.removeEventListener("focus", handleFocus);
        },
    };
}
export function shouldBlockHorizontalNavigation(event) {
    if (!event.cancelable || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY))
        return false;
    const target = event.target;
    const scroller = target?.closest?.(".sheetWrap");
    if (!scroller)
        return true;
    const maximumScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    if (maximumScrollLeft === 0)
        return true;
    const atStart = scroller.scrollLeft <= 1;
    const atEnd = scroller.scrollLeft >= maximumScrollLeft - 1;
    return (event.deltaX < 0 && atStart) || (event.deltaX > 0 && atEnd);
}
export function createAssessmentNavigationGuard({ documentRef, windowRef, shouldProtect, onNavigationBlocked, }) {
    let armed = false;
    const pushGuardState = () => {
        const currentState = windowRef.history.state;
        const state = currentState && typeof currentState === "object" ? currentState : {};
        try {
            windowRef.history.pushState({ ...state, assessmentIntegrityGuard: true }, "", windowRef.location.href);
            return true;
        }
        catch {
            return false;
        }
    };
    const arm = () => {
        if (armed)
            return;
        armed = pushGuardState();
    };
    const release = () => {
        armed = false;
    };
    const handlePopState = () => {
        if (!armed || !shouldProtect()) {
            release();
            return;
        }
        if (!pushGuardState())
            windowRef.history.forward?.();
        onNavigationBlocked?.();
    };
    const handleWheel = (event) => {
        if (!shouldProtect() || !shouldBlockHorizontalNavigation(event))
            return;
        event.preventDefault();
    };
    windowRef.addEventListener("popstate", handlePopState);
    documentRef.addEventListener("wheel", handleWheel, { passive: false });
    return {
        arm,
        release,
        stop() {
            release();
            windowRef.removeEventListener("popstate", handlePopState);
            documentRef.removeEventListener("wheel", handleWheel);
        },
    };
}
// Compatibility name for existing callers while the browser modules migrate.
export const createExamNavigationGuard = createAssessmentNavigationGuard;
