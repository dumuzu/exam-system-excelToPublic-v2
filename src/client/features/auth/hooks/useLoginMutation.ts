import { useMutation } from "@tanstack/react-query";

import { loginAdmin } from "../api/authApi.ts";

export function useLoginMutation() {
  return useMutation({ gcTime: 0, mutationFn: loginAdmin, retry: false });
}
