import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adminExamQueryKeys } from "../../../shared/api/queryKeys.ts";
import {
  prepareAssessmentBatch,
  previewAssessment,
  publishAssessment,
  saveAuthoringConfiguration,
  useAuthoringConfiguration,
} from "../api/authoringApi.ts";
import { authoringQueryKeys } from "../api/authoringQueries.ts";

export function useAssessmentPreviewMutation() {
  return useMutation({ mutationFn: previewAssessment, retry: false });
}

export function useSaveAuthoringConfigurationMutation(subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveAuthoringConfiguration,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authoringQueryKeys.subject(subjectId) }),
    retry: false,
  });
}

export function useAuthoringConfigurationMutation(subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: useAuthoringConfiguration,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authoringQueryKeys.subject(subjectId) }),
    retry: false,
  });
}

export function usePublishAssessmentMutation(subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: publishAssessment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.subject(subjectId) }),
        queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.platform }),
      ]);
    },
    retry: false,
  });
}

export function usePreparationStepMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: prepareAssessmentBatch,
    onSuccess: (preparation, input) => {
      queryClient.setQueryData(authoringQueryKeys.preparation(input.subjectId, input.examCode), preparation);
      if (preparation.status === "ready") {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.subject(input.subjectId) }),
          queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.platform }),
        ]);
      }
    },
    retry: false,
  });
}
