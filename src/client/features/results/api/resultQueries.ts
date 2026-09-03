import { queryOptions } from "@tanstack/react-query";

import { fetchResultDetail, fetchResultSummaries } from "./resultApi.ts";

export function resultSummaryQueryOptions(subjectId: string, examCode: string) {
  return queryOptions({
    queryKey: ["admin", "subjects", subjectId, "exams", examCode, "results"] as const,
    queryFn: () => fetchResultSummaries(subjectId, examCode),
    staleTime: 15_000,
  });
}

export function resultDetailQueryOptions(subjectId: string, examCode: string, studentNumber: string) {
  return queryOptions({
    queryKey: ["admin", "subjects", subjectId, "exams", examCode, "results", studentNumber] as const,
    queryFn: () => fetchResultDetail(subjectId, examCode, studentNumber),
    staleTime: 15_000,
  });
}
