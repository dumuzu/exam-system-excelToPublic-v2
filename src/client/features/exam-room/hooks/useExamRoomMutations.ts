import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { adminExamQueryKeys } from "../../../shared/api/queryKeys.ts";
import {
  admitRoomStudent,
  admitSelectedRoomStudents,
  authorizeRoomResume,
  authorizeRoomRetake,
  retryRoomTerminationFailure,
  runRoomTermination,
} from "../api/examRoomApi.ts";
import type {
  ExamRoomMutationScope,
  RoomBulkAdmissionCommand,
  RoomRetryFailureCommand,
  RoomStudentCommand,
  RoomTerminationCommand,
} from "../types.ts";

async function invalidateExamRoom(
  queryClient: QueryClient,
  scope: ExamRoomMutationScope,
  includeFailures = false,
): Promise<void> {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.room(scope.examCode), exact: true }),
    queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.subject(scope.subjectId) }),
    queryClient.invalidateQueries({ queryKey: adminExamQueryKeys.platform }),
  ];
  if (includeFailures) {
    invalidations.push(queryClient.invalidateQueries({
      queryKey: adminExamQueryKeys.roomFailures(scope.examCode),
      exact: true,
    }));
  }
  await Promise.all(invalidations);
}

export function useAdmitRoomStudentMutation(scope: ExamRoomMutationScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...adminExamQueryKeys.room(scope.examCode), "admit-student"],
    mutationFn: (command: RoomStudentCommand) => admitRoomStudent({ ...command, examCode: scope.examCode }),
    onSuccess: () => invalidateExamRoom(queryClient, scope),
    retry: false,
  });
}

export function useAdmitSelectedRoomStudentsMutation(scope: ExamRoomMutationScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...adminExamQueryKeys.room(scope.examCode), "admit-selected"],
    mutationFn: (command: RoomBulkAdmissionCommand) => admitSelectedRoomStudents({ ...command, examCode: scope.examCode }),
    onSuccess: () => invalidateExamRoom(queryClient, scope),
    retry: false,
  });
}

export function useAuthorizeRoomResumeMutation(scope: ExamRoomMutationScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...adminExamQueryKeys.room(scope.examCode), "resume"],
    mutationFn: (command: RoomStudentCommand) => authorizeRoomResume({ ...command, examCode: scope.examCode }),
    onSuccess: () => invalidateExamRoom(queryClient, scope),
    retry: false,
  });
}

export function useAuthorizeRoomRetakeMutation(scope: ExamRoomMutationScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...adminExamQueryKeys.room(scope.examCode), "retake"],
    mutationFn: (command: RoomStudentCommand) => authorizeRoomRetake({ ...command, examCode: scope.examCode }),
    onSuccess: () => invalidateExamRoom(queryClient, scope),
    retry: false,
  });
}

export function useRetryRoomTerminationFailureMutation(scope: ExamRoomMutationScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...adminExamQueryKeys.roomFailures(scope.examCode), "retry"],
    mutationFn: (command: RoomRetryFailureCommand) => retryRoomTerminationFailure({
      ...command,
      examCode: scope.examCode,
    }),
    onSuccess: () => invalidateExamRoom(queryClient, scope, true),
    retry: false,
  });
}

export function useTerminateRoomMutation(scope: ExamRoomMutationScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [...adminExamQueryKeys.room(scope.examCode), "terminate"],
    mutationFn: (command: RoomTerminationCommand) => runRoomTermination({ ...command, examCode: scope.examCode }),
    onMutate: async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: adminExamQueryKeys.room(scope.examCode), exact: true }),
        queryClient.cancelQueries({ queryKey: adminExamQueryKeys.roomFailures(scope.examCode), exact: true }),
      ]);
    },
    onSettled: () => invalidateExamRoom(queryClient, scope, true),
    retry: false,
  });
}
