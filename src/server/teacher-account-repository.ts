import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import type {
  AccountMembershipItem,
  AccountMembership,
  AccountPage as SharedAccountPage,
  CreateSubjectBody,
  ManagedAccount,
  ManagedAccountStatus as SharedManagedAccountStatus,
  ManagedPlatformRole,
  ManagedSubject,
  ManagedSubjectStatus,
  SubjectSettingsBody,
} from "../types/contracts/account-administration.ts";
import { isAdminPasswordHash } from "./admin-auth.ts";
import { normalizeCapacityPolicy } from "./capacity-policy.ts";
import type {
  AdminRole,
  LegacyAdminAccount,
  PersistedAuthenticationAccount,
  PersistedSessionAccount,
} from "./admin-auth.ts";
import type { SubjectMembershipContext, SubjectRole } from "./authorization-policy.ts";

const require = createRequire(import.meta.url);
const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => PoolLike };
export const DEFAULT_EXCEL_SUBJECT_ID = "00000000-0000-4000-8000-000000000023";
export type PersistedPlatformRole = ManagedPlatformRole;
export type ManagedAccountStatus = Exclude<SharedManagedAccountStatus, "migration_pending">;
export type PublicSubjectMembership = AccountMembership;
export type PublicTeacherAccount = ManagedAccount;
export type PublicSubject = ManagedSubject;
export type AccountPage = SharedAccountPage;
type StoredSubject = Omit<PublicSubject, "membershipCount">;
type SubjectSeed = Omit<PublicSubject, "assessmentTypeKeys" | "nameEn" | "studentLocale" | "status" | "membershipCount">
  & { assessmentTypeKey?: string; assessmentTypeKeys?: PublicSubject["assessmentTypeKeys"] }
  & Partial<Pick<PublicSubject, "nameEn" | "studentLocale" | "status" | "membershipCount">>;

export interface AccountMutationContext {
  actorAccountId: string;
  accountId: string;
}

export interface LoginRateLimitRequest {
  ipKey: string;
  accountKey: string;
  limit: number;
  windowMilliseconds: number;
  maxTrackedKeys: number;
}

export interface LoginRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface TeacherAccountRepository {
  readonly storageMode: "memory-legacy-auth" | "postgresql";
  findAuthenticationAccount(username: string): Promise<PersistedAuthenticationAccount | null>;
  findSessionAccount(accountId: string): Promise<PersistedSessionAccount | null>;
  consumeLoginRateLimit(request: LoginRateLimitRequest): Promise<LoginRateLimitResult>;
  resetLoginRateLimit(keys: { ipKey: string; accountKey: string }): Promise<void>;
  listActiveSubjectMemberships(accountId: string): Promise<SubjectMembershipContext[]>;
  listAccounts(options: { page: number; pageSize: number }): Promise<AccountPage>;
  listSubjects(options?: { includeArchived?: boolean }): Promise<PublicSubject[]>;
  createSubject(input: { actorAccountId: string } & CreateSubjectBody): Promise<PublicSubject>;
  createAccount(input: {
    actorAccountId: string;
    username: string;
    displayName: string;
    passwordHash: string;
    platformRole: PersistedPlatformRole;
  }): Promise<PublicTeacherAccount>;
  setAccountStatus(input: AccountMutationContext & { status: ManagedAccountStatus }): Promise<PublicTeacherAccount>;
  setPlatformRole(input: AccountMutationContext & { platformRole: PersistedPlatformRole }): Promise<PublicTeacherAccount>;
  resetAccountPassword(input: AccountMutationContext & { passwordHash: string }): Promise<PublicTeacherAccount>;
  assignSubjectMembership(input: AccountMutationContext & { subjectId: string; subjectRole: SubjectRole }): Promise<PublicTeacherAccount>;
  assignSubjectMemberships(input: AccountMutationContext & { memberships: readonly AccountMembershipItem[] }): Promise<PublicTeacherAccount>;
  updateSubjectSettings(input: {
    actorAccountId: string;
    subjectId: string;
    nameJa: string;
    nameZh: string;
    nameEn: string;
    studentLocale: SubjectSettingsBody["studentLocale"];
    assessmentTypeKeys: SubjectSettingsBody["assessmentTypeKeys"];
  }): Promise<PublicSubject>;
  setSubjectStatus(input: {
    actorAccountId: string;
    subjectId: string;
    status: ManagedSubjectStatus;
  }): Promise<PublicSubject>;
  recordAuthorizationAudit(event: AuthorizationAuditEvent): Promise<void>;
  migrateLegacyAccounts(accounts: LegacyAdminAccount[]): Promise<{ imported: number }>;
  close(): Promise<void>;
}

export interface AuthorizationAuditEvent {
  actorAccountId: string;
  action: string;
  subjectId: string | null;
  resourceType: string;
  resourceId: string;
  decisionCode: string;
}

interface StoredMembership extends SubjectMembershipContext {
  accountId: string;
  status: "active" | "revoked";
}

interface QueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
}

interface PoolClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  release(): void;
}

interface PoolLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

interface StoredAccount extends PersistedAuthenticationAccount {
  displayName: string;
}

interface AccountAdministrationError extends Error {
  code: string;
  statusCode: number;
}

interface RateEntry {
  count: number;
  expiresAt: number;
}

interface AccountRow extends Record<string, unknown> {
  id: string;
  username: string;
  display_name: string;
  password_hash: string | null;
  role: AdminRole;
  status: StoredAccount["status"];
  credential_version: number;
  session_version: number;
}

interface PublicAccountRow extends Record<string, unknown> {
  id: string;
  username: string;
  display_name: string;
  platform_role: PersistedPlatformRole;
  account_status: PersistedAuthenticationAccount["status"];
  memberships: PublicSubjectMembership[] | null;
  total_count?: number;
}

interface ManagedAccountRow extends Record<string, unknown> {
  id: string;
  username: string;
  display_name: string;
  platform_role: PersistedPlatformRole;
  account_status: PersistedAuthenticationAccount["status"];
}

interface SubjectRow extends Record<string, unknown> {
  id: string;
  subject_code: string;
  name_ja: string;
  name_zh: string;
  name_en: string | null;
  student_locale: PublicSubject["studentLocale"];
  assessment_type_key: string;
  assessment_type_keys: PublicSubject["assessmentTypeKeys"] | null;
  subject_status: ManagedSubjectStatus;
  membership_count: string | number;
}

interface RateRow extends Record<string, unknown> {
  attempt_count: number;
  retry_after_seconds: number;
}

function canonicalUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

function managedAssessmentTypeKeys(
  keys: readonly string[] | null,
  fallback: string,
): PublicSubject["assessmentTypeKeys"] {
  const candidates = keys?.length ? keys : [fallback];
  if (!candidates.every((key) => key === "excel_formula" || key === "manual_questions")) {
    throw new Error("Subject contains an unsupported authoring capability.");
  }
  return [...candidates] as PublicSubject["assessmentTypeKeys"];
}

function administrationError(code: string, message: string, statusCode = 409): AccountAdministrationError {
  const error = new Error(message) as AccountAdministrationError;
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requirePasswordHash(passwordHash: string): void {
  if (!isAdminPasswordHash(passwordHash)) {
    throw administrationError("INVALID_PASSWORD_HASH", "A valid password hash is required.", 422);
  }
}

function legacyAccountId(username: string): string {
  return `legacy:${canonicalUsername(username)}`;
}

function mapAccountRow(row: AccountRow): StoredAccount {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    credentialVersion: Number(row.credential_version),
    sessionVersion: Number(row.session_version),
  };
}

export class InMemoryTeacherAccountRepository implements TeacherAccountRepository {
  readonly storageMode = "memory-legacy-auth" as const;
  readonly #accountsByCanonicalUsername = new Map<string, StoredAccount>();
  readonly #accountsById = new Map<string, StoredAccount>();
  readonly #rateEntries = new Map<string, RateEntry>();
  readonly #memberships: StoredMembership[] = [];
  readonly #subjects = new Map<string, StoredSubject>();
  readonly #authorizationAudit: Array<AuthorizationAuditEvent & { recordedAt: string }> = [];

  constructor({
    legacyAccounts = [],
    accounts = [],
    memberships = [],
    subjects = [],
  }: {
    legacyAccounts?: LegacyAdminAccount[];
    accounts?: StoredAccount[];
    memberships?: StoredMembership[];
    subjects?: SubjectSeed[];
  } = {}) {
    this.#subjects.set(DEFAULT_EXCEL_SUBJECT_ID, {
      id: DEFAULT_EXCEL_SUBJECT_ID,
      code: "excel-applications",
      nameJa: "表計算演習",
      nameZh: "电子表格练习",
      nameEn: "Spreadsheet Practice",
      studentLocale: "legacy_bilingual",
      assessmentTypeKeys: ["excel_formula"],
      status: "active",
    });
    for (const subject of subjects) {
      const { assessmentTypeKey, assessmentTypeKeys, ...subjectFields } = subject;
      this.#subjects.set(subject.id, {
        ...subjectFields,
        assessmentTypeKeys: assessmentTypeKeys ?? [
          assessmentTypeKey === "excel_formula" ? "excel_formula" : "manual_questions",
        ],
        nameEn: subject.nameEn ?? null,
        studentLocale: subject.studentLocale ?? "legacy_bilingual",
        status: subject.status ?? "active",
      });
    }
    this.#memberships.push(...memberships.map((membership) => ({ ...membership })));
    for (const account of accounts) this.#storeAccount(account);
    for (const account of legacyAccounts) {
      this.#storeAccount({
        id: legacyAccountId(account.username),
        username: account.username,
        displayName: account.username,
        passwordHash: account.passwordHash,
        role: account.role,
        status: "active",
        credentialVersion: 1,
        sessionVersion: 1,
      });
      const accountId = legacyAccountId(account.username);
      if (!this.#memberships.some((membership) => membership.accountId === accountId && membership.subjectId === DEFAULT_EXCEL_SUBJECT_ID)) {
        this.#memberships.push({
          accountId,
          subjectId: DEFAULT_EXCEL_SUBJECT_ID,
          subjectCode: "excel-applications",
          subjectName: "电子表格练习",
          subjectRole: account.role === "super_admin"
            ? "subject_admin"
            : account.role === "assistant_teacher"
              ? "proctor"
              : "teacher",
          status: "active",
        });
      }
    }
  }

  #storeAccount(account: StoredAccount): void {
    const copy = { ...account };
    this.#accountsByCanonicalUsername.set(canonicalUsername(copy.username), copy);
    this.#accountsById.set(copy.id, copy);
  }

  async findAuthenticationAccount(username: string): Promise<StoredAccount | null> {
    return this.#accountsByCanonicalUsername.get(canonicalUsername(username)) ?? null;
  }

  async findSessionAccount(accountId: string): Promise<StoredAccount | null> {
    return this.#accountsById.get(accountId) ?? null;
  }

  #consumeOne(key: string, request: LoginRateLimitRequest, now: number): RateEntry {
    for (const [trackedKey, entry] of this.#rateEntries) {
      if (entry.expiresAt <= now) this.#rateEntries.delete(trackedKey);
    }
    const current = this.#rateEntries.get(key);
    if (!current) {
      while (this.#rateEntries.size >= request.maxTrackedKeys) {
        const oldest = this.#rateEntries.keys().next().value;
        if (oldest === undefined) break;
        this.#rateEntries.delete(oldest);
      }
      const created = { count: 1, expiresAt: now + request.windowMilliseconds };
      this.#rateEntries.set(key, created);
      return created;
    }
    current.count += 1;
    return current;
  }

  async consumeLoginRateLimit(request: LoginRateLimitRequest): Promise<LoginRateLimitResult> {
    const now = Date.now();
    const ip = this.#consumeOne(`ip:${request.ipKey}`, request, now);
    const account = this.#consumeOne(`account:${request.accountKey}`, request, now);
    const blocked = ip.count > request.limit || account.count > request.limit;
    return {
      allowed: !blocked,
      retryAfterSeconds: blocked
        ? Math.max(1, Math.ceil((Math.max(ip.expiresAt, account.expiresAt) - now) / 1000))
        : 0,
    };
  }

  async resetLoginRateLimit({ ipKey, accountKey }: { ipKey: string; accountKey: string }): Promise<void> {
    this.#rateEntries.delete(`ip:${ipKey}`);
    this.#rateEntries.delete(`account:${accountKey}`);
  }

  async listActiveSubjectMemberships(accountId: string): Promise<SubjectMembershipContext[]> {
    return this.#memberships
      .filter((membership) => (
        membership.accountId === accountId
        && membership.status === "active"
        && this.#subjects.get(membership.subjectId)?.status !== "archived"
      ))
      .map(({ subjectId, subjectCode, subjectName, subjectRole }) => ({ subjectId, subjectCode, subjectName, subjectRole }));
  }

  #publicAccount(account: StoredAccount): PublicTeacherAccount {
    return {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      platformRole: account.role === "super_admin" ? "super_admin" : "teacher",
      status: account.status,
      memberships: this.#memberships
        .filter((membership) => membership.accountId === account.id && membership.status === "active")
        .map(({ subjectId, subjectCode, subjectName, subjectRole }) => ({ subjectId, subjectCode, subjectName, subjectRole })),
    };
  }

  #requireManagedAccount(accountId: string): StoredAccount {
    const account = this.#accountsById.get(accountId);
    if (!account) throw administrationError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
    return account;
  }

  #assertSuperAdministratorRemains(target: StoredAccount, nextRole: PersistedPlatformRole, nextStatus: ManagedAccountStatus): void {
    if (target.role !== "super_admin" || target.status !== "active" || (nextRole === "super_admin" && nextStatus === "active")) return;
    const activeSuperAdministrators = [...this.#accountsById.values()]
      .filter((account) => account.role === "super_admin" && account.status === "active");
    if (activeSuperAdministrators.length <= 1) {
      throw administrationError("LAST_ACTIVE_SUPER_ADMIN", "The last active super administrator cannot be changed.");
    }
  }

  #recordAccountAudit(actorAccountId: string, accountId: string, decisionCode: string, subjectId: string | null = null): void {
    this.#authorizationAudit.push({
      actorAccountId,
      action: "manage_accounts",
      subjectId,
      resourceType: subjectId ? "subject" : "platform",
      resourceId: accountId,
      decisionCode,
      recordedAt: new Date().toISOString(),
    });
  }

  async listAccounts({ page, pageSize }: { page: number; pageSize: number }): Promise<AccountPage> {
    const accounts = [...this.#accountsById.values()]
      .sort((left, right) => canonicalUsername(left.username).localeCompare(canonicalUsername(right.username)) || left.id.localeCompare(right.id));
    const offset = (page - 1) * pageSize;
    return {
      accounts: accounts.slice(offset, offset + pageSize).map((account) => this.#publicAccount(account)),
      pagination: { page, pageSize, total: accounts.length, totalPages: Math.max(1, Math.ceil(accounts.length / pageSize)) },
    };
  }

  async listSubjects({ includeArchived = false }: { includeArchived?: boolean } = {}): Promise<PublicSubject[]> {
    const subjects = new Map<string, StoredSubject>(this.#subjects);
    for (const membership of this.#memberships) {
      if (!subjects.has(membership.subjectId)) {
        subjects.set(membership.subjectId, {
          id: membership.subjectId,
          code: membership.subjectCode,
          nameJa: membership.subjectName,
          nameZh: membership.subjectName,
          nameEn: null,
          studentLocale: "legacy_bilingual",
          assessmentTypeKeys: ["excel_formula"],
          status: "active",
        });
      }
    }
    return [...subjects.values()]
      .filter((subject) => includeArchived || subject.status === "active")
      .map((subject) => ({
        ...subject,
        membershipCount: this.#memberships.filter((membership) => (
          membership.subjectId === subject.id && membership.status === "active"
        )).length,
      }))
      .sort((left, right) => left.code.localeCompare(right.code));
  }

  async createSubject(input: { actorAccountId: string } & CreateSubjectBody): Promise<PublicSubject> {
    if ([...this.#subjects.values()].some((subject) => canonicalUsername(subject.code) === canonicalUsername(input.code))) {
      throw administrationError("SUBJECT_CODE_EXISTS", "A subject with that code already exists.");
    }
    const subject: StoredSubject = {
      id: randomUUID(),
      code: input.code,
      nameJa: input.nameJa,
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      studentLocale: input.studentLocale,
      assessmentTypeKeys: [...input.assessmentTypeKeys],
      status: "active",
    };
    this.#subjects.set(subject.id, subject);
    this.#authorizationAudit.push({
      actorAccountId: input.actorAccountId,
      action: "manage_subjects",
      subjectId: subject.id,
      resourceType: "subject",
      resourceId: subject.id,
      decisionCode: "SUBJECT_CREATED",
      recordedAt: new Date().toISOString(),
    });
    return { ...structuredClone(subject), membershipCount: 0 };
  }

  async createAccount(input: {
    actorAccountId: string;
    username: string;
    displayName: string;
    passwordHash: string;
    platformRole: PersistedPlatformRole;
  }): Promise<PublicTeacherAccount> {
    requirePasswordHash(input.passwordHash);
    if (this.#accountsByCanonicalUsername.has(canonicalUsername(input.username))) {
      throw administrationError("ACCOUNT_USERNAME_EXISTS", "An account with that username already exists.");
    }
    const account: StoredAccount = {
      id: randomUUID(),
      username: input.username.trim(),
      displayName: input.displayName.trim(),
      passwordHash: input.passwordHash,
      role: input.platformRole,
      status: "active",
      credentialVersion: 1,
      sessionVersion: 1,
    };
    this.#storeAccount(account);
    this.#recordAccountAudit(input.actorAccountId, account.id, "ACCOUNT_CREATED");
    return this.#publicAccount(account);
  }

  async setAccountStatus(input: AccountMutationContext & { status: ManagedAccountStatus }): Promise<PublicTeacherAccount> {
    const account = this.#requireManagedAccount(input.accountId);
    const currentRole = account.role === "super_admin" ? "super_admin" : "teacher";
    this.#assertSuperAdministratorRemains(account, currentRole, input.status);
    if (account.status !== input.status) {
      account.status = input.status;
      account.sessionVersion += 1;
    }
    this.#recordAccountAudit(input.actorAccountId, account.id, input.status === "disabled" ? "ACCOUNT_DISABLED" : "ACCOUNT_ENABLED");
    return this.#publicAccount(account);
  }

  async setPlatformRole(input: AccountMutationContext & { platformRole: PersistedPlatformRole }): Promise<PublicTeacherAccount> {
    const account = this.#requireManagedAccount(input.accountId);
    this.#assertSuperAdministratorRemains(account, input.platformRole, account.status === "disabled" ? "disabled" : "active");
    if (account.role !== input.platformRole) {
      account.role = input.platformRole;
      account.sessionVersion += 1;
    }
    this.#recordAccountAudit(input.actorAccountId, account.id, "ACCOUNT_ROLE_CHANGED");
    return this.#publicAccount(account);
  }

  async resetAccountPassword(input: AccountMutationContext & { passwordHash: string }): Promise<PublicTeacherAccount> {
    requirePasswordHash(input.passwordHash);
    const account = this.#requireManagedAccount(input.accountId);
    account.passwordHash = input.passwordHash;
    account.credentialVersion += 1;
    account.sessionVersion += 1;
    this.#recordAccountAudit(input.actorAccountId, account.id, "PASSWORD_RESET");
    return this.#publicAccount(account);
  }

  async assignSubjectMembership(input: AccountMutationContext & { subjectId: string; subjectRole: SubjectRole }): Promise<PublicTeacherAccount> {
    return this.assignSubjectMemberships({
      actorAccountId: input.actorAccountId,
      accountId: input.accountId,
      memberships: [{ subjectId: input.subjectId, subjectRole: input.subjectRole }],
    });
  }

  async assignSubjectMemberships(input: AccountMutationContext & { memberships: readonly AccountMembershipItem[] }): Promise<PublicTeacherAccount> {
    const account = this.#requireManagedAccount(input.accountId);
    const subjectsById = new Map((await this.listSubjects()).map((subject) => [subject.id, subject]));
    const subjects = input.memberships.map((membership) => {
      const subject = subjectsById.get(membership.subjectId);
      if (!subject) throw administrationError("SUBJECT_NOT_FOUND", "Subject not found.", 404);
      return { subject, subjectRole: membership.subjectRole };
    });
    for (const { subject, subjectRole } of subjects) {
      const membership = this.#memberships.find((candidate) => candidate.accountId === account.id && candidate.subjectId === subject.id);
      if (membership) {
        membership.subjectRole = subjectRole;
        membership.status = "active";
      } else {
        this.#memberships.push({
          accountId: account.id,
          subjectId: subject.id,
          subjectCode: subject.code,
          subjectName: subject.nameZh,
          subjectRole,
          status: "active",
        });
      }
      this.#recordAccountAudit(input.actorAccountId, account.id, "MEMBERSHIP_ASSIGNED", subject.id);
    }
    account.sessionVersion += 1;
    return this.#publicAccount(account);
  }

  async updateSubjectSettings(input: {
    actorAccountId: string;
    subjectId: string;
    nameJa: string;
    nameZh: string;
    nameEn: string;
    studentLocale: SubjectSettingsBody["studentLocale"];
    assessmentTypeKeys: SubjectSettingsBody["assessmentTypeKeys"];
  }): Promise<PublicSubject> {
    const subject = this.#subjects.get(input.subjectId);
    if (!subject) throw administrationError("SUBJECT_NOT_FOUND", "Subject not found.", 404);
    const updated = {
      ...subject,
      nameJa: input.nameJa,
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      studentLocale: input.studentLocale,
      assessmentTypeKeys: [...input.assessmentTypeKeys],
    };
    this.#subjects.set(subject.id, updated);
    this.#authorizationAudit.push({
      actorAccountId: input.actorAccountId,
      action: "manage_subjects",
      subjectId: subject.id,
      resourceType: "subject",
      resourceId: subject.id,
      decisionCode: "SUBJECT_SETTINGS_UPDATED",
      recordedAt: new Date().toISOString(),
    });
    return {
      ...structuredClone(updated),
      membershipCount: this.#memberships.filter((membership) => (
        membership.subjectId === subject.id && membership.status === "active"
      )).length,
    };
  }

  async setSubjectStatus(input: {
    actorAccountId: string;
    subjectId: string;
    status: ManagedSubjectStatus;
  }): Promise<PublicSubject> {
    const subject = this.#subjects.get(input.subjectId);
    if (!subject) throw administrationError("SUBJECT_NOT_FOUND", "Subject not found.", 404);
    if (subject.id === DEFAULT_EXCEL_SUBJECT_ID && input.status === "archived") {
      throw administrationError("SUBJECT_PROTECTED", "The default Excel subject cannot be archived.");
    }
    subject.status = input.status;
    this.#authorizationAudit.push({
      actorAccountId: input.actorAccountId,
      action: "manage_subjects",
      subjectId: subject.id,
      resourceType: "subject",
      resourceId: subject.id,
      decisionCode: input.status === "archived" ? "SUBJECT_ARCHIVED" : "SUBJECT_RESTORED",
      recordedAt: new Date().toISOString(),
    });
    return {
      ...structuredClone(subject),
      membershipCount: this.#memberships.filter((membership) => (
        membership.subjectId === subject.id && membership.status === "active"
      )).length,
    };
  }

  async recordAuthorizationAudit(event: AuthorizationAuditEvent): Promise<void> {
    this.#authorizationAudit.push({ ...event, recordedAt: new Date().toISOString() });
  }

  async listAuthorizationAudit(): Promise<Array<AuthorizationAuditEvent & { recordedAt: string }>> {
    return structuredClone(this.#authorizationAudit);
  }

  async migrateLegacyAccounts(accounts: LegacyAdminAccount[]): Promise<{ imported: number }> {
    for (const account of accounts) {
      this.#storeAccount({
        id: legacyAccountId(account.username),
        username: account.username,
        displayName: account.username,
        passwordHash: account.passwordHash,
        role: account.role,
        status: "active",
        credentialVersion: 1,
        sessionVersion: 1,
      });
      const accountId = legacyAccountId(account.username);
      if (!this.#memberships.some((membership) => membership.accountId === accountId && membership.subjectId === DEFAULT_EXCEL_SUBJECT_ID)) {
        this.#memberships.push({
          accountId,
          subjectId: DEFAULT_EXCEL_SUBJECT_ID,
          subjectCode: "excel-applications",
          subjectName: "电子表格练习",
          subjectRole: account.role === "super_admin" ? "subject_admin" : account.role === "assistant_teacher" ? "proctor" : "teacher",
          status: "active",
        });
      }
    }
    return { imported: accounts.length };
  }

  async close(): Promise<void> {}
}

export class PostgresTeacherAccountRepository implements TeacherAccountRepository {
  readonly storageMode = "postgresql" as const;
  readonly #pool: PoolLike;

  constructor({ connectionString, pool, databasePoolMax }: { connectionString?: string; pool?: PoolLike; databasePoolMax?: number }) {
    if (!pool && !connectionString) throw new TypeError("A PostgreSQL connection string or pool is required.");
    const capacityPolicy = normalizeCapacityPolicy({ databasePoolMax });
    this.#pool = pool ?? new Pool({
      connectionString,
      max: capacityPolicy.databasePoolMax,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    });
  }

  async findAuthenticationAccount(username: string): Promise<StoredAccount | null> {
    const result = await this.#pool.query<AccountRow>(
      `SELECT teacher.id,
              teacher.login_name AS username,
              teacher.display_name,
              account.password_hash,
              account.platform_role AS role,
              account.account_status AS status,
              account.credential_version,
              account.session_version
       FROM teachers teacher
       INNER JOIN teacher_accounts account ON account.id=teacher.id
       WHERE lower(btrim(teacher.login_name))=lower(btrim($1))
       LIMIT 1`,
      [username],
    );
    return result.rows[0] ? mapAccountRow(result.rows[0]) : null;
  }

  async findSessionAccount(accountId: string): Promise<StoredAccount | null> {
    const result = await this.#pool.query<AccountRow>(
      `SELECT teacher.id,
              teacher.login_name AS username,
              teacher.display_name,
              account.password_hash,
              account.platform_role AS role,
              account.account_status AS status,
              account.credential_version,
              account.session_version
       FROM teacher_accounts account
       INNER JOIN teachers teacher ON teacher.id=account.id
       WHERE account.id=$1
       LIMIT 1`,
      [accountId],
    );
    return result.rows[0] ? mapAccountRow(result.rows[0]) : null;
  }

  async #consumeScope(
    client: PoolClientLike,
    scopeType: "ip" | "account",
    scopeHash: string,
    request: LoginRateLimitRequest,
  ): Promise<RateRow> {
    const result = await client.query<RateRow>(
      `INSERT INTO teacher_login_rate_limits (
         scope_type, scope_hash, attempt_count, window_started_at, expires_at, updated_at
       ) VALUES ($1,$2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+($3::bigint*INTERVAL '1 millisecond'),CURRENT_TIMESTAMP)
       ON CONFLICT (scope_type,scope_hash) DO UPDATE SET
         attempt_count=CASE
           WHEN teacher_login_rate_limits.expires_at<=CURRENT_TIMESTAMP THEN 1
           ELSE teacher_login_rate_limits.attempt_count+1
         END,
         window_started_at=CASE
           WHEN teacher_login_rate_limits.expires_at<=CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
           ELSE teacher_login_rate_limits.window_started_at
         END,
         expires_at=CASE
           WHEN teacher_login_rate_limits.expires_at<=CURRENT_TIMESTAMP
             THEN CURRENT_TIMESTAMP+($3::bigint*INTERVAL '1 millisecond')
           ELSE teacher_login_rate_limits.expires_at
         END,
         updated_at=CURRENT_TIMESTAMP
       RETURNING attempt_count,
                 GREATEST(1,CEIL(EXTRACT(EPOCH FROM (expires_at-CURRENT_TIMESTAMP))))::integer AS retry_after_seconds`,
      [scopeType, scopeHash, request.windowMilliseconds],
    );
    const row = result.rows[0];
    if (!row) throw new Error("LOGIN_RATE_LIMIT_WRITE_FAILED");
    return row;
  }

  async consumeLoginRateLimit(request: LoginRateLimitRequest): Promise<LoginRateLimitResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM teacher_login_rate_limits WHERE expires_at<=CURRENT_TIMESTAMP");
      const ip = await this.#consumeScope(client, "ip", request.ipKey, request);
      const account = await this.#consumeScope(client, "account", request.accountKey, request);
      await client.query(
        `DELETE FROM teacher_login_rate_limits
         WHERE (scope_type,scope_hash) IN (
           SELECT scope_type,scope_hash
           FROM teacher_login_rate_limits
           ORDER BY updated_at DESC,scope_type,scope_hash
           OFFSET $1
         )`,
        [request.maxTrackedKeys],
      );
      await client.query("COMMIT");
      const blocked = ip.attempt_count > request.limit || account.attempt_count > request.limit;
      return {
        allowed: !blocked,
        retryAfterSeconds: blocked ? Math.max(ip.retry_after_seconds, account.retry_after_seconds) : 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetLoginRateLimit({ ipKey, accountKey }: { ipKey: string; accountKey: string }): Promise<void> {
    await this.#pool.query(
      `DELETE FROM teacher_login_rate_limits
       WHERE (scope_type='ip' AND scope_hash=$1)
          OR (scope_type='account' AND scope_hash=$2)`,
      [ipKey, accountKey],
    );
  }

  async listActiveSubjectMemberships(accountId: string): Promise<SubjectMembershipContext[]> {
    const result = await this.#pool.query<{
      subject_id: string;
      subject_code: string;
      subject_name: string;
      subject_role: SubjectRole;
    } & Record<string, unknown>>(
      `SELECT subject.id AS subject_id,
              subject.subject_code,
              subject.name_zh AS subject_name,
              membership.subject_role
       FROM subject_memberships membership
       INNER JOIN subjects subject ON subject.id=membership.subject_id
       WHERE membership.account_id=$1
         AND membership.membership_status='active'
         AND subject.subject_status='active'
       ORDER BY subject.subject_code,subject.id`,
      [accountId],
    );
    return result.rows.map((row) => ({
      subjectId: row.subject_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      subjectRole: row.subject_role,
    }));
  }

  #mapPublicAccount(row: PublicAccountRow): PublicTeacherAccount {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      platformRole: row.platform_role,
      status: row.account_status,
      memberships: Array.isArray(row.memberships) ? row.memberships : [],
    };
  }

  async #readPublicAccount(connection: Pick<PoolLike, "query">, accountId: string): Promise<PublicTeacherAccount> {
    const result = await connection.query<PublicAccountRow>(
      `SELECT account.id,
              teacher.login_name AS username,
              teacher.display_name,
              account.platform_role,
              account.account_status,
              COALESCE(
                jsonb_agg(jsonb_build_object(
                  'subjectId',subject.id,
                  'subjectCode',subject.subject_code,
                  'subjectName',subject.name_zh,
                  'subjectRole',membership.subject_role
                ) ORDER BY subject.subject_code,subject.id)
                FILTER (WHERE membership.membership_status='active' AND subject.subject_status='active'),
                '[]'::jsonb
              ) AS memberships
       FROM teacher_accounts account
       INNER JOIN teachers teacher ON teacher.id=account.id
       LEFT JOIN subject_memberships membership ON membership.account_id=account.id
       LEFT JOIN subjects subject ON subject.id=membership.subject_id
       WHERE account.id=$1
       GROUP BY account.id,teacher.login_name,teacher.display_name,account.platform_role,account.account_status`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) throw administrationError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
    return this.#mapPublicAccount(row);
  }

  async #lockManagedAccount(client: PoolClientLike, accountId: string): Promise<ManagedAccountRow> {
    const result = await client.query<ManagedAccountRow>(
      `SELECT account.id,teacher.login_name AS username,teacher.display_name,account.platform_role,account.account_status
       FROM teacher_accounts account
       INNER JOIN teachers teacher ON teacher.id=account.id
       WHERE account.id=$1
       FOR UPDATE OF account,teacher`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) throw administrationError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
    return row;
  }

  async #assertSuperAdministratorRemains(
    client: PoolClientLike,
    target: ManagedAccountRow,
    nextRole: PersistedPlatformRole,
    nextStatus: ManagedAccountStatus,
  ): Promise<void> {
    if (target.platform_role !== "super_admin" || target.account_status !== "active" || (nextRole === "super_admin" && nextStatus === "active")) return;
    const locked = await client.query<{ id: string } & Record<string, unknown>>(
      `SELECT id FROM teacher_accounts
       WHERE platform_role='super_admin' AND account_status='active'
       ORDER BY id FOR UPDATE`,
    );
    if (locked.rows.length <= 1) {
      throw administrationError("LAST_ACTIVE_SUPER_ADMIN", "The last active super administrator cannot be changed.");
    }
  }

  async #recordAccountAudit(
    client: PoolClientLike,
    actorAccountId: string,
    accountId: string,
    decisionCode: string,
    subjectId: string | null = null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO teacher_authorization_audit_events (
         id,actor_account_id,action,subject_id,resource_type,resource_id,decision_code
       ) VALUES ($1,$2,'manage_accounts',$3,$4,$5,$6)`,
      [randomUUID(), actorAccountId, subjectId, subjectId ? "subject" : "platform", accountId, decisionCode],
    );
  }

  async listAccounts({ page, pageSize }: { page: number; pageSize: number }): Promise<AccountPage> {
    const offset = (page - 1) * pageSize;
    const [countResult, result] = await Promise.all([
      this.#pool.query<{ total_count: string | number } & Record<string, unknown>>(
        "SELECT count(*) AS total_count FROM teacher_accounts",
      ),
      this.#pool.query<PublicAccountRow>(
        `SELECT account.id,
              teacher.login_name AS username,
              teacher.display_name,
              account.platform_role,
              account.account_status,
              COALESCE(
                jsonb_agg(jsonb_build_object(
                  'subjectId',subject.id,
                  'subjectCode',subject.subject_code,
                  'subjectName',subject.name_zh,
                  'subjectRole',membership.subject_role
                ) ORDER BY subject.subject_code,subject.id)
                FILTER (WHERE membership.membership_status='active' AND subject.subject_status='active'),
                '[]'::jsonb
              ) AS memberships
       FROM teacher_accounts account
       INNER JOIN teachers teacher ON teacher.id=account.id
       LEFT JOIN subject_memberships membership ON membership.account_id=account.id
       LEFT JOIN subjects subject ON subject.id=membership.subject_id
       GROUP BY account.id,teacher.login_name,teacher.display_name,account.platform_role,account.account_status
       ORDER BY lower(btrim(teacher.login_name)),account.id
       LIMIT $1 OFFSET $2`,
        [pageSize, offset],
      ),
    ]);
    const total = Number(countResult.rows[0]?.total_count ?? 0);
    return {
      accounts: result.rows.map((row) => this.#mapPublicAccount(row)),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async listSubjects({ includeArchived = false }: { includeArchived?: boolean } = {}): Promise<PublicSubject[]> {
    const result = await this.#pool.query<SubjectRow>(
      `SELECT subject.id,subject.subject_code,subject.name_ja,subject.name_zh,subject.name_en,
              subject.student_locale,subject.assessment_type_key,subject.subject_status,
              ARRAY(
                SELECT capability.assessment_type_key
                FROM subject_authoring_capabilities capability
                WHERE capability.subject_id=subject.id
                ORDER BY capability.capability_position
              ) AS assessment_type_keys,
              count(membership.id) FILTER (WHERE membership.membership_status='active') AS membership_count
       FROM subjects subject
       LEFT JOIN subject_memberships membership ON membership.subject_id=subject.id
       WHERE ($1::boolean OR subject.subject_status='active')
       GROUP BY subject.id
       ORDER BY subject.subject_code,subject.id`,
      [includeArchived],
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.subject_code,
      nameJa: row.name_ja,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      studentLocale: row.student_locale,
      assessmentTypeKeys: managedAssessmentTypeKeys(row.assessment_type_keys, row.assessment_type_key),
      status: row.subject_status,
      membershipCount: Number(row.membership_count),
    }));
  }

  async createSubject(input: { actorAccountId: string } & CreateSubjectBody): Promise<PublicSubject> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const subjectId = randomUUID();
      const result = await client.query<SubjectRow>(
        `INSERT INTO subjects (
           id,subject_code,name_ja,name_zh,name_en,student_locale,assessment_type_key,subject_status,created_by_account_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8)
         RETURNING id,subject_code,name_ja,name_zh,name_en,student_locale,assessment_type_key,subject_status`,
        [subjectId, input.code, input.nameJa, input.nameZh, input.nameEn, input.studentLocale, input.assessmentTypeKeys[0], input.actorAccountId],
      );
      await client.query(
        `INSERT INTO subject_authoring_capabilities (subject_id,assessment_type_key,capability_position)
         SELECT $1,capability.key,(capability.ordinality-1)::smallint
         FROM unnest($2::text[]) WITH ORDINALITY AS capability(key,ordinality)`,
        [subjectId, input.assessmentTypeKeys],
      );
      await client.query(
        `INSERT INTO teacher_authorization_audit_events (
           id,actor_account_id,action,subject_id,resource_type,resource_id,decision_code
         ) VALUES ($1,$2,'manage_subjects',$3,'subject',$3::text,'SUBJECT_CREATED')`,
        [randomUUID(), input.actorAccountId, subjectId],
      );
      await client.query("COMMIT");
      const row = result.rows[0]!;
      return {
        id: row.id,
        code: row.subject_code,
        nameJa: row.name_ja,
        nameZh: row.name_zh,
        nameEn: row.name_en,
        studentLocale: row.student_locale,
        assessmentTypeKeys: [...input.assessmentTypeKeys],
        status: row.subject_status,
        membershipCount: 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "23505") throw administrationError("SUBJECT_CODE_EXISTS", "A subject with that code already exists.");
      throw error;
    } finally {
      client.release();
    }
  }

  async createAccount(input: {
    actorAccountId: string;
    username: string;
    displayName: string;
    passwordHash: string;
    platformRole: PersistedPlatformRole;
  }): Promise<PublicTeacherAccount> {
    requirePasswordHash(input.passwordHash);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const accountId = randomUUID();
      await client.query(
        "INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$3)",
        [accountId, input.username.trim(), input.displayName.trim()],
      );
      await client.query(
        `INSERT INTO teacher_accounts (id,password_hash,platform_role,account_status,activated_at)
         VALUES ($1,$2,$3,'active',CURRENT_TIMESTAMP)`,
        [accountId, input.passwordHash, input.platformRole],
      );
      await this.#recordAccountAudit(client, input.actorAccountId, accountId, "ACCOUNT_CREATED");
      const account = await this.#readPublicAccount(client, accountId);
      await client.query("COMMIT");
      return account;
    } catch (error) {
      await client.query("ROLLBACK");
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "23505") throw administrationError("ACCOUNT_USERNAME_EXISTS", "An account with that username already exists.");
      throw error;
    } finally {
      client.release();
    }
  }

  async setAccountStatus(input: AccountMutationContext & { status: ManagedAccountStatus }): Promise<PublicTeacherAccount> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await this.#lockManagedAccount(client, input.accountId);
      await this.#assertSuperAdministratorRemains(client, target, target.platform_role, input.status);
      await client.query(
        `UPDATE teacher_accounts SET
           account_status=$2,
           session_version=session_version+CASE WHEN account_status IS DISTINCT FROM $2 THEN 1 ELSE 0 END,
           activated_at=CASE WHEN $2='active' THEN COALESCE(activated_at,CURRENT_TIMESTAMP) ELSE activated_at END,
           disabled_at=CASE WHEN $2='disabled' THEN CURRENT_TIMESTAMP ELSE NULL END,
           updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [target.id, input.status],
      );
      await this.#recordAccountAudit(client, input.actorAccountId, target.id, input.status === "disabled" ? "ACCOUNT_DISABLED" : "ACCOUNT_ENABLED");
      const account = await this.#readPublicAccount(client, target.id);
      await client.query("COMMIT");
      return account;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setPlatformRole(input: AccountMutationContext & { platformRole: PersistedPlatformRole }): Promise<PublicTeacherAccount> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await this.#lockManagedAccount(client, input.accountId);
      await this.#assertSuperAdministratorRemains(client, target, input.platformRole, target.account_status === "disabled" ? "disabled" : "active");
      await client.query(
        `UPDATE teacher_accounts SET
           platform_role=$2,
           session_version=session_version+CASE WHEN platform_role IS DISTINCT FROM $2 THEN 1 ELSE 0 END,
           updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [target.id, input.platformRole],
      );
      await this.#recordAccountAudit(client, input.actorAccountId, target.id, "ACCOUNT_ROLE_CHANGED");
      const account = await this.#readPublicAccount(client, target.id);
      await client.query("COMMIT");
      return account;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetAccountPassword(input: AccountMutationContext & { passwordHash: string }): Promise<PublicTeacherAccount> {
    requirePasswordHash(input.passwordHash);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await this.#lockManagedAccount(client, input.accountId);
      await client.query(
        `UPDATE teacher_accounts SET
           password_hash=$2,
           credential_version=credential_version+1,
           session_version=session_version+1,
           updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [target.id, input.passwordHash],
      );
      await this.#recordAccountAudit(client, input.actorAccountId, target.id, "PASSWORD_RESET");
      const account = await this.#readPublicAccount(client, target.id);
      await client.query("COMMIT");
      return account;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async assignSubjectMembership(input: AccountMutationContext & { subjectId: string; subjectRole: SubjectRole }): Promise<PublicTeacherAccount> {
    return this.assignSubjectMemberships({
      actorAccountId: input.actorAccountId,
      accountId: input.accountId,
      memberships: [{ subjectId: input.subjectId, subjectRole: input.subjectRole }],
    });
  }

  async assignSubjectMemberships(input: AccountMutationContext & { memberships: readonly AccountMembershipItem[] }): Promise<PublicTeacherAccount> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await this.#lockManagedAccount(client, input.accountId);
      const subjectIds = input.memberships.map((membership) => membership.subjectId);
      const subjects = await client.query<{ id: string } & Record<string, unknown>>(
        "SELECT id FROM subjects WHERE id::text=ANY($1::text[]) AND subject_status='active' ORDER BY id FOR UPDATE",
        [subjectIds],
      );
      if (subjects.rows.length !== subjectIds.length) throw administrationError("SUBJECT_NOT_FOUND", "Subject not found.", 404);
      for (const membership of input.memberships) {
        await client.query(
          `INSERT INTO subject_memberships (
             id,subject_id,account_id,subject_role,membership_status,granted_by_account_id,granted_at
           ) VALUES ($1,$2,$3,$4,'active',$5,CURRENT_TIMESTAMP)
           ON CONFLICT (subject_id,account_id) DO UPDATE SET
             subject_role=EXCLUDED.subject_role,
             membership_status='active',
             granted_by_account_id=EXCLUDED.granted_by_account_id,
             granted_at=CURRENT_TIMESTAMP,
             revoked_at=NULL,
             updated_at=CURRENT_TIMESTAMP`,
          [randomUUID(), membership.subjectId, target.id, membership.subjectRole, input.actorAccountId],
        );
        await this.#recordAccountAudit(client, input.actorAccountId, target.id, "MEMBERSHIP_ASSIGNED", membership.subjectId);
      }
      await client.query("UPDATE teacher_accounts SET session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [target.id]);
      const account = await this.#readPublicAccount(client, target.id);
      await client.query("COMMIT");
      return account;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateSubjectSettings(input: {
    actorAccountId: string;
    subjectId: string;
    nameJa: string;
    nameZh: string;
    nameEn: string;
    studentLocale: SubjectSettingsBody["studentLocale"];
    assessmentTypeKeys: SubjectSettingsBody["assessmentTypeKeys"];
  }): Promise<PublicSubject> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<SubjectRow>(
        `SELECT subject.id,subject.subject_code,subject.name_ja,subject.name_zh,subject.name_en,
                subject.student_locale,subject.assessment_type_key,subject.subject_status,
                (SELECT count(*) FROM subject_memberships membership
                 WHERE membership.subject_id=subject.id AND membership.membership_status='active') AS membership_count
         FROM subjects subject WHERE subject.id=$1 FOR UPDATE`,
        [input.subjectId],
      );
      const subject = locked.rows[0];
      if (!subject) throw administrationError("SUBJECT_NOT_FOUND", "Subject not found.", 404);
      const updated = await client.query<SubjectRow>(
        `UPDATE subjects SET name_ja=$2,name_zh=$3,name_en=$4,student_locale=$5,assessment_type_key=$6,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1
         RETURNING id,subject_code,name_ja,name_zh,name_en,student_locale,assessment_type_key,subject_status`,
        [input.subjectId, input.nameJa, input.nameZh, input.nameEn, input.studentLocale, input.assessmentTypeKeys[0]],
      );
      await client.query(
        "DELETE FROM subject_authoring_capabilities WHERE subject_id=$1",
        [input.subjectId],
      );
      await client.query(
        `INSERT INTO subject_authoring_capabilities (subject_id,assessment_type_key,capability_position)
         SELECT $1,capability.key,(capability.ordinality-1)::smallint
         FROM unnest($2::text[]) WITH ORDINALITY AS capability(key,ordinality)`,
        [input.subjectId, input.assessmentTypeKeys],
      );
      await client.query(
        `INSERT INTO teacher_authorization_audit_events (
           id,actor_account_id,action,subject_id,resource_type,resource_id,decision_code
         ) VALUES ($1,$2,'manage_subjects',$3,'subject',$4,'SUBJECT_SETTINGS_UPDATED')`,
        [randomUUID(), input.actorAccountId, input.subjectId, input.subjectId],
      );
      await client.query("COMMIT");
      const row = updated.rows[0]!;
      return {
        id: row.id,
        code: row.subject_code,
        nameJa: row.name_ja,
        nameZh: row.name_zh,
        nameEn: row.name_en,
        studentLocale: row.student_locale,
        assessmentTypeKeys: [...input.assessmentTypeKeys],
        status: row.subject_status,
        membershipCount: Number(subject.membership_count),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setSubjectStatus(input: {
    actorAccountId: string;
    subjectId: string;
    status: ManagedSubjectStatus;
  }): Promise<PublicSubject> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<SubjectRow>(
        `SELECT subject.id,subject.subject_code,subject.name_ja,subject.name_zh,subject.name_en,
                subject.student_locale,subject.assessment_type_key,subject.subject_status,
                (SELECT count(*) FROM subject_memberships membership
                 WHERE membership.subject_id=subject.id AND membership.membership_status='active') AS membership_count
         FROM subjects subject WHERE subject.id=$1 FOR UPDATE`,
        [input.subjectId],
      );
      const subject = locked.rows[0];
      if (!subject) throw administrationError("SUBJECT_NOT_FOUND", "Subject not found.", 404);
      if (subject.id === DEFAULT_EXCEL_SUBJECT_ID && input.status === "archived") {
        throw administrationError("SUBJECT_PROTECTED", "The default Excel subject cannot be archived.");
      }
      const updated = await client.query<SubjectRow>(
        `UPDATE subjects SET subject_status=$2,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1
         RETURNING id,subject_code,name_ja,name_zh,name_en,student_locale,assessment_type_key,subject_status`,
        [input.subjectId, input.status],
      );
      await client.query(
        `INSERT INTO teacher_authorization_audit_events (
           id,actor_account_id,action,subject_id,resource_type,resource_id,decision_code
         ) VALUES ($1,$2,'manage_subjects',$3,'subject',$3::text,$4)`,
        [randomUUID(), input.actorAccountId, input.subjectId, input.status === "archived" ? "SUBJECT_ARCHIVED" : "SUBJECT_RESTORED"],
      );
      await client.query("COMMIT");
      const row = updated.rows[0]!;
      return {
        id: row.id,
        code: row.subject_code,
        nameJa: row.name_ja,
        nameZh: row.name_zh,
        nameEn: row.name_en,
        studentLocale: row.student_locale,
        assessmentTypeKeys: managedAssessmentTypeKeys(subject.assessment_type_keys, row.assessment_type_key),
        status: row.subject_status,
        membershipCount: Number(subject.membership_count),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAuthorizationAudit(event: AuthorizationAuditEvent): Promise<void> {
    await this.#pool.query(
      `INSERT INTO teacher_authorization_audit_events (
         id,actor_account_id,action,subject_id,resource_type,resource_id,decision_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        event.actorAccountId,
        event.action,
        event.subjectId,
        event.resourceType,
        event.resourceId,
        event.decisionCode,
      ],
    );
  }

  async migrateLegacyAccounts(accounts: LegacyAdminAccount[]): Promise<{ imported: number }> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      for (const account of accounts) {
        const existing = await client.query<{ id: string } & Record<string, unknown>>(
          `SELECT id
           FROM teachers
           WHERE lower(btrim(login_name))=lower(btrim($1))
           FOR UPDATE`,
          [account.username],
        );
        const accountId = existing.rows[0]?.id ?? randomUUID();
        if (!existing.rows[0]) {
          await client.query(
            `INSERT INTO teachers (id,login_name,display_name)
             VALUES ($1,$2,$2)`,
            [accountId, account.username.trim()],
          );
        }
        const platformRole = account.role === "super_admin" ? "super_admin" : "teacher";
        const subjectRole = account.role === "super_admin"
          ? "subject_admin"
          : account.role === "assistant_teacher"
            ? "proctor"
            : "teacher";
        await client.query(
          `INSERT INTO teacher_accounts (
             id,password_hash,platform_role,account_status,activated_at
           ) VALUES ($1,$2,$3,'active',CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             credential_version=teacher_accounts.credential_version+CASE
               WHEN teacher_accounts.password_hash IS DISTINCT FROM EXCLUDED.password_hash THEN 1 ELSE 0 END,
             session_version=teacher_accounts.session_version+CASE
               WHEN teacher_accounts.password_hash IS DISTINCT FROM EXCLUDED.password_hash
                 OR teacher_accounts.platform_role IS DISTINCT FROM EXCLUDED.platform_role
                 OR teacher_accounts.account_status IS DISTINCT FROM 'active' THEN 1 ELSE 0 END,
             password_hash=EXCLUDED.password_hash,
             platform_role=EXCLUDED.platform_role,
             account_status='active',
             activated_at=COALESCE(teacher_accounts.activated_at,CURRENT_TIMESTAMP),
             disabled_at=NULL,
             updated_at=CURRENT_TIMESTAMP`,
          [accountId, account.passwordHash, platformRole],
        );
        await client.query(
          `INSERT INTO subject_memberships (
             id,subject_id,account_id,subject_role,membership_status
           ) VALUES ($1,'00000000-0000-4000-8000-000000000023',$2,$3,'active')
           ON CONFLICT (subject_id,account_id) DO UPDATE SET
             subject_role=EXCLUDED.subject_role,
             updated_at=CURRENT_TIMESTAMP
           WHERE subject_memberships.membership_status='active'`,
          [randomUUID(), accountId, subjectRole],
        );
      }
      await client.query("COMMIT");
      return { imported: accounts.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export function createTeacherAccountRepository({
  connectionString,
  legacyAccounts = [],
  capacityPolicy,
}: {
  connectionString?: string;
  legacyAccounts?: LegacyAdminAccount[];
  capacityPolicy?: unknown;
} = {}): TeacherAccountRepository {
  const normalizedCapacityPolicy = normalizeCapacityPolicy(capacityPolicy);
  return connectionString
    ? new PostgresTeacherAccountRepository({ connectionString, databasePoolMax: normalizedCapacityPolicy.databasePoolMax })
    : new InMemoryTeacherAccountRepository({ legacyAccounts });
}
