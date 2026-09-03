import { queryOptions } from "@tanstack/react-query";

import { adminExamQueryKeys } from "../../../shared/api/queryKeys.ts";
import { EXAM_ROOM_REFRESH_INTERVAL_MS, roomRefreshInterval } from "../model/roomView.ts";
import { fetchExamRoomSnapshot, fetchRoomTerminationFailures } from "./examRoomApi.ts";

export function examRoomQueryOptions(examCode: string, pollingEnabled = true) {
  return queryOptions({
    queryKey: adminExamQueryKeys.room(examCode),
    queryFn: () => fetchExamRoomSnapshot(examCode),
    refetchInterval: pollingEnabled
      ? (query) => roomRefreshInterval(query.state.data?.room.mode ?? "exam")
      : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });
}

export function roomTerminationFailureQueryOptions(examCode: string, pollingEnabled = true) {
  return queryOptions({
    queryKey: adminExamQueryKeys.roomFailures(examCode),
    queryFn: () => fetchRoomTerminationFailures(examCode),
    refetchInterval: pollingEnabled ? EXAM_ROOM_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });
}
