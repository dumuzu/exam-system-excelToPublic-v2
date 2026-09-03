import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adminSessionQueryKey } from "../../auth/api/authQueries.ts";
import { accountQueryKey } from "../../accounts/api/accountQueries.ts";
import { createSubject, updateSubject, updateSubjectStatus } from "../api/subjectApi.ts";
import { subjectCatalogQueryKey } from "../api/subjectQueries.ts";

function useSubjectMutation<Variables>(mutationFn: (variables: Variables) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subjectCatalogQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["admin", "managed-subjects"] }),
        queryClient.invalidateQueries({ queryKey: accountQueryKey }),
        queryClient.invalidateQueries({ queryKey: adminSessionQueryKey }),
      ]);
    },
  });
}

export function useCreateSubjectMutation() {
  return useSubjectMutation(createSubject);
}

export function useUpdateSubjectMutation() {
  return useSubjectMutation(updateSubject);
}

export function useSubjectStatusMutation() {
  return useSubjectMutation(updateSubjectStatus);
}
