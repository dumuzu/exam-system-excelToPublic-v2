export interface PublicTerminationFailure {
  readonly code: string;
  readonly message: string;
}

const PUBLIC_FAILURES: Readonly<Record<string, PublicTerminationFailure>> = Object.freeze({
  PAPER_NOT_PREPARED: Object.freeze({
    code: "PAPER_NOT_PREPARED",
    message: "The prepared answer sheet is incomplete.",
  }),
});

const DEFAULT_FAILURE = Object.freeze({
  code: "COLLECTION_PROCESSING_FAILED",
  message: "The answer sheet could not be collected safely.",
});

export function classifyTerminationFailure(error: unknown): PublicTerminationFailure {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
  const known = code === null ? null : PUBLIC_FAILURES[code];
  return { ...(known ?? DEFAULT_FAILURE) };
}
