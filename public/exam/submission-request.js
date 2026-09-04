function submissionError(error) {
    return error && typeof error === "object" ? error : {};
}
function isRetryableSubmissionError(error) {
    const status = submissionError(error).status;
    return !Number.isInteger(status) || Number(status) >= 500;
}
function wait(milliseconds) {
    return milliseconds > 0
        ? new Promise((resolve) => setTimeout(resolve, milliseconds))
        : Promise.resolve();
}
export function createFormalSubmissionPayload(confirmationToken) {
    return typeof confirmationToken === "string" && confirmationToken
        ? { confirmationToken }
        : {};
}
export async function submitDeadlineWithRetry({ submit, prepareBestEffort, maximumAttempts = 3, retryDelayMilliseconds = 1_000, }) {
    // 最终保存只能尽力而为，不能阻塞具有更高优先级的截止提交。
    if (prepareBestEffort)
        void prepareBestEffort().catch(() => undefined);
    let lastError;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        try {
            return await submit();
        }
        catch (error) {
            lastError = error;
            if (attempt >= maximumAttempts)
                throw error;
            await wait(retryDelayMilliseconds);
        }
    }
    throw lastError;
}
function localizedFailure(locale, ja, zh, en) {
    if (locale === "legacy_bilingual")
        return `${ja} / ${en}`;
    return { ja, zh, en }[locale];
}
export function describeSubmissionFailure(error, locale = "legacy_bilingual") {
    const failure = submissionError(error);
    if (failure.code === "SUBMISSION_CONFIRMATION_REQUIRED") {
        return {
            dialog: localizedFailure(locale, "答案を開いた直後の誤操作を防ぐため、まだ提出されていません。問題画面を確認してから、もう一度提出してください。", "为防止刚打开答卷时误操作，本次尚未提交。请检查题目后重新提交。", "To prevent an accidental click immediately after opening, this answer sheet was not submitted. Review the questions, then submit again."),
            status: localizedFailure(locale, "未提出です。問題を確認してから再度提出してください。", "尚未提交，请检查题目后重试。", "NOT SUBMITTED — REVIEW THE QUESTIONS AND TRY AGAIN."),
        };
    }
    if (failure.code === "SUBMISSION_ATTEMPT_MISMATCH") {
        return {
            dialog: localizedFailure(locale, "別の提出回の結果が返されたため、今回の答案は提出済みとして扱いません。答案はこの画面に残っています。画面を閉じず、先生に知らせてください。", "服务器返回了其他作答次数的结果，本次答卷未被标记为已提交。请保持页面打开并通知教师。", "A result for a different submission attempt was returned. This answer sheet has not been marked as submitted. Keep this page open and ask your teacher."),
            status: localizedFailure(locale, "未提出です。提出回を確認できません。", "尚未提交，无法确认本次提交。", "NOT SUBMITTED — SUBMISSION ATTEMPT COULD NOT BE VERIFIED."),
        };
    }
    if (failure.code === "EXAM_EVENT_UNAVAILABLE") {
        return {
            dialog: localizedFailure(locale, "この試験イベントは終了または削除されたため、答案を提出できません。答案はこの画面に残っています。画面を閉じず、先生に知らせてください。", "本场考试已结束或被删除，无法提交。答案仍保留在当前页面，请勿关闭并通知教师。", "This exam event has been closed or removed, so your answers cannot be submitted. They remain on this page. Do not close it; ask your teacher."),
            status: localizedFailure(locale, "未提出です。試験イベントが終了または削除されました。先生に知らせてください。", "尚未提交。本场考试已结束或被删除，请通知教师。", "NOT SUBMITTED — EVENT CLOSED OR REMOVED. ASK YOUR TEACHER."),
        };
    }
    if (["ATTEMPT_NOT_FOUND", "ATTEMPT_SESSION_EXPIRED"].includes(failure.code ?? "")
        || failure.status === 401 || failure.status === 403) {
        return {
            dialog: localizedFailure(locale, "この答題セッションを確認できません。答案はこの画面に残っています。画面を閉じず、先生に知らせてください。", "无法验证当前答题会话，答案仍保留在本页面。请勿关闭并通知教师。", "This answer session could not be verified. Your answers remain on this page. Do not close it; ask your teacher."),
            status: localizedFailure(locale, "未提出です。答題セッションを確認できません。", "尚未提交，无法验证答题会话。", "NOT SUBMITTED — ANSWER SESSION COULD NOT BE VERIFIED."),
        };
    }
    if (failure.code === "ATTEMPT_LOCKED") {
        return {
            dialog: localizedFailure(locale, "この答案はすでに締め切られているか、提出済みです。重複送信を避けるため、画面を閉じず先生に提出状況を確認してください。", "该答卷已锁定或已提交。为避免重复提交，请保持页面打开并让教师确认提交状态。", "This answer sheet is already locked or submitted. Keep this page open and ask your teacher to confirm the submission status."),
            status: localizedFailure(locale, "提出状態を先生に確認してください。", "请让教师确认提交状态。", "ASK YOUR TEACHER TO CONFIRM THE SUBMISSION STATUS."),
        };
    }
    if (Number.isInteger(failure.status) && Number(failure.status) >= 500) {
        return {
            dialog: localizedFailure(locale, "サーバーが答案を受け付けられませんでした。答案はこの画面に残っています。画面を閉じず、少し待ってからもう一度提出してください。繰り返し失敗する場合は先生に知らせてください。", "服务器暂时无法接收答卷，答案仍保留在本页面。请勿关闭，稍后重试；如持续失败请通知教师。", "The server could not accept your answer sheet. Your answers remain on this page. Keep it open and try again shortly. If it fails again, tell your teacher."),
            status: localizedFailure(locale, "未提出です。サーバー応答を確認して再度提出してください。", "尚未提交，请稍后重试。", "NOT SUBMITTED — SERVER RESPONSE FAILED. RETRY SHORTLY."),
        };
    }
    return {
        dialog: localizedFailure(locale, "通信が一時的に中断されました。答案はこの画面に残っています。ネットワークを確認して、もう一度提出してください。", "网络连接暂时中断，答案仍保留在本页面。请检查网络后重新提交。", "The connection was interrupted. Your answers remain on this page. Check the network and try again."),
        status: localizedFailure(locale, "未提出です。通信を確認して再度提出してください。", "尚未提交，请检查网络后重试。", "NOT SUBMITTED — CHECK THE CONNECTION AND RETRY."),
    };
}
export async function submitWithRetry({ request, answers, csrfToken, retryDelayMilliseconds = 250, }) {
    const body = JSON.stringify({ answers });
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return await request("/api/student/submit", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-csrf-token": csrfToken,
                },
                body,
            });
        }
        catch (error) {
            lastError = error;
            if (attempt > 0 || !isRetryableSubmissionError(error))
                throw error;
            await wait(retryDelayMilliseconds);
        }
    }
    throw lastError;
}
