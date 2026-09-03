import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { normalizeCapacityPolicy } from "./capacity-policy.ts";
import { authorizeTeacherAction, getAuthorizationQueryScope } from "./authorization-policy.ts";
import type { TeacherAuthorizationActor } from "./authorization-policy.ts";
import type { AdminPermission } from "./admin-auth.ts";

const require = createRequire(import.meta.url);
const { Pool } = require("pg") as { Pool: new (options: Record<string, unknown>) => PoolLike };
const DEFAULT_EXCEL_SUBJECT_ID = "00000000-0000-4000-8000-000000000023";

type DynamicRecord = Record<string, any>;

interface QueryResult<Row extends Record<string, unknown>> { rows: Row[] }
interface PoolClientLike { on(event: "error", listener: (error: Error) => void): void }
interface PoolLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  on(event: "connect", listener: (client: PoolClientLike) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  end(): Promise<void>;
}

export interface ExamHistoryRecord extends DynamicRecord {
  id: string;
  name: string;
  mode: string;
  durationMinutes: number | null;
  createdBy: string;
  subjectId: string;
  ownerAccountId: string;
  assessmentTypeKey: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

interface HistoryRow extends Record<string, unknown> {
  id: string; name: string; configuration_mode: string; duration_minutes: number | null; assignment_options: unknown; selected_functions: unknown;
  composition: unknown; created_by: string; subject_id: string; owner_account_id: string; assessment_type_key: string;
  created_at: Date; updated_at: Date; last_used_at: Date | null;
}

interface SaveHistoryInput {
  name: string;
  mode: string;
  durationMinutes?: number | null;
  assignmentOptions: unknown;
  selectedFunctions: unknown;
  plan: unknown;
  createdBy: string;
  subjectId?: string;
  ownerAccountId?: string;
  assessmentTypeKey?: string;
}

interface ListHistoryInput { authorization?: TeacherAuthorizationActor | null; action?: AdminPermission }

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function mapHistoryRow(row: HistoryRow): ExamHistoryRecord {
  return {
    id: row.id,
    name: row.name,
    mode: row.configuration_mode,
    durationMinutes: row.configuration_mode === "assignment" ? null : Number(row.duration_minutes ?? 90),
    assignmentOptions: row.assignment_options,
    selectedFunctions: row.selected_functions,
    plan: row.composition,
    createdBy: row.created_by,
    subjectId: row.subject_id,
    ownerAccountId: row.owner_account_id,
    assessmentTypeKey: row.assessment_type_key,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}

/**
 * Ephemeral local adapter used only when DATABASE_URL has not been configured.
 * It keeps the app runnable without pretending that history is permanently saved.
 */
export class InMemoryExamHistoryRepository {
  #records = new Map<string, ExamHistoryRecord>();
  #historyListLimit: number;
  #historyRecordLimit: number;
  #lastTimestampMilliseconds = 0;

  constructor({ historyListLimit, inMemoryHistoryRecordLimit }: { historyListLimit?: number; inMemoryHistoryRecordLimit?: number } = {}) {
    const capacityPolicy = normalizeCapacityPolicy({
      historyListLimit,
      inMemoryHistoryRecordLimit,
    });
    this.#historyListLimit = capacityPolicy.historyListLimit;
    this.#historyRecordLimit = capacityPolicy.inMemoryHistoryRecordLimit;
  }

  get storageMode(): "memory" {
    return "memory";
  }

  #nextTimestamp(): string {
    this.#lastTimestampMilliseconds = Math.max(Date.now(), this.#lastTimestampMilliseconds + 1);
    return new Date(this.#lastTimestampMilliseconds).toISOString();
  }

  #trimTemporaryRecords(): void {
    const overflow = this.#records.size - this.#historyRecordLimit;
    if (overflow <= 0) return;

    const oldestRecordIds = [...this.#records.values()]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, overflow)
      .map((record) => record.id);
    for (const id of oldestRecordIds) this.#records.delete(id);
  }

  async list({ authorization = null, action = "compose_exam" }: ListHistoryInput = {}): Promise<ExamHistoryRecord[]> {
    return [...this.#records.values()]
      .filter((record) => !authorization || authorizeTeacherAction({
        actor: authorization,
        action,
        resource: { subjectId: record.subjectId, ownerAccountId: record.ownerAccountId, resourceType: "configuration", resourceId: record.id },
      }).allowed)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, this.#historyListLimit)
      .map((record) => clone(record));
  }

  async get(id: string): Promise<ExamHistoryRecord | null> {
    const record = this.#records.get(id);
    return record ? clone(record) : null;
  }

  async getAuthorizationTarget(id: string) {
    const record = this.#records.get(id);
    return record ? {
      subjectId: record.subjectId,
      ownerAccountId: record.ownerAccountId,
      resourceType: "configuration",
      resourceId: record.id,
    } : null;
  }

  async save({ name, mode, durationMinutes = mode === "assignment" ? null : 90, assignmentOptions, selectedFunctions, plan, createdBy, subjectId = DEFAULT_EXCEL_SUBJECT_ID, ownerAccountId = `legacy:${String(createdBy).trim().toLowerCase()}`, assessmentTypeKey = "excel_formula" }: SaveHistoryInput): Promise<ExamHistoryRecord> {
    const timestamp = this.#nextTimestamp();
    const record = {
      id: randomUUID(),
      name,
      mode,
      durationMinutes: mode === "assignment" ? null : durationMinutes,
      assignmentOptions: clone(assignmentOptions),
      selectedFunctions: clone(selectedFunctions),
      plan: clone(plan),
      createdBy,
      subjectId,
      ownerAccountId,
      assessmentTypeKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: null,
    };
    this.#records.set(record.id, record);
    this.#trimTemporaryRecords();
    return clone(record);
  }

  async markUsed(id: string): Promise<ExamHistoryRecord | null> {
    const record = this.#records.get(id);
    if (!record) return null;

    const timestamp = this.#nextTimestamp();
    record.lastUsedAt = timestamp;
    record.updatedAt = timestamp;
    return clone(record);
  }

  async checkHealth(): Promise<true> {
    return true;
  }

  async close(): Promise<void> {}
}

export class PostgresExamHistoryRepository {
  #pool: PoolLike;
  #historyListLimit: number;

  constructor({ connectionString, databasePoolMax, historyListLimit }: { connectionString: string; databasePoolMax?: number; historyListLimit?: number }) {
    const capacityPolicy = normalizeCapacityPolicy({ databasePoolMax, historyListLimit });
    this.#historyListLimit = capacityPolicy.historyListLimit;
    this.#pool = new Pool({
      connectionString,
      max: capacityPolicy.databasePoolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.#pool.on("connect", (client) => {
      client.on("error", (error) => {
        console.error("PostgreSQL active history client error:", error.message);
      });
    });
    this.#pool.on("error", (error) => {
      console.error("PostgreSQL history pool error:", error.message);
    });
  }

  get storageMode(): "postgres" {
    return "postgres";
  }

  async list({ authorization = null, action = "compose_exam" }: ListHistoryInput = {}): Promise<ExamHistoryRecord[]> {
    const scope = authorization ? getAuthorizationQueryScope(authorization, action) : null;
    if (scope && !scope.unrestricted && scope.allResourceSubjectIds.length === 0 && scope.ownedResourceSubjectIds.length === 0) return [];
    const scopeWhere = scope && !scope.unrestricted
      ? `WHERE (subject_id=ANY($1::uuid[])
          OR (subject_id=ANY($2::uuid[]) AND owner_account_id=$3::uuid))`
      : "";
    const limitParameter = scope && !scope.unrestricted ? "$4" : "$1";
    const values = scope && !scope.unrestricted
      ? [scope.allResourceSubjectIds, scope.ownedResourceSubjectIds, scope.accountId, this.#historyListLimit]
      : [this.#historyListLimit];
    const result = await this.#pool.query<HistoryRow>(`
      SELECT id, name, configuration_mode, duration_minutes, assignment_options, selected_functions, composition, created_by,
             subject_id,owner_account_id,assessment_type_key,created_at, updated_at, last_used_at
      FROM exam_configuration_history
      ${scopeWhere}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limitParameter}
    `, values);
    return result.rows
      .filter((row) => !authorization || authorizeTeacherAction({
        actor: authorization,
        action,
        resource: { subjectId: row.subject_id, ownerAccountId: row.owner_account_id, resourceType: "configuration", resourceId: row.id },
      }).allowed)
      .map(mapHistoryRow);
  }

  async get(id: string): Promise<ExamHistoryRecord | null> {
    const result = await this.#pool.query<HistoryRow>(
      `
        SELECT id, name, configuration_mode, duration_minutes, assignment_options, selected_functions, composition, created_by,
               subject_id,owner_account_id,assessment_type_key,created_at, updated_at, last_used_at
        FROM exam_configuration_history
        WHERE id = $1
      `,
      [id],
    );
    return result.rows[0] ? mapHistoryRow(result.rows[0]) : null;
  }

  async getAuthorizationTarget(id: string) {
    const result = await this.#pool.query<{ subject_id: string; owner_account_id: string } & Record<string, unknown>>(
      `SELECT subject_id,owner_account_id
       FROM exam_configuration_history
       WHERE id=$1`,
      [id],
    );
    const row = result.rows[0];
    return row ? { subjectId: row.subject_id, ownerAccountId: row.owner_account_id, resourceType: "configuration", resourceId: id } : null;
  }

  async save({ name, mode, durationMinutes = mode === "assignment" ? null : 90, assignmentOptions, selectedFunctions, plan, createdBy, subjectId, ownerAccountId, assessmentTypeKey = "excel_formula" }: SaveHistoryInput): Promise<ExamHistoryRecord> {
    const result = await this.#pool.query<HistoryRow>(
      `
        INSERT INTO exam_configuration_history (
          id, name, configuration_mode, duration_minutes, assignment_options, selected_functions, composition, created_by,
          subject_id,owner_account_id,assessment_type_key
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8,$9,$10,$11)
        RETURNING id, name, configuration_mode, duration_minutes, assignment_options, selected_functions, composition, created_by,
                  subject_id,owner_account_id,assessment_type_key,created_at, updated_at, last_used_at
      `,
      [
        randomUUID(),
        name,
        mode,
        mode === "assignment" ? null : durationMinutes,
        JSON.stringify(assignmentOptions),
        JSON.stringify(selectedFunctions),
        JSON.stringify(plan),
        createdBy,
        subjectId,
        ownerAccountId,
        assessmentTypeKey,
      ],
    );
    return mapHistoryRow(result.rows[0]!);
  }

  async markUsed(id: string): Promise<ExamHistoryRecord | null> {
    const result = await this.#pool.query<HistoryRow>(
      `
        UPDATE exam_configuration_history
        SET last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, name, configuration_mode, duration_minutes, assignment_options, selected_functions, composition, created_by,
                  subject_id,owner_account_id,assessment_type_key,created_at, updated_at, last_used_at
      `,
      [id],
    );
    return result.rows[0] ? mapHistoryRow(result.rows[0]) : null;
  }

  async checkHealth(): Promise<true> {
    const result = await this.#pool.query<{ history_table: unknown } & Record<string, unknown>>(
      "SELECT to_regclass('public.exam_configuration_history') AS history_table",
    );
    if (!result.rows[0]?.history_table) {
      const error = new Error("Database is not initialized.") as Error & { code: string };
      error.code = "DATABASE_NOT_INITIALIZED";
      throw error;
    }
    return true;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

export function createExamHistoryRepository({
  connectionString,
  capacityPolicy,
}: { connectionString?: string; capacityPolicy?: unknown } = {}): InMemoryExamHistoryRepository | PostgresExamHistoryRepository {
  const normalizedCapacityPolicy = normalizeCapacityPolicy(capacityPolicy);

  return connectionString
    ? new PostgresExamHistoryRepository({
        connectionString,
        databasePoolMax: normalizedCapacityPolicy.databasePoolMax,
        historyListLimit: normalizedCapacityPolicy.historyListLimit,
      })
    : new InMemoryExamHistoryRepository({
        historyListLimit: normalizedCapacityPolicy.historyListLimit,
        inMemoryHistoryRecordLimit: normalizedCapacityPolicy.inMemoryHistoryRecordLimit,
      });
}
