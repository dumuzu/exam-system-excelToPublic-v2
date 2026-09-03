import type {
  ForcedSubmissionEvent,
  PolicySuspensionEvent,
  QuestionResult,
  ResultDetail,
  ResultSummary,
  WarningEvent,
} from "../../../types/contracts/results.ts";

export type ResultFilter = "all" | "graded" | "review_required" | "pending" | "failed";
export type { ForcedSubmissionEvent, PolicySuspensionEvent, QuestionResult, ResultDetail, ResultSummary, WarningEvent };

// 客户端命令上下文和审计展示行不属于服务端 wire contract。
export interface GradeAdjustmentInput {
  csrfToken: string;
  examCode: string;
  gradeResultId: string;
  newScore: number;
  reason: string;
  studentNumber: string;
  subjectId: string;
}

export interface ResultAuditEntry {
  key: string;
  student: ResultSummary;
  attemptNumber: number;
  type: "warning" | "suspended" | "forced";
  detail: string;
  occurredAt: string;
  secondaryAt?: string | undefined;
  actor?: string | undefined;
  remainingSeconds?: number | undefined;
}
