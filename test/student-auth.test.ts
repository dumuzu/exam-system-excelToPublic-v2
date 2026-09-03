import assert from "node:assert/strict";
import test from "node:test";

import {
  createStudentSession,
  createSubmissionConfirmation,
  hashStudentSession,
  serializeStudentSessionCookie,
  verifyStudentSession,
  verifySubmissionConfirmation,
} from "../src/server/student-auth.ts";

const secret: any = "test-session-secret-that-is-long-enough";

test("student session is signed, scoped to the site and expires", () => {
  const created: any = createStudentSession({ examCode: "SUM-2026", studentNumber: "20260001", sessionSecret: secret, now: 1_000_000 });
  const session: any = verifyStudentSession(created.token, secret, 1_000_001);
  assert.equal(session.examCode, "SUM-2026");
  assert.equal(session.studentNumber, "20260001");
  assert.equal(session.csrf, created.csrfToken);
  assert.match(serializeStudentSessionCookie(created.token), /HttpOnly/);
  assert.match(serializeStudentSessionCookie(created.token), /Path=\//);
  assert.equal(verifyStudentSession(created.token, secret, 10_000_000), null);
  assert.equal(verifyStudentSession(`${created.token}x`, secret, 1_000_001), null);
});

test("student session hashes are stable without storing the raw token", () => {
  assert.equal(hashStudentSession("token"), hashStudentSession("token"));
  assert.notEqual(hashStudentSession("token"), hashStudentSession("other"));
});

test("an untimed classroom session can remain valid for a long single sitting", () => {
  const twelveHours: any = 12 * 60 * 60;
  const created: any = createStudentSession({
    examCode: "PRACT1",
    studentNumber: "20260001",
    sessionSecret: secret,
    now: 1_000_000,
    lifetimeSeconds: twelveHours,
  });

  assert.ok(verifyStudentSession(created.token, secret, 1_000_000 + 3 * 60 * 60 * 1000));
  assert.equal(verifyStudentSession(created.token, secret, 1_000_000 + 13 * 60 * 60 * 1000), null);
  assert.match(serializeStudentSessionCookie(created.token, { maxAgeSeconds: twelveHours }), /Max-Age=43200/);
});

test("manual submission confirmation is signed, session-bound and cannot be used immediately", () => {
  const issuedAt: any = 1_000_000;
  const confirmation: any = createSubmissionConfirmation({
    examCode: "SUM-2026",
    studentNumber: "20260001",
    sessionTokenHash: "a".repeat(64),
    sessionSecret: secret,
    now: issuedAt,
  });

  assert.equal(verifySubmissionConfirmation(confirmation, {
    examCode: "SUM-2026",
    studentNumber: "20260001",
    sessionTokenHash: "a".repeat(64),
    sessionSecret: secret,
    now: issuedAt + 1_499,
  }), null);
  assert.deepEqual(verifySubmissionConfirmation(confirmation, {
    examCode: "SUM-2026",
    studentNumber: "20260001",
    sessionTokenHash: "a".repeat(64),
    sessionSecret: secret,
    now: issuedAt + 1_500,
  }), {
    examCode: "SUM-2026",
    studentNumber: "20260001",
    sessionTokenHash: "a".repeat(64),
  });
  assert.equal(verifySubmissionConfirmation(confirmation, {
    examCode: "SUM-2026",
    studentNumber: "20260001",
    sessionTokenHash: "b".repeat(64),
    sessionSecret: secret,
    now: issuedAt + 1_500,
  }), null);
  assert.equal(verifySubmissionConfirmation(`${confirmation}x`, {
    examCode: "SUM-2026",
    studentNumber: "20260001",
    sessionTokenHash: "a".repeat(64),
    sessionSecret: secret,
    now: issuedAt + 1_500,
  }), null);
  assert.equal(verifySubmissionConfirmation(confirmation, {
    examCode: "SUM-2026",
    studentNumber: "20260001",
    sessionTokenHash: "a".repeat(64),
    sessionSecret: secret,
    now: issuedAt + 5 * 60 * 1000,
  }), null);
});
