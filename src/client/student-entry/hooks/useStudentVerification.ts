import { useMutation } from "@tanstack/react-query";

import { verifyStudentIdentity } from "../api/studentEntryApi.ts";

export function useStudentVerification() {
  return useMutation({ mutationFn: verifyStudentIdentity });
}
