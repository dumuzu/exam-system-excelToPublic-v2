export interface CapacityPolicy {
  readonly databasePoolMax: number;
  readonly historyListLimit: number;
  readonly inMemoryHistoryRecordLimit: number;
  readonly maxRequestBodyBytes: number;
  readonly maxRosterRequestBodyBytes: number;
  readonly maxAuthoringRequestBodyBytes: number;
  readonly maxSubmissionRequestBodyBytes: number;
  readonly loginRateLimit: number;
  readonly loginRateWindowMilliseconds: number;
  readonly loginRateTrackedKeyLimit: number;
}

type CapacityEnvironment = Readonly<Record<string, string | undefined>>;
type IntegerBounds = Readonly<{ minimum: number; maximum: number }>;

const DEFAULT_CAPACITY_POLICY: CapacityPolicy = Object.freeze({
  databasePoolMax: 4,
  historyListLimit: 100,
  inMemoryHistoryRecordLimit: 200,
  maxRequestBodyBytes: 64 * 1024,
  maxRosterRequestBodyBytes: 256 * 1024,
  maxAuthoringRequestBodyBytes: 4 * 1024 * 1024,
  maxSubmissionRequestBodyBytes: 1280 * 1024,
  loginRateLimit: 5,
  loginRateWindowMilliseconds: 15 * 60 * 1000,
  loginRateTrackedKeyLimit: 1_000,
});

const CAPACITY_BOUNDS = Object.freeze({
  databasePoolMax: { minimum: 1, maximum: 10 },
  historyListLimit: { minimum: 1, maximum: 200 },
  inMemoryHistoryRecordLimit: { minimum: 1, maximum: 500 },
  maxRequestBodyBytes: { minimum: 8 * 1024, maximum: 256 * 1024 },
  maxRosterRequestBodyBytes: { minimum: 64 * 1024, maximum: 256 * 1024 },
  maxAuthoringRequestBodyBytes: { minimum: 256 * 1024, maximum: 4 * 1024 * 1024 },
  maxSubmissionRequestBodyBytes: { minimum: 64 * 1024, maximum: 2 * 1024 * 1024 },
  loginRateLimit: { minimum: 1, maximum: 20 },
  loginRateWindowMilliseconds: { minimum: 60 * 1000, maximum: 60 * 60 * 1000 },
  loginRateTrackedKeyLimit: { minimum: 100, maximum: 10_000 },
});

function readBoundedInteger(value: unknown, fallback: number, { minimum, maximum }: IntegerBounds): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

/**
 * Normalises a policy injected by application composition or tests. This keeps
 * a malformed dependency from bypassing the same limits enforced for .env.
 */
export function normalizeCapacityPolicy(policy: unknown = {}): CapacityPolicy {
  const source: Record<string, unknown> = policy && typeof policy === "object" ? policy as Record<string, unknown> : {};

  return Object.freeze({
    databasePoolMax: readBoundedInteger(
      source["databasePoolMax"],
      DEFAULT_CAPACITY_POLICY.databasePoolMax,
      CAPACITY_BOUNDS.databasePoolMax,
    ),
    historyListLimit: readBoundedInteger(
      source["historyListLimit"],
      DEFAULT_CAPACITY_POLICY.historyListLimit,
      CAPACITY_BOUNDS.historyListLimit,
    ),
    inMemoryHistoryRecordLimit: readBoundedInteger(
      source["inMemoryHistoryRecordLimit"],
      DEFAULT_CAPACITY_POLICY.inMemoryHistoryRecordLimit,
      CAPACITY_BOUNDS.inMemoryHistoryRecordLimit,
    ),
    maxRequestBodyBytes: readBoundedInteger(
      source["maxRequestBodyBytes"],
      DEFAULT_CAPACITY_POLICY.maxRequestBodyBytes,
      CAPACITY_BOUNDS.maxRequestBodyBytes,
    ),
    maxRosterRequestBodyBytes: readBoundedInteger(
      source["maxRosterRequestBodyBytes"],
      DEFAULT_CAPACITY_POLICY.maxRosterRequestBodyBytes,
      CAPACITY_BOUNDS.maxRosterRequestBodyBytes,
    ),
    maxAuthoringRequestBodyBytes: readBoundedInteger(
      source["maxAuthoringRequestBodyBytes"],
      DEFAULT_CAPACITY_POLICY.maxAuthoringRequestBodyBytes,
      CAPACITY_BOUNDS.maxAuthoringRequestBodyBytes,
    ),
    maxSubmissionRequestBodyBytes: readBoundedInteger(
      source["maxSubmissionRequestBodyBytes"],
      DEFAULT_CAPACITY_POLICY.maxSubmissionRequestBodyBytes,
      CAPACITY_BOUNDS.maxSubmissionRequestBodyBytes,
    ),
    loginRateLimit: readBoundedInteger(
      source["loginRateLimit"],
      DEFAULT_CAPACITY_POLICY.loginRateLimit,
      CAPACITY_BOUNDS.loginRateLimit,
    ),
    loginRateWindowMilliseconds: readBoundedInteger(
      source["loginRateWindowMilliseconds"],
      DEFAULT_CAPACITY_POLICY.loginRateWindowMilliseconds,
      CAPACITY_BOUNDS.loginRateWindowMilliseconds,
    ),
    loginRateTrackedKeyLimit: readBoundedInteger(
      source["loginRateTrackedKeyLimit"],
      DEFAULT_CAPACITY_POLICY.loginRateTrackedKeyLimit,
      CAPACITY_BOUNDS.loginRateTrackedKeyLimit,
    ),
  });
}

/**
 * Central runtime capacity policy. The returned object is the only capacity
 * interface consumed by HTTP, authentication, and PostgreSQL adapters.
 */
export function getCapacityPolicyFromEnvironment(environment: CapacityEnvironment = process.env): CapacityPolicy {
  const databasePoolMax = readBoundedInteger(
    environment["DATABASE_POOL_MAX"],
    DEFAULT_CAPACITY_POLICY.databasePoolMax,
    CAPACITY_BOUNDS.databasePoolMax,
  );
  const historyListLimit = readBoundedInteger(
    environment["HISTORY_LIST_LIMIT"],
    DEFAULT_CAPACITY_POLICY.historyListLimit,
    CAPACITY_BOUNDS.historyListLimit,
  );
  const inMemoryHistoryRecordLimit = readBoundedInteger(
    environment["IN_MEMORY_HISTORY_RECORD_LIMIT"],
    DEFAULT_CAPACITY_POLICY.inMemoryHistoryRecordLimit,
    CAPACITY_BOUNDS.inMemoryHistoryRecordLimit,
  );
  const maxRequestBodyKilobytes = readBoundedInteger(
    environment["MAX_REQUEST_BODY_KB"],
    DEFAULT_CAPACITY_POLICY.maxRequestBodyBytes / 1024,
    { minimum: 8, maximum: 256 },
  );
  const maxRosterRequestBodyKilobytes = readBoundedInteger(
    environment["MAX_ROSTER_REQUEST_BODY_KB"],
    DEFAULT_CAPACITY_POLICY.maxRosterRequestBodyBytes / 1024,
    { minimum: 64, maximum: 256 },
  );
  const maxAuthoringRequestBodyKilobytes = readBoundedInteger(
    environment["MAX_AUTHORING_REQUEST_BODY_KB"],
    DEFAULT_CAPACITY_POLICY.maxAuthoringRequestBodyBytes / 1024,
    { minimum: 256, maximum: 4096 },
  );
  const maxSubmissionRequestBodyKilobytes = readBoundedInteger(
    environment["MAX_SUBMISSION_REQUEST_BODY_KB"],
    DEFAULT_CAPACITY_POLICY.maxSubmissionRequestBodyBytes / 1024,
    { minimum: 64, maximum: 2048 },
  );
  const loginRateLimit = readBoundedInteger(
    environment["LOGIN_RATE_LIMIT"],
    DEFAULT_CAPACITY_POLICY.loginRateLimit,
    CAPACITY_BOUNDS.loginRateLimit,
  );
  const loginRateWindowSeconds = readBoundedInteger(
    environment["LOGIN_RATE_WINDOW_SECONDS"],
    DEFAULT_CAPACITY_POLICY.loginRateWindowMilliseconds / 1000,
    { minimum: 60, maximum: 3600 },
  );
  const loginRateTrackedKeyLimit = readBoundedInteger(
    environment["LOGIN_RATE_TRACKED_KEY_LIMIT"],
    DEFAULT_CAPACITY_POLICY.loginRateTrackedKeyLimit,
    CAPACITY_BOUNDS.loginRateTrackedKeyLimit,
  );

  return normalizeCapacityPolicy({
    databasePoolMax,
    historyListLimit,
    inMemoryHistoryRecordLimit,
    maxRequestBodyBytes: maxRequestBodyKilobytes * 1024,
    maxRosterRequestBodyBytes: maxRosterRequestBodyKilobytes * 1024,
    maxAuthoringRequestBodyBytes: maxAuthoringRequestBodyKilobytes * 1024,
    maxSubmissionRequestBodyBytes: maxSubmissionRequestBodyKilobytes * 1024,
    loginRateLimit,
    loginRateWindowMilliseconds: loginRateWindowSeconds * 1000,
    loginRateTrackedKeyLimit,
  });
}

export { DEFAULT_CAPACITY_POLICY };
