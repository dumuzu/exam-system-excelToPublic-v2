import {
  examEventListResponseSchema,
  type ExamEventContract,
} from "../../../../types/contracts/exam-events.ts";
import { requestJson } from "../../../shared/api/httpClient.ts";

export async function fetchPlatformExamEvents(): Promise<ExamEventContract[]> {
  const response = await requestJson("/api/admin/exams", {}, examEventListResponseSchema);
  return response.exams;
}
