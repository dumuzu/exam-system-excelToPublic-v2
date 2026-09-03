import { queryOptions } from "@tanstack/react-query";

import { fetchAdminSession } from "./authApi.ts";

export const adminSessionQueryKey = ["admin", "session"] as const;

export function adminSessionQueryOptions() {
  return queryOptions({
    queryKey: adminSessionQueryKey,
    queryFn: fetchAdminSession,
    retry: false,
    staleTime: 60_000,
  });
}
