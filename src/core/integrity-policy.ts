import type {
  AssessmentEventMode,
  IntegrityAction,
  IntegritySignalKind,
  Result,
} from "../platform/assessment-contracts.ts";

export const BROWSER_THREE_STRIKE_POLICY_ID = "browser_three_strike";
export const BROWSER_INTEGRITY_VIOLATION_LIMIT = 3;

export interface BrowserPreflight {
  readonly secureContext: boolean;
  readonly fullscreen: boolean;
  readonly localStorage: boolean;
  readonly visibility: boolean;
  readonly network: boolean;
  readonly browserSupported: boolean;
  readonly browserFamily: "chrome" | "edge" | "firefox" | "safari";
  readonly browserVersion: number;
}

export interface BrowserIntegritySignal {
  readonly kind: IntegritySignalKind;
  readonly sourceEventType: string;
  readonly observedAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface BrowserIntegrityState {
  readonly violationCount: number;
  readonly suspended: boolean;
}

export interface IntegrityAuditEvent {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly signalKind: IntegritySignalKind;
  readonly sourceEventType: string;
  readonly observedAt: string;
  readonly violationOrdinal: number;
  readonly decision: "warned" | "suspended";
  readonly details: Readonly<Record<string, unknown>>;
}

export interface BrowserIntegrityDecision {
  readonly state: BrowserIntegrityState;
  readonly actions: readonly IntegrityAction[];
  readonly auditEvent: IntegrityAuditEvent | null;
}

export interface IntegrityPolicyDescriptor {
  readonly id: string;
  readonly version: number;
  readonly supportedModes: readonly AssessmentEventMode[];
  readonly monitoredSignals: readonly IntegritySignalKind[];
}

export interface IntegrityPolicy<State, Signal, AuditEvent> {
  readonly descriptor: IntegrityPolicyDescriptor;
  evaluate(input: {
    readonly mode: AssessmentEventMode;
    readonly state: Readonly<State>;
    readonly signal: Readonly<Signal>;
  }): Readonly<{
    state: State;
    actions: readonly IntegrityAction[];
    auditEvent: AuditEvent | null;
  }>;
}

const preflightBooleanKeys = [
  "secureContext",
  "fullscreen",
  "localStorage",
  "visibility",
  "network",
  "browserSupported",
] as const;
const preflightKeys = [...preflightBooleanKeys, "browserFamily", "browserVersion"] as const;
const browserFamilies = new Set(["chrome", "edge", "firefox", "safari"]);

const signalDefinitions = Object.freeze({
  page_hidden: { kind: "focus_lost", details: {} },
  long_blur: { kind: "focus_lost", details: {} },
  fullscreen_exit: { kind: "fullscreen_exited", details: {} },
  copy_blocked: { kind: "clipboard_attempt", details: { operation: "copy" } },
  paste_blocked: { kind: "clipboard_attempt", details: { operation: "paste" } },
  refresh_attempt: { kind: "navigation_attempt", details: { operation: "refresh" } },
  preflight_failure: { kind: "browser_preflight_failed", details: {} },
} satisfies Record<string, { kind: IntegritySignalKind; details: Readonly<Record<string, unknown>> }>);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failure(code: string, message: string, details?: Readonly<Record<string, unknown>>): Result<never> {
  return details === undefined
    ? { ok: false, errors: [{ code, message }] }
    : { ok: false, errors: [{ code, message, details }] };
}

export function validateBrowserPreflight(value: unknown): Result<BrowserPreflight> {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !preflightKeys.includes(key as typeof preflightKeys[number]))
    || !preflightBooleanKeys.every((key) => typeof value[key] === "boolean")
    || typeof value["browserFamily"] !== "string"
    || !browserFamilies.has(value["browserFamily"])
    || typeof value["browserVersion"] !== "number"
    || !Number.isFinite(value["browserVersion"])
    || value["browserVersion"] < 1
    || value["browserVersion"] > 999) {
    return failure("INVALID_BROWSER_PREFLIGHT", "Browser preflight data is invalid.");
  }

  const failedCapabilities = preflightBooleanKeys.filter((key) => value[key] !== true);
  if (failedCapabilities.length > 0) {
    return failure("BROWSER_PREFLIGHT_FAILED", "The browser does not meet the required integrity capabilities.", {
      failedCapabilities,
    });
  }

  return {
    ok: true,
    value: Object.fromEntries(preflightKeys.map((key) => [key, value[key]])) as unknown as BrowserPreflight,
  };
}

export function normalizeBrowserIntegritySignal({
  eventType,
  observedAt,
}: {
  eventType: unknown;
  observedAt: unknown;
}): Result<BrowserIntegritySignal> {
  const definition = typeof eventType === "string"
    ? signalDefinitions[eventType as keyof typeof signalDefinitions]
    : undefined;
  if (!definition || typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) {
    return failure("INVALID_INTEGRITY_SIGNAL", "The browser integrity signal is invalid.");
  }
  return {
    ok: true,
    value: {
      kind: definition.kind,
      sourceEventType: eventType as string,
      observedAt,
      details: definition.details,
    },
  };
}

const browserThreeStrikeDescriptor = Object.freeze({
  id: BROWSER_THREE_STRIKE_POLICY_ID,
  version: 1,
  supportedModes: Object.freeze(["exam"] as const),
  monitoredSignals: Object.freeze([
    "browser_preflight_failed",
    "fullscreen_exited",
    "focus_lost",
    "clipboard_attempt",
    "navigation_attempt",
  ] as const),
});

export const browserThreeStrikeIntegrityPolicy = Object.freeze({
  descriptor: browserThreeStrikeDescriptor,

  evaluate({
    mode,
    state,
    signal,
  }: {
    mode: AssessmentEventMode;
    state: Readonly<BrowserIntegrityState>;
    signal: Readonly<BrowserIntegritySignal>;
  }): BrowserIntegrityDecision {
    if (!browserThreeStrikeDescriptor.supportedModes.includes(mode as "exam") || state.suspended) {
      return { state: { ...state }, actions: [], auditEvent: null };
    }
    // 每三次违规暂停一次；恢复后继续累计，保证审计序号不会回退。
    const violationCount = state.violationCount + 1;
    const suspended = violationCount % BROWSER_INTEGRITY_VIOLATION_LIMIT === 0;
    const decision = suspended ? "suspended" : "warned";
    return {
      state: { violationCount, suspended },
      actions: suspended ? ["record", "suspend"] : ["record", "warn"],
      auditEvent: {
        policyId: browserThreeStrikeDescriptor.id,
        policyVersion: browserThreeStrikeDescriptor.version,
        signalKind: signal.kind,
        sourceEventType: signal.sourceEventType,
        observedAt: signal.observedAt,
        violationOrdinal: violationCount,
        decision,
        details: signal.details,
      },
    };
  },
}) satisfies IntegrityPolicy<BrowserIntegrityState, BrowserIntegritySignal, IntegrityAuditEvent>;
