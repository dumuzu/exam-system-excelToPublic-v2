import { useMutation, useQueryClient } from "@tanstack/react-query";

import { logoutAdmin } from "../api/authApi.ts";
export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: logoutAdmin,
    onSettled: () => queryClient.clear(),
    retry: false,
  });
}
