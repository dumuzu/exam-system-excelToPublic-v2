import { queryOptions } from "@tanstack/react-query";

import { adminExamQueryKeys } from "../../../shared/api/queryKeys.ts";
import { fetchExamEvents } from "./examApi.ts";

export function examEventQueryOptions(subjectId: string) {
  return queryOptions({
    queryKey: adminExamQueryKeys.subject(subjectId),
    queryFn: () => fetchExamEvents(subjectId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
