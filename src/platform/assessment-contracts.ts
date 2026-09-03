export type AssessmentEventMode = "exam" | "assignment";

export interface ContractError {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type Result<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; errors: readonly ContractError[] }>;

export interface StudentWorkspaceCapabilities {
  readonly responseKind: string;
  readonly automaticGrading: boolean;
}

export type PaperPreparationScope =
  | Readonly<{ kind: "participant"; participantKey: string }>
  | Readonly<{ kind: "shared" }>;

export type IntegritySignalKind =
  | "browser_preflight_failed"
  | "fullscreen_exited"
  | "focus_lost"
  | "clipboard_attempt"
  | "navigation_attempt";

export type IntegrityAction = "record" | "warn" | "suspend";
