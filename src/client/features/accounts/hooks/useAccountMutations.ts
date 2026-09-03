import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createManagedAccount, mutateManagedAccount } from "../api/accountApi.ts";
import { accountQueryKey } from "../api/accountQueries.ts";

export function useCreateAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: createManagedAccount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountQueryKey }),
    retry: false,
  });
}
export function useAccountActionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: mutateManagedAccount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountQueryKey }),
    retry: false,
  });
}
