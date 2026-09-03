import {
  gradeAdjustmentBodySchema,
  gradeAdjustmentResponseSchema,
  resultDetailResponseSchema,
  resultListResponseSchema,
} from "../../../../types/contracts/results.ts";
import { requestJson } from "../../../shared/api/httpClient.ts";
import type { GradeAdjustmentInput, ResultDetail, ResultSummary } from "../types.ts";

export async function fetchResultSummaries(subjectId: string, examCode: string): Promise<ResultSummary[]> {
  const response = await requestJson(`/api/admin/exams/${encodeURIComponent(examCode)}/results`, {
    headers: { "x-subject-id": subjectId },
  }, resultListResponseSchema);
  return response.results;
}

export async function fetchResultDetail(subjectId: string, examCode: string, studentNumber: string): Promise<ResultDetail> {
  const response = await requestJson(`/api/admin/exams/${encodeURIComponent(examCode)}/students/${encodeURIComponent(studentNumber)}/result`, {
    headers: { "x-subject-id": subjectId },
  }, resultDetailResponseSchema);
  return response.result;
}

export async function adjustGrade(input: GradeAdjustmentInput): Promise<void> {
  const body = gradeAdjustmentBodySchema.parse({ newScore: input.newScore, reason: input.reason });
  await requestJson(`/api/admin/grade-results/${encodeURIComponent(input.gradeResultId)}/adjust`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": input.csrfToken,
      "x-subject-id": input.subjectId,
    },
    body: JSON.stringify(body),
  }, gradeAdjustmentResponseSchema);
}

export function resultCsvUrl(examCode: string): string {
  return `/api/admin/exams/${encodeURIComponent(examCode)}/results.csv`;
}

export function warningCsvUrl(examCode: string): string {
  return `/api/admin/exams/${encodeURIComponent(examCode)}/warnings.csv`;
}
