import { queryOptions } from "@tanstack/react-query";

import { fetchAccountPage, fetchManagedSubjects } from "./accountApi.ts";

export const accountQueryKey = ["admin", "accounts"] as const;

export function accountPageQueryOptions(page: number, pageSize: number) {
  return queryOptions({
    queryKey: [...accountQueryKey, { page, pageSize }] as const,
    queryFn: () => fetchAccountPage(page, pageSize),
    staleTime: 15_000,
  });
}
export function managedSubjectQueryOptions() {
  return queryOptions({
    queryKey: ["admin", "managed-subjects"] as const,
    queryFn: fetchManagedSubjects,
    staleTime: 60_000,
  });
}
