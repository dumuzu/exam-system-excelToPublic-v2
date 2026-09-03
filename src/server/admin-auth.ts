import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const sessionLifetimeSeconds = 2 * 60 * 60;
const passwordHashPrefix = "scrypt-v1";
const passwordKeyLength = 64;
const dummyPasswordHash = `scrypt-v1$00000000000000000000000000000000$${scryptSync(
  "invalid-administrator-password",
  "00000000000000000000000000000000",
  passwordKeyLength,
).toString("base64url")}`;

export const ADMIN_ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  TEACHER: "teacher",
  TEST_ADMIN: "test_admin",
  ASSISTANT_TEACHER: "assistant_teacher",
} as const);

export type AdminRole = typeof ADMIN_ROLES[keyof typeof ADMIN_ROLES];

export const ADMIN_PERMISSIONS = Object.freeze({
  VIEW_DASHBOARD: "view_dashboard",
  COMPOSE_EXAM: "compose_exam",
  VIEW_ROOM: "view_room",
  MANAGE_ADMISSION: "manage_admission",
  AUTHORIZE_RESUME: "authorize_resume",
  AUTHORIZE_RETAKE: "authorize_retake",
  VIEW_RESULTS: "view_results",
  EXPORT_RESULTS: "export_results",
  ADJUST_GRADES: "adjust_grades",
  TERMINATE_EXAM: "terminate_exam",
  DELETE_EXAM: "delete_exam",
  MANAGE_ACCOUNTS: "manage_accounts",
} as const);

export type AdminPermission = typeof ADMIN_PERMISSIONS[keyof typeof ADMIN_PERMISSIONS];

const allAdminPermissions = Object.freeze(Object.values(ADMIN_PERMISSIONS));
const subjectScopedAdminPermissions = Object.freeze(
  allAdminPermissions.filter((permission) => permission !== ADMIN_PERMISSIONS.MANAGE_ACCOUNTS),
);
const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = Object.freeze({
  [ADMIN_ROLES.SUPER_ADMIN]: allAdminPermissions,
  // Subject and ownership checks are applied separately by authorization-policy.
  [ADMIN_ROLES.TEACHER]: subjectScopedAdminPermissions,
  // These two roles are retained only for the documented environment-account
  // transition and isolated development compatibility.
  [ADMIN_ROLES.TEST_ADMIN]: allAdminPermissions,
  [ADMIN_ROLES.ASSISTANT_TEACHER]: Object.freeze([
    ADMIN_PERMISSIONS.VIEW_DASHBOARD,
    ADMIN_PERMISSIONS.VIEW_ROOM,
    ADMIN_PERMISSIONS.MANAGE_ADMISSION,
    ADMIN_PERMISSIONS.AUTHORIZE_RESUME,
  ]),
});

const VALID_ROLES = new Set<AdminRole>(Object.values(ADMIN_ROLES));

export interface LegacyAdminAccount {
  username: string;
  passwordHash: string;
  role: AdminRole;
}

export interface AdminAuthConfig {
  sessionSecret: string;
  accounts?: LegacyAdminAccount[];
  adminUsername?: string;
  adminPassword?: string;
}

export interface PublicAdminAccount {
  username: string;
  role: AdminRole;
}

export interface VersionedAdminAccount extends PublicAdminAccount {
  accountId: string;
  credentialVersion: number;
  sessionVersion: number;
}

export interface PersistedAuthenticationAccount {
  id: string;
  username: string;
  displayName?: string;
  passwordHash: string | null;
  role: AdminRole;
  status: "migration_pending" | "active" | "disabled";
  credentialVersion: number;
  sessionVersion: number;
}

export interface AuthenticationAccountReader {
  findAuthenticationAccount(username: string): Promise<PersistedAuthenticationAccount | null>;
}

export interface PersistedSessionAccount {
  id: string;
  username: string;
  role: AdminRole;
  status: "migration_pending" | "active" | "disabled";
  credentialVersion: number;
  sessionVersion: number;
}

export interface SessionAccountReader {
  findSessionAccount(accountId: string): Promise<PersistedSessionAccount | null>;
}

export interface AdminSessionPayload {
  aid: string;
  sub: string;
  role: AdminRole;
  cv: number;
  sv: number;
  csrf: string;
  exp: number;
}

type Environment = Record<string, string | undefined>;

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left: unknown, right: unknown): boolean {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

function publicAccount(account: LegacyAdminAccount): PublicAdminAccount {
  return { username: account.username, role: account.role };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function validAccount(account: unknown): account is LegacyAdminAccount {
  return isRecord(account)
    && typeof account["username"] === "string"
    && account["username"].trim().length > 0
    && account["username"].length <= 100
    && isAdminPasswordHash(account["passwordHash"])
    && VALID_ROLES.has(account["role"] as AdminRole);
}

export function isAdminPasswordHash(value: unknown): value is string {
  return typeof value === "string"
    && /^scrypt-v1[$][0-9a-f]{32,128}[$][A-Za-z0-9_-]{86}$/i.test(value);
}

export function hashAdminPassword(
  password: string,
  { salt = randomBytes(16).toString("hex") }: { salt?: string } = {},
): string {
  if (typeof password !== "string" || password.length === 0 || password.length > 200) {
    throw new TypeError("Administrator password must contain 1-200 characters.");
  }
  if (typeof salt !== "string" || !/^[0-9a-f]{32,128}$/i.test(salt)) {
    throw new TypeError("Password salt must be a 16-64 byte hexadecimal string.");
  }
  const derived = scryptSync(password, salt, passwordKeyLength).toString("base64url");
  return `${passwordHashPrefix}$${salt.toLowerCase()}$${derived}`;
}

export function verifyAdminPassword(password: unknown, encodedHash: unknown): boolean {
  if (typeof password !== "string" || typeof encodedHash !== "string") return false;
  const [prefix, salt, expected, ...extra] = encodedHash.split("$");
  if (prefix !== passwordHashPrefix || !salt || !expected || extra.length > 0) return false;
  try {
    const candidate = scryptSync(password, salt, passwordKeyLength).toString("base64url");
    return safeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function parsePayload(token: unknown, sessionSecret: string): AdminSessionPayload | null {
  if (typeof token !== "string") return null;
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const payloadPart = token.slice(0, separatorIndex);
  const signaturePart = token.slice(separatorIndex + 1);
  if (!safeEqual(sign(payloadPart, sessionSecret), signaturePart)) return null;

  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    if (!isRecord(payload)) return null;
    if (typeof payload["aid"] !== "string" || typeof payload["sub"] !== "string" || typeof payload["csrf"] !== "string") return null;
    if (!VALID_ROLES.has(payload["role"] as AdminRole)) return null;
    if (!Number.isInteger(payload["cv"]) || Number(payload["cv"]) < 1) return null;
    if (!Number.isInteger(payload["sv"]) || Number(payload["sv"]) < 1) return null;
    if (!Number.isInteger(payload["exp"]) || Number(payload["exp"]) <= Math.floor(Date.now() / 1000)) return null;
    return payload as unknown as AdminSessionPayload;
  } catch {
    return null;
  }
}

export function getAuthConfigFromEnvironment(environment: Environment = process.env): AdminAuthConfig | null {
  const sessionSecret = environment["SESSION_SECRET"];
  if (!sessionSecret || sessionSecret.length < 32) return null;

  if (environment["ADMIN_ACCOUNTS_JSON"]) {
    try {
      const parsed: unknown = JSON.parse(environment["ADMIN_ACCOUNTS_JSON"]);
      if (!Array.isArray(parsed)) return null;
      const testAccountEnabled = String(environment["ENABLE_TEST_ADMIN"]).toLowerCase() === "true";
      const accounts = parsed
        .filter(validAccount)
        .filter((account) => account.role !== ADMIN_ROLES.TEST_ADMIN || testAccountEnabled)
        .map(publicAccountDetails);
      if (accounts.length === 0 || new Set(accounts.map((account) => normalizeUsername(account.username))).size !== accounts.length) return null;
      return { accounts, sessionSecret };
    } catch {
      return null;
    }
  }

  const adminUsername = environment["ADMIN_USERNAME"];
  const adminPassword = environment["ADMIN_PASSWORD"];
  if (adminUsername && adminPassword) return { adminUsername, adminPassword, sessionSecret };

  // PostgreSQL-backed teacher accounts need only the signing secret at runtime.
  return environment["DATABASE_URL"] ? { sessionSecret } : null;
}

function publicAccountDetails(account: LegacyAdminAccount): LegacyAdminAccount {
  return { username: account.username.trim(), passwordHash: account.passwordHash, role: account.role };
}

export function getLegacyAccounts(authConfig: AdminAuthConfig | null): LegacyAdminAccount[] {
  if (!authConfig) return [];
  if (Array.isArray(authConfig.accounts)) return authConfig.accounts.map(publicAccountDetails);
  if (authConfig.adminUsername && authConfig.adminPassword) {
    return [{
      username: authConfig.adminUsername.trim(),
      passwordHash: hashAdminPassword(authConfig.adminPassword),
      role: ADMIN_ROLES.SUPER_ADMIN,
    }];
  }
  return [];
}

export function createAdminSession({
  account,
  username,
  role = ADMIN_ROLES.SUPER_ADMIN,
  sessionSecret,
}: {
  account?: Partial<VersionedAdminAccount> & PublicAdminAccount | null;
  username?: string;
  role?: AdminRole;
  sessionSecret: string;
}): { token: string; csrfToken: string } {
  const resolvedAccount = account ?? (username ? { username, role } : null);
  if (!resolvedAccount?.username || !VALID_ROLES.has(resolvedAccount.role)) {
    throw new TypeError("A valid administrator account is required.");
  }
  const csrfToken = randomBytes(32).toString("base64url");
  const payload: AdminSessionPayload = {
    aid: resolvedAccount.accountId ?? `legacy:${normalizeUsername(resolvedAccount.username)}`,
    sub: resolvedAccount.username,
    role: resolvedAccount.role,
    cv: resolvedAccount.credentialVersion ?? 1,
    sv: resolvedAccount.sessionVersion ?? 1,
    csrf: csrfToken,
    exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds,
  };
  const payloadPart = base64Url(JSON.stringify(payload));
  return { token: `${payloadPart}.${sign(payloadPart, sessionSecret)}`, csrfToken };
}

export function verifyAdminSession(token: unknown, authConfig: AdminAuthConfig | null): AdminSessionPayload | null {
  if (!authConfig) return null;
  const session = parsePayload(token, authConfig.sessionSecret);
  if (!session) return null;
  if (Array.isArray(authConfig.accounts)) {
    const accountStillEnabled = authConfig.accounts.some(
      (account) => safeEqual(account.username, session.sub) && account.role === session.role,
    );
    return accountStillEnabled ? session : null;
  }
  return safeEqual(session.sub, authConfig.adminUsername) && session.role === ADMIN_ROLES.SUPER_ADMIN
    ? session
    : null;
}

export async function verifyPersistedAdminSession(
  token: unknown,
  authConfig: AdminAuthConfig | null,
  repository: SessionAccountReader,
): Promise<AdminSessionPayload | null> {
  if (!authConfig) return null;
  const session = parsePayload(token, authConfig.sessionSecret);
  if (!session) return null;
  const account = await repository.findSessionAccount(session.aid);
  if (!account || account.status !== "active") return null;
  return safeEqual(account.id, session.aid)
    && safeEqual(account.username, session.sub)
    && account.role === session.role
    && account.credentialVersion === session.cv
    && account.sessionVersion === session.sv
    ? session
    : null;
}

export function verifyAdminCredentials(
  { username, password }: { username?: unknown; password?: unknown },
  authConfig: AdminAuthConfig | null,
): PublicAdminAccount | null {
  if (!authConfig || typeof username !== "string" || typeof password !== "string") return null;
  if (Array.isArray(authConfig.accounts)) {
    const account = authConfig.accounts.find((candidate) => safeEqual(username, candidate.username));
    return account && verifyAdminPassword(password, account.passwordHash) ? publicAccount(account) : null;
  }
  return safeEqual(username, authConfig.adminUsername) && safeEqual(password, authConfig.adminPassword)
    ? { username: authConfig.adminUsername as string, role: ADMIN_ROLES.SUPER_ADMIN }
    : null;
}

export async function verifyPersistedAdminCredentials(
  { username, password }: { username?: unknown; password?: unknown },
  repository: AuthenticationAccountReader,
): Promise<VersionedAdminAccount | null> {
  const lookupUsername = typeof username === "string" ? username.trim() : "";
  const account = lookupUsername ? await repository.findAuthenticationAccount(lookupUsername) : null;
  const passwordMatches = verifyAdminPassword(
    typeof password === "string" ? password : "",
    account?.passwordHash ?? dummyPasswordHash,
  );
  if (!account || account.status !== "active" || !passwordMatches || !VALID_ROLES.has(account.role)) return null;
  return {
    accountId: account.id,
    username: account.username,
    role: account.role,
    credentialVersion: account.credentialVersion,
    sessionVersion: account.sessionVersion,
  };
}

export function createLoginRateLimitKey(scope: "ip" | "account", value: string, secret: string): string {
  return createHmac("sha256", secret).update(`${scope}:${value}`).digest("base64url");
}

export function getAdminPermissions(role: AdminRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function hasAdminPermission(
  session: { role?: AdminRole } | null | undefined,
  permission: AdminPermission,
): boolean {
  return Boolean(session?.role && ROLE_PERMISSIONS[session.role]?.includes(permission));
}

export function verifyCsrfToken(candidate: unknown, session: { csrf?: string } | null | undefined): boolean {
  return typeof candidate === "string" && typeof session?.csrf === "string" && safeEqual(candidate, session.csrf);
}

export function createLoginRateLimiter({
  limit = 5,
  windowMilliseconds = 15 * 60 * 1000,
  maxTrackedKeys = 1_000,
}: {
  limit?: number;
  windowMilliseconds?: number;
  maxTrackedKeys?: number;
} = {}) {
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  const boundedTrackedKeyLimit = Number.isSafeInteger(maxTrackedKeys) && maxTrackedKeys > 0
    ? maxTrackedKeys
    : 1_000;

  function removeExpiredAttempts(now: number): void {
    for (const [key, attempt] of attempts) {
      if (attempt.expiresAt <= now) attempts.delete(key);
    }
  }

  function makeSpaceForNewKey(): void {
    if (attempts.size < boundedTrackedKeyLimit) return;
    const oldestKey = attempts.keys().next().value;
    if (oldestKey !== undefined) attempts.delete(oldestKey);
  }

  return {
    check(key: string) {
      const now = Date.now();
      removeExpiredAttempts(now);
      const current = attempts.get(key);
      if (!current) {
        makeSpaceForNewKey();
        attempts.set(key, { count: 1, expiresAt: now + windowMilliseconds });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (current.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.ceil((current.expiresAt - now) / 1000) };
      }

      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset(key: string) {
      attempts.delete(key);
    },
  };
}

export function serializeSessionCookie(token: string, { secure = false }: { secure?: boolean } = {}): string {
  return [
    `admin_session=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${sessionLifetimeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function serializeExpiredSessionCookie({ secure = false }: { secure?: boolean } = {}): string {
  return [
    "admin_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
