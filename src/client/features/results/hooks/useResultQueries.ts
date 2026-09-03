import { useQuery } from "@tanstack/react-query";

import { resultDetailQueryOptions, resultSummaryQueryOptions } from "../api/resultQueries.ts";

export function useResultSummaries(subjectId: string, examCode: string, enabled: boolean) {
  return useQuery({ ...resultSummaryQueryOptions(subjectId, examCode), enabled });
}

export function useResultDetail(subjectId: string, examCode: string, studentNumber: string | null) {
  return useQuery({
    ...resultDetailQueryOptions(subjectId, examCode, studentNumber ?? "missing"),
    enabled: Boolean(studentNumber),
  });
}
