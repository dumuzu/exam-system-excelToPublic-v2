import { useCallback, useRef, useState } from "react";

import type { Preparation, PublishedAssessment } from "../../../../types/contracts/exam-authoring.ts";
import { usePreparationStepMutation } from "./useAuthoringMutations.ts";

export const activePreparationStorageKey = "excel-exam-active-preparation";

export interface PreparationTarget {
  readonly code: string;
  readonly rosterCount: number;
}

export interface PreparationRunState {
  readonly target: PreparationTarget | null;
  readonly preparation: Preparation | null;
  readonly error: Error | null;
  readonly running: boolean;
}

const initialState: PreparationRunState = {
  target: null,
  preparation: null,
  error: null,
  running: false,
};

export function usePreparationRunner(subjectId: string, csrfToken: string) {
  const { mutateAsync } = usePreparationStepMutation();
  const [state, setState] = useState(initialState);
  const activeCodes = useRef(new Set<string>());

  const run = useCallback(async (
    target: PublishedAssessment | PreparationTarget,
    initialPreparation: Preparation | null = null,
  ): Promise<void> => {
    if (activeCodes.current.has(target.code)) return;
    activeCodes.current.add(target.code);
    globalThis.sessionStorage.setItem(activePreparationStorageKey, target.code);
    setState({ target, preparation: initialPreparation, error: null, running: true });
    let previousCount = initialPreparation?.generatedQuestionCount ?? -1;
    const maximumRequests = Math.ceil(target.rosterCount / 25) + 2;
    try {
      for (let requestCount = 0; requestCount < maximumRequests; requestCount += 1) {
        const preparation = await mutateAsync({ csrfToken, examCode: target.code, subjectId });
        setState({ target, preparation, error: null, running: preparation.status !== "ready" && preparation.status !== "failed" });
        if (preparation.status === "ready") {
          globalThis.sessionStorage.removeItem(activePreparationStorageKey);
          return;
        }
        if (preparation.status === "failed") return;
        if (preparation.generatedQuestionCount === previousCount) {
          throw new Error("PREPARATION_NO_PROGRESS");
        }
        previousCount = preparation.generatedQuestionCount;
      }
      throw new Error("PREPARATION_REQUEST_LIMIT_REACHED");
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("PREPARATION_FAILED");
      setState((current) => ({ ...current, error: failure, running: false }));
    } finally {
      activeCodes.current.delete(target.code);
    }
  }, [csrfToken, mutateAsync, subjectId]);

  const recover = useCallback((target: PreparationTarget, preparation: Preparation): void => {
    if (preparation.status === "ready") globalThis.sessionStorage.removeItem(activePreparationStorageKey);
    if (preparation.status === "ready" || preparation.status === "failed") {
      setState({ target, preparation, error: null, running: false });
      return;
    }
    void run(target, preparation);
  }, [run]);

  const clear = useCallback(() => {
    globalThis.sessionStorage.removeItem(activePreparationStorageKey);
    setState(initialState);
  }, []);
  return { clear, recover, run, state };
}
