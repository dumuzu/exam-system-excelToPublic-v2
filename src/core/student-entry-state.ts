export const TERMINAL_ATTEMPT_STATUSES = Object.freeze([
  "submitted",
  "auto_submitted",
  "teacher_submitted",
  "policy_submitted",
  "review_required",
] as const);

export type TerminalAttemptStatus = typeof TERMINAL_ATTEMPT_STATUSES[number];
export type StudentEntryStatus = TerminalAttemptStatus | "policy_suspended" | "resume_available" | "admitted" | "waiting_approval";

export function resolveStudentEntryStatus({ attemptStatus, approvalStatus }: { attemptStatus?: string | null; approvalStatus?: string | null }): StudentEntryStatus {
  if (TERMINAL_ATTEMPT_STATUSES.includes(attemptStatus as TerminalAttemptStatus)) return attemptStatus as TerminalAttemptStatus;
  if (attemptStatus === "policy_suspended") return "policy_suspended";
  if (attemptStatus === "in_progress") return "resume_available";
  if (attemptStatus === "waiting") return approvalStatus === "approved" ? "admitted" : "waiting_approval";
  return approvalStatus === "approved" ? "admitted" : "waiting_approval";
}

export function isTerminalStudentEntryStatus(status: unknown): status is TerminalAttemptStatus {
  return TERMINAL_ATTEMPT_STATUSES.includes(status as TerminalAttemptStatus);
}
