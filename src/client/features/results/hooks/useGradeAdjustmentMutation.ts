import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adjustGrade } from "../api/resultApi.ts";
import type { GradeAdjustmentInput } from "../types.ts";

export function useGradeAdjustmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: adjustGrade,
    onSuccess: async (_result, input: GradeAdjustmentInput) => {
      await Promise.all([
        queryClient.invalidateQueries({ exact: true, queryKey: ["admin", "subjects", input.subjectId, "exams", input.examCode, "results"] }),
        queryClient.invalidateQueries({ exact: true, queryKey: ["admin", "subjects", input.subjectId, "exams", input.examCode, "results", input.studentNumber] }),
      ]);
    },
    retry: false,
  });
}
