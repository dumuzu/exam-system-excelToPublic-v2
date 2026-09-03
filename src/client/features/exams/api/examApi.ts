import {
  deleteExamResponseSchema,
  examEventListResponseSchema,
  examLifecycleConfirmationSchema,
} from "../../../../types/contracts/exam-events.ts";
import { executeExamTermination } from "../../../shared/api/examTermination.ts";
import { requestJson } from "../../../shared/api/httpClient.ts";
import type { ExamEvent, TerminationProgress } from "../types.ts";

interface LifecycleRequest {
  csrfToken: string;
  exam: ExamEvent;
  onProgress: (progress: TerminationProgress) => void;
  subjectId: string;
}

function lifecycleHeaders(subjectId: string, csrfToken: string): HeadersInit {
  return {
    "content-type": "application/json",
    "x-csrf-token": csrfToken,
    "x-subject-id": subjectId,
  };
}

export async function fetchExamEvents(subjectId: string): Promise<ExamEvent[]> {
  const response = await requestJson("/api/admin/exams", {
    headers: { "x-subject-id": subjectId },
  }, examEventListResponseSchema);
  return response.exams.map(({ createdAt, termination, ...exam }) => ({
    ...exam,
    createdAt: createdAt ?? "",
    terminated: termination !== null,
  }));
}

// 终止考试先保留最终同步窗口，再依照服务端批次状态收卷。
export async function terminateExamEvent({ csrfToken, exam, onProgress, subjectId }: LifecycleRequest): Promise<void> {
  await executeExamTermination({
    csrfToken,
    examCode: exam.code,
    mode: exam.mode,
    onProgress,
    subjectId,
  });
}

export async function deleteExamEvent({ csrfToken, exam, subjectId }: Omit<LifecycleRequest, "onProgress">): Promise<void> {
  const body = JSON.stringify(examLifecycleConfirmationSchema.parse({ confirmationCode: exam.code }));
  await requestJson(`/api/admin/exams/${encodeURIComponent(exam.code)}`, {
    method: "DELETE",
    headers: lifecycleHeaders(subjectId, csrfToken),
    body,
  }, deleteExamResponseSchema);
}
