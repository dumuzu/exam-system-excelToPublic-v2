import { queryOptions } from "@tanstack/react-query";

import { adminExamQueryKeys } from "../../../shared/api/queryKeys.ts";
import { fetchPlatformExamEvents } from "./systemApi.ts";

export function platformExamEventQueryOptions() {
  return queryOptions({
    queryKey: adminExamQueryKeys.platform,
    queryFn: fetchPlatformExamEvents,
    staleTime: 15_000,
  });
}
