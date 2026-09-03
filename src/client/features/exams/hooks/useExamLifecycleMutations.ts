import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { adminExamQueryKeys } from "../../../shared/api/queryKeys.ts";
import { deleteExamEvent, terminateExamEvent } from "../api/examApi.ts";

async function invalidateExamEventQueries(queryClient: QueryClient, subjectId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.subject(subjectId) }),
    queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.platform }),
  ]);
}

export function useTerminateExamMutation(subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: terminateExamEvent,
    onSuccess: () => invalidateExamEventQueries(queryClient, subjectId),
    retry: false,
  });
}
export function useDeleteExamMutation(subjectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteExamEvent,
    onSuccess: () => invalidateExamEventQueries(queryClient, subjectId),
    retry: false,
  });
}
