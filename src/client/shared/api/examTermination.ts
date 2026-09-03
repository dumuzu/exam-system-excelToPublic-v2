import {
  examLifecycleConfirmationSchema,
  terminationCollectionResponseSchema,
  terminationResponseSchema,
} from "../../../types/contracts/exam-events.ts";
import type { AssessmentMode } from "../../../types/models/assessment.ts";
import { requestJson } from "./httpClient.ts";

export interface ExamTerminationProgress {
  phase: "collecting" | "processing";
  pendingSubmissionCount?: number;
  remainingSeconds?: number;
}

interface ExamTerminationRequest {
  csrfToken: string;
  examCode: string;
  mode: AssessmentMode;
  onProgress?: (progress: ExamTerminationProgress) => void;
  subjectId?: string;
}

const maximumPasses = 40;
const maximumStalledPasses = 2;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

// 两个管理入口共用同一有界收卷编排，避免同步窗口与停滞规则发生漂移。
export async function executeExamTermination({
  csrfToken,
  examCode,
  mode,
  onProgress,
  subjectId,
}: ExamTerminationRequest) {
  const headers: HeadersInit = {
    "content-type": "application/json",
    "x-csrf-token": csrfToken,
    ...(subjectId ? { "x-subject-id": subjectId } : {}),
  };
  const body = JSON.stringify(examLifecycleConfirmationSchema.parse({ confirmationCode: examCode }));
  const basePath = `/api/admin/exams/${encodeURIComponent(examCode)}`;

  if (mode !== "assignment") {
    const started = await requestJson(
      `${basePath}/termination-collection`,
      { method: "POST", headers, body },
      terminationCollectionResponseSchema,
    );
    const deadline = Date.parse(started.collection.collectUntil);
    if (!Number.isFinite(deadline)) throw new Error("ROOM_COLLECTION_DEADLINE_INVALID");
    while (Date.now() < deadline) {
      onProgress?.({
        phase: "collecting",
        remainingSeconds: Math.max(1, Math.ceil((deadline - Date.now()) / 1_000)),
      });
      await wait(Math.min(1_000, Math.max(0, deadline - Date.now())));
    }
  }

  let response = await requestJson(
    `${basePath}/terminate`,
    { method: "POST", headers, body },
    terminationResponseSchema,
  );
  let passes = 1;
  let stalledPasses = 0;
  while (!response.exam.completed) {
    onProgress?.({ phase: "processing", pendingSubmissionCount: response.exam.pendingSubmissionCount });
    stalledPasses = response.exam.processedThisBatch === 0 ? stalledPasses + 1 : 0;
    if (stalledPasses >= maximumStalledPasses || passes >= maximumPasses) {
      throw new Error("ROOM_COLLECTION_STALLED");
    }
    await wait(100);
    response = await requestJson(
      `${basePath}/terminate`,
      { method: "POST", headers, body },
      terminationResponseSchema,
    );
    passes += 1;
  }
  return response.exam;
}
