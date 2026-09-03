import type { ExamEventContract } from "../../../types/contracts/exam-events.ts";
import type { ExamTerminationProgress } from "../../shared/api/examTermination.ts";

export type ExamEvent = Omit<ExamEventContract, "createdAt" | "termination"> & {
  createdAt: string;
  terminated: boolean;
};
export type ExamEventFilter = "all" | "active" | "preparing" | "closed";
export type TerminationProgress = ExamTerminationProgress;
