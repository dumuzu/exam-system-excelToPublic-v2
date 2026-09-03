import assert from "node:assert/strict";
import test from "node:test";

import {
  createFormalSubmissionPayload,
  describeSubmissionFailure,
  submitDeadlineWithRetry,
  submitWithRetry,
} from "../src/client/exam/submission-request.ts";

test("student submission retries one temporary server failure with the same complete answer map", async () => {
  const calls: any = [];
  const request: any = async (path: any, options: any) => {
    calls.push({ path, options });
    if (calls.length === 1) {
      const error: any = new Error("Internal server error.");
      error.status = 503;
      throw error;
    }
    return { submission: { status: "received", score: 3 } };
  };
  const answers: any = { "formula-1-1": "=SUM(A2:A6)" };

  const result: any = await submitWithRetry({ request, answers, retryDelayMilliseconds: 0 });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/api/student/submit");
  assert.deepEqual(JSON.parse(calls[0].options.body), { answers });
  assert.equal(calls[1].options.body, calls[0].options.body);
  assert.equal(result.submission.score, 3);
});

test("student submission does not retry a validation failure", async () => {
  let calls: any = 0;
  const validationError: any = Object.assign(new Error("Invalid answer"), { status: 422 });

  await assert.rejects(
    () => submitWithRetry({
      request: async () => {
        calls += 1;
        throw validationError;
      },
      answers: { "formula-1": "=SUM(A2:A6)" },
      csrfToken: "csrf-token",
      retryDelayMilliseconds: 0,
    }),
    validationError,
  );

  assert.equal(calls, 1);
});

test("automatic formal submission omits a manual confirmation token", () => {
  assert.deepEqual(createFormalSubmissionPayload(null), {});
  assert.deepEqual(createFormalSubmissionPayload("signed-confirmation"), {
    confirmationToken: "signed-confirmation",
  });
});

test("deadline submission retries a transient failure without requiring student interaction", async () => {
  let calls: any = 0;
  const result: any = await submitDeadlineWithRetry({
    submit: async () => {
      calls += 1;
      if (calls < 2) throw new Error("server clock or connection delay");
      return { type: "timer" };
    },
    retryDelayMilliseconds: 0,
  });

  assert.deepEqual(result, { type: "timer" });
  assert.equal(calls, 2);
});

test("student submission explains that startup click-through was not accepted", () => {
  const copy: any = describeSubmissionFailure(Object.assign(new Error("Review first"), {
    status: 409,
    code: "SUBMISSION_CONFIRMATION_REQUIRED",
  }));

  assert.match(copy.dialog, /誤操作を防ぐ/);
  assert.match(copy.dialog, /was not submitted/);
  assert.match(copy.status, /NOT SUBMITTED/);
});

test("student submission explains when the teacher removed the exam event", () => {
  const copy: any = describeSubmissionFailure(Object.assign(new Error("Event unavailable"), {
    status: 410,
    code: "EXAM_EVENT_UNAVAILABLE",
  }));

  assert.match(copy.dialog, /試験イベントは終了または削除/);
  assert.match(copy.dialog, /has been closed or removed/);
  assert.match(copy.status, /EVENT CLOSED OR REMOVED/);
});

test("student submission treats a legacy missing-attempt response as an expired session", () => {
  const copy: any = describeSubmissionFailure(Object.assign(new Error("Attempt not found"), {
    status: 404,
    code: "ATTEMPT_NOT_FOUND",
  }));

  assert.match(copy.dialog, /答題セッションを確認できません/);
  assert.match(copy.status, /ANSWER SESSION COULD NOT BE VERIFIED/);
});

test("student submission refuses to display a result from another attempt", () => {
  const copy: any = describeSubmissionFailure(Object.assign(new Error("Attempt mismatch"), {
    status: 409,
    code: "SUBMISSION_ATTEMPT_MISMATCH",
  }));

  assert.match(copy.dialog, /別の提出回の結果/);
  assert.match(copy.dialog, /different submission attempt/);
  assert.match(copy.status, /SUBMISSION ATTEMPT COULD NOT BE VERIFIED/);
});

test("student submission distinguishes a server rejection from a lost connection", () => {
  const copy: any = describeSubmissionFailure(Object.assign(new Error("Internal server error."), {
    status: 500,
  }));

  assert.match(copy.dialog, /サーバー/);
  assert.match(copy.dialog, /server/);
  assert.doesNotMatch(copy.dialog, /network/i);
  assert.match(copy.status, /SERVER/);
});
