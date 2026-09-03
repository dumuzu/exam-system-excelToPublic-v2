import { queryOptions } from "@tanstack/react-query";
import type { ManagedAssessmentTypeKey } from "../../../../types/contracts/account-administration.ts";

import {
  fetchAssessmentPreparation,
  fetchAuthoringConfigurations,
  fetchAuthoringFunctions,
  fetchAuthoringModes,
} from "./authoringApi.ts";

export const authoringQueryKeys = {
  subject: (subjectId: string) => ["admin", "subjects", subjectId, "authoring"] as const,
  modes: (subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey) => [...authoringQueryKeys.subject(subjectId), assessmentTypeKey, "modes"] as const,
  functions: (subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey) => [...authoringQueryKeys.subject(subjectId), assessmentTypeKey, "functions"] as const,
  configurations: (subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey) => [...authoringQueryKeys.subject(subjectId), assessmentTypeKey, "configurations"] as const,
  preparation: (subjectId: string, examCode: string) => [
    ...authoringQueryKeys.subject(subjectId),
    "preparations",
    examCode,
  ] as const,
};

export function authoringModeQueryOptions(subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey) {
  return queryOptions({
    queryKey: authoringQueryKeys.modes(subjectId, assessmentTypeKey),
    queryFn: () => fetchAuthoringModes(subjectId, assessmentTypeKey),
    staleTime: 5 * 60_000,
  });
}

export function authoringFunctionQueryOptions(subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey) {
  return queryOptions({
    queryKey: authoringQueryKeys.functions(subjectId, assessmentTypeKey),
    queryFn: () => fetchAuthoringFunctions(subjectId, assessmentTypeKey),
    staleTime: 5 * 60_000,
  });
}

export function authoringConfigurationQueryOptions(subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey) {
  return queryOptions({
    queryKey: authoringQueryKeys.configurations(subjectId, assessmentTypeKey),
    queryFn: () => fetchAuthoringConfigurations(subjectId, assessmentTypeKey),
    staleTime: 30_000,
  });
}

export function preparationQueryOptions(subjectId: string, examCode: string) {
  return queryOptions({
    queryKey: authoringQueryKeys.preparation(subjectId, examCode),
    queryFn: () => fetchAssessmentPreparation(subjectId, examCode),
    staleTime: 0,
  });
}
