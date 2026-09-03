interface SubmissionError {
  status?: number;
  code?: string;
}

type SubmissionRequest = (path: string, options: RequestInit) => Promise<unknown>;

function submissionError(error: unknown): SubmissionError {
  return error && typeof error === "object" ? error as SubmissionError : {};
}

function isRetryableSubmissionError(error: unknown): boolean {
  const status = submissionError(error).status;
  return !Number.isInteger(status) || Number(status) >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

export function createFormalSubmissionPayload(confirmationToken: unknown): { confirmationToken?: string } {
  return typeof confirmationToken === "string" && confirmationToken
    ? { confirmationToken }
    : {};
}

export async function submitDeadlineWithRetry({
  submit,
  prepareBestEffort,
  maximumAttempts = 3,
  retryDelayMilliseconds = 1_000,
}: {
  submit: () => Promise<unknown>;
  prepareBestEffort?: () => Promise<unknown>;
  maximumAttempts?: number;
  retryDelayMilliseconds?: number;
}): Promise<unknown> {
  // 最终保存只能尽力而为，不能阻塞具有更高优先级的截止提交。
  if (prepareBestEffort) void prepareBestEffort().catch(() => undefined);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await submit();
    } catch (error) {
      lastError = error;
      if (attempt >= maximumAttempts) throw error;
      await wait(retryDelayMilliseconds);
    }
  }
  throw lastError;
}

export function describeSubmissionFailure(error: unknown): { dialog: string; status: string } {
  const failure = submissionError(error);
  if (failure.code === "SUBMISSION_CONFIRMATION_REQUIRED") {
    return {
      dialog: "答案を開いた直後の誤操作を防ぐため、まだ提出されていません。問題画面を確認してから、もう一度提出してください。 / To prevent an accidental click immediately after opening, this answer sheet was not submitted. Review the questions, then submit again.",
      status: "未提出です。問題を確認してから再度提出してください。 / NOT SUBMITTED — REVIEW THE QUESTIONS AND TRY AGAIN.",
    };
  }
  if (failure.code === "SUBMISSION_ATTEMPT_MISMATCH") {
    return {
      dialog: "別の提出回の結果が返されたため、今回の答案は提出済みとして扱いません。答案はこの画面に残っています。画面を閉じず、先生に知らせてください。 / A result for a different submission attempt was returned. This answer sheet has not been marked as submitted. Keep this page open and ask your teacher.",
      status: "未提出です。提出回を確認できません。 / NOT SUBMITTED — SUBMISSION ATTEMPT COULD NOT BE VERIFIED.",
    };
  }
  if (failure.code === "EXAM_EVENT_UNAVAILABLE") {
    return {
      dialog: "この試験イベントは終了または削除されたため、答案を提出できません。答案はこの画面に残っています。画面を閉じず、先生に知らせてください。 / This exam event has been closed or removed, so your answers cannot be submitted. They remain on this page. Do not close it; ask your teacher.",
      status: "未提出です。試験イベントが終了または削除されました。先生に知らせてください。 / NOT SUBMITTED — EVENT CLOSED OR REMOVED. ASK YOUR TEACHER.",
    };
  }
  if (["ATTEMPT_NOT_FOUND", "ATTEMPT_SESSION_EXPIRED"].includes(failure.code ?? "")
    || failure.status === 401 || failure.status === 403) {
    return {
      dialog: "この答題セッションを確認できません。答案はこの画面に残っています。画面を閉じず、先生に知らせてください。 / This answer session could not be verified. Your answers remain on this page. Do not close it; ask your teacher.",
      status: "未提出です。答題セッションを確認できません。 / NOT SUBMITTED — ANSWER SESSION COULD NOT BE VERIFIED.",
    };
  }
  if (failure.code === "ATTEMPT_LOCKED") {
    return {
      dialog: "この答案はすでに締め切られているか、提出済みです。重複送信を避けるため、画面を閉じず先生に提出状況を確認してください。 / This answer sheet is already locked or submitted. Keep this page open and ask your teacher to confirm the submission status.",
      status: "提出状態を先生に確認してください。 / ASK YOUR TEACHER TO CONFIRM THE SUBMISSION STATUS.",
    };
  }
  if (Number.isInteger(failure.status) && Number(failure.status) >= 500) {
    return {
      dialog: "サーバーが答案を受け付けられませんでした。答案はこの画面に残っています。画面を閉じず、少し待ってからもう一度提出してください。繰り返し失敗する場合は先生に知らせてください。 / The server could not accept your answer sheet. Your answers remain on this page. Keep it open and try again shortly. If it fails again, tell your teacher.",
      status: "未提出です。サーバー応答を確認して再度提出してください。 / NOT SUBMITTED — SERVER RESPONSE FAILED. RETRY SHORTLY.",
    };
  }
  return {
    dialog: "通信が一時的に中断されました。答案はこの画面に残っています。ネットワークを確認して、もう一度提出してください。 / The connection was interrupted. Your answers remain on this page. Check the network and try again.",
    status: "未提出です。通信を確認して再度提出してください。 / NOT SUBMITTED — CHECK THE CONNECTION AND RETRY.",
  };
}

export async function submitWithRetry({
  request,
  answers,
  csrfToken,
  retryDelayMilliseconds = 250,
}: {
  request: SubmissionRequest;
  answers: Record<string, unknown>;
  csrfToken?: any;
  retryDelayMilliseconds?: number;
}): Promise<unknown> {
  const body = JSON.stringify({ answers });
  let lastError: unknown;
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
    } catch (error) {
      lastError = error;
      if (attempt > 0 || !isRetryableSubmissionError(error)) throw error;
      await wait(retryDelayMilliseconds);
    }
  }
  throw lastError;
}
