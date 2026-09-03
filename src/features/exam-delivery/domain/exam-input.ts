import { validateBrowserPreflight as validateIntegrityBrowserPreflight } from "../../../core/integrity-policy.ts";
import type { BrowserPreflight } from "../../../core/integrity-policy.ts";
import { validateExamCode, validateStudentNumber } from "../../../core/student-identity.ts";

const maxSubmissionAnswerCount = 1500;
const questionKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const answerKeyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type StudentAnswerValue = string | string[] | Record<string, string>;

export interface StudentVerificationInput {
  readonly valid: true;
  readonly examCode: string;
  readonly studentNumber: string;
}

export interface AnswerInput {
  readonly questionKey: string;
  readonly answerValue: StudentAnswerValue;
  readonly formula: string;
  readonly expectedVersion: number;
  readonly clientSavedAt: string | null;
}

export interface SubmissionInput {
  readonly answers: Record<string, StudentAnswerValue> | null;
  readonly confirmationToken: string | null;
}

export interface GradeAdjustmentInput {
  readonly newScore: number;
  readonly reason: string;
}

export type ProctorEventType = "page_hidden" | "fullscreen_exit" | "copy_blocked" | "paste_blocked";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function validateStudentVerificationPayload(value: unknown): StudentVerificationInput | { readonly valid: false } {
  if (!isRecord(value)) return { valid: false };
  const examCode = validateExamCode(value["examCode"]);
  const identity = validateStudentNumber(value);
  if (!examCode.valid || typeof examCode.value !== "string"
    || !identity.valid || typeof identity.value?.studentNumber !== "string") return { valid: false };
  return { valid: true, examCode: examCode.value, studentNumber: identity.value.studentNumber };
}

export function validateBrowserPreflight(value: unknown): BrowserPreflight | null {
  const result = validateIntegrityBrowserPreflight(value);
  return result.ok ? result.value : null;
}

export function validateStudentAnswerValue(value: unknown): StudentAnswerValue | null {
  if (typeof value === "string") return value.length <= 20_000 && !value.includes("\0") ? value : null;
  if (Array.isArray(value)) {
    if (value.length > 20
      || !value.every((item): item is string => typeof item === "string" && item.length <= 64)
      || new Set(value).size !== value.length) return null;
    return [...value];
  }
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 100 || entries.some(([key, answer]) => !answerKeyPattern.test(key)
    || typeof answer !== "string" || answer.length > 500 || answer.includes("\0"))) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

export function validateAnswerPayload(value: unknown): AnswerInput | null {
  if (!isRecord(value)) return null;
  // 自动保存只接收单题白名单字段，并用版本号防止并发覆盖新答案。
  if (!hasOnlyKeys(value, ["questionKey", "formula", "answer", "expectedVersion", "clientSavedAt"])) return null;
  if (typeof value["questionKey"] !== "string" || !questionKeyPattern.test(value["questionKey"])) return null;
  if ((value["formula"] === undefined) === (value["answer"] === undefined)) return null;
  const answerValue = validateStudentAnswerValue(value["answer"] ?? value["formula"]);
  if (answerValue === null) return null;
  if (!Number.isInteger(value["expectedVersion"]) || (value["expectedVersion"] as number) < 0) return null;
  if (value["clientSavedAt"] !== undefined
    && (typeof value["clientSavedAt"] !== "string" || !Number.isFinite(Date.parse(value["clientSavedAt"])))) return null;
  return {
    questionKey: value["questionKey"],
    answerValue,
    formula: typeof answerValue === "string" ? answerValue : "",
    expectedVersion: value["expectedVersion"] as number,
    clientSavedAt: value["clientSavedAt"] ?? null as string | null,
  };
}

export function validateSubmissionPayload(value: unknown): SubmissionInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["answers", "confirmationToken"])) return null;
  if (value["confirmationToken"] !== undefined
    && (typeof value["confirmationToken"] !== "string" || value["confirmationToken"].length > 1024)) return null;
  const confirmationToken = value["confirmationToken"] ?? null as string | null;
  if (value["answers"] === undefined) return { answers: null, confirmationToken };
  if (!isRecord(value["answers"])) return null;
  const entries = Object.entries(value["answers"]);
  // 整卷答案数量设硬上限，避免百人并发交卷时异常载荷放大资源占用。
  if (entries.length > maxSubmissionAnswerCount) return null;
  const validatedEntries = entries.map(([questionKey, answer]) => [questionKey, validateStudentAnswerValue(answer)] as const);
  if (!validatedEntries.every(([questionKey, answer]) => questionKeyPattern.test(questionKey) && answer !== null)) return null;
  return { answers: Object.fromEntries(validatedEntries) as Record<string, StudentAnswerValue>, confirmationToken };
}

export function validateGradeAdjustment(value: unknown): GradeAdjustmentInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["newScore", "reason"])) return null;
  if (typeof value["newScore"] !== "number" || !Number.isFinite(value["newScore"])
    || value["newScore"] < 0 || value["newScore"] > 999.99) return null;
  const reason = typeof value["reason"] === "string" ? value["reason"].trim() : "";
  if (reason.length < 3 || reason.length > 500) return null;
  return { newScore: Math.round(value["newScore"] * 100) / 100, reason };
}

export function validateProctorEvent(value: unknown): Readonly<{ eventType: ProctorEventType }> | null {
  const allowed = new Set<ProctorEventType>(["page_hidden", "fullscreen_exit", "copy_blocked", "paste_blocked"]);
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value["eventType"] !== "string"
    || !allowed.has(value["eventType"] as ProctorEventType)) return null;
  return { eventType: value["eventType"] as ProctorEventType };
}
