import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const studentSessionLifetimeSeconds = 2 * 60 * 60;
const maximumStudentSessionLifetimeSeconds = 24 * 60 * 60;
export const SUBMISSION_CONFIRMATION_MINIMUM_AGE_MILLISECONDS = 1_500;
const submissionConfirmationLifetimeMilliseconds = 5 * 60 * 1000;

export interface StudentSessionPayload {
  readonly kind: "student";
  readonly examCode: string;
  readonly studentNumber: string;
  readonly csrf: string;
  readonly exp: number;
}

interface SubmissionConfirmationPayload {
  readonly kind: "student-submission-confirmation";
  readonly examCode: string;
  readonly studentNumber: string;
  readonly sessionTokenHash: string;
  readonly nonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

type SignedPayload = StudentSessionPayload | SubmissionConfirmationPayload;

function normalizeLifetimeSeconds(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= studentSessionLifetimeSeconds && value <= maximumStudentSessionLifetimeSeconds
    ? value
    : studentSessionLifetimeSeconds;
}

function normalizeCookieMaxAgeSeconds(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maximumStudentSessionLifetimeSeconds
    ? value
    : studentSessionLifetimeSeconds;
}

function safeEqual(left: unknown, right: unknown): boolean {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(payloadPart: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(payloadPart).digest("base64url");
}

function createSignedToken(payload: SignedPayload, sessionSecret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadPart}.${sign(payloadPart, sessionSecret)}`;
}

function verifySignedToken(token: unknown, sessionSecret: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || typeof sessionSecret !== "string") return null;
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return null;
  const payloadPart = token.slice(0, separatorIndex);
  if (!safeEqual(sign(payloadPart, sessionSecret), token.slice(separatorIndex + 1))) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function createStudentSession({ examCode, studentNumber, sessionSecret, now = Date.now(), lifetimeSeconds = studentSessionLifetimeSeconds }: {
  examCode: string;
  studentNumber: string;
  sessionSecret: string;
  now?: number;
  lifetimeSeconds?: number;
}): { token: string; csrfToken: string } {
  const normalizedLifetime = normalizeLifetimeSeconds(lifetimeSeconds);
  const csrfToken = randomBytes(32).toString("base64url");
  const payload: StudentSessionPayload = {
    kind: "student",
    examCode,
    studentNumber,
    csrf: csrfToken,
    exp: Math.floor(now / 1000) + normalizedLifetime,
  };
  return { token: createSignedToken(payload, sessionSecret), csrfToken };
}

export function verifyStudentSession(token: unknown, sessionSecret: unknown, now = Date.now()): StudentSessionPayload | null {
  const payload = verifySignedToken(token, sessionSecret);
  if (payload?.["kind"] !== "student" || typeof payload["examCode"] !== "string" || typeof payload["studentNumber"] !== "string" || typeof payload["csrf"] !== "string") return null;
  if (typeof payload["exp"] !== "number" || !Number.isInteger(payload["exp"]) || payload["exp"] <= Math.floor(now / 1000)) return null;
  return payload as unknown as StudentSessionPayload;
}

export function createSubmissionConfirmation({
  examCode,
  studentNumber,
  sessionTokenHash,
  sessionSecret,
  now = Date.now(),
}: {
  examCode: string;
  studentNumber: string;
  sessionTokenHash: string;
  sessionSecret: string;
  now?: number;
}): string {
  return createSignedToken({
    kind: "student-submission-confirmation",
    examCode,
    studentNumber,
    sessionTokenHash,
    nonce: randomBytes(16).toString("base64url"),
    issuedAt: now,
    expiresAt: now + submissionConfirmationLifetimeMilliseconds,
  }, sessionSecret);
}

export function verifySubmissionConfirmation(token: unknown, {
  examCode,
  studentNumber,
  sessionTokenHash,
  sessionSecret,
  now = Date.now(),
}: {
  examCode: string;
  studentNumber: string;
  sessionTokenHash: string;
  sessionSecret: string;
  now?: number;
}): { examCode: string; studentNumber: string; sessionTokenHash: string } | null {
  const payload = verifySignedToken(token, sessionSecret);
  if (payload?.["kind"] !== "student-submission-confirmation"
    || payload["examCode"] !== examCode
    || payload["studentNumber"] !== studentNumber
    || payload["sessionTokenHash"] !== sessionTokenHash
    || typeof payload["nonce"] !== "string"
    || typeof payload["issuedAt"] !== "number"
    || !Number.isInteger(payload["issuedAt"])
    || typeof payload["expiresAt"] !== "number"
    || !Number.isInteger(payload["expiresAt"])
    || payload["expiresAt"] <= now
    || now - payload["issuedAt"] < SUBMISSION_CONFIRMATION_MINIMUM_AGE_MILLISECONDS) {
    return null;
  }
  return { examCode, studentNumber, sessionTokenHash };
}

export function serializeStudentSessionCookie(token: string, { secure = false, maxAgeSeconds = studentSessionLifetimeSeconds }: { secure?: boolean; maxAgeSeconds?: number } = {}): string {
  const normalizedLifetime = normalizeCookieMaxAgeSeconds(maxAgeSeconds);
  return [
    `student_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${normalizedLifetime}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function hashStudentSession(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
