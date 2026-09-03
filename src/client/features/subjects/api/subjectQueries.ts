import { queryOptions } from "@tanstack/react-query";

import { fetchSubjectCatalog } from "./subjectApi.ts";

export const subjectCatalogQueryKey = ["admin", "subject-catalog"] as const;

export function subjectCatalogQueryOptions() {
  return queryOptions({
    queryKey: subjectCatalogQueryKey,
    queryFn: fetchSubjectCatalog,
    staleTime: 30_000,
  });
}
