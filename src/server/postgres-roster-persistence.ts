import { normalizeStudentIdentity } from "../core/student-identity.ts";
import type { NormalizedStudentIdentity, StudentIdentityInput } from "../core/student-identity.ts";

interface PersistenceError extends Error {
  code: string;
  statusCode: number;
}

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: Row[];
}

export interface RosterPersistenceClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: readonly unknown[]): Promise<QueryResult<Row>>;
}

interface StudentRow extends Record<string, unknown> {
  student_number: string;
  id?: unknown;
  name?: unknown;
  roster_name?: unknown;
}

function rosterPersistenceError(code: string, message: string): PersistenceError {
  const error = new Error(message);
  const typedError = error as PersistenceError;
  typedError.code = code;
  typedError.statusCode = 409;
  return typedError;
}

function normalizedRoster(roster: readonly StudentIdentityInput[]): NormalizedStudentIdentity[] {
  const normalized = roster.map((entry) => normalizeStudentIdentity(entry));
  const seen = new Set<string>();
  for (const entry of normalized) {
    if (!entry.studentNumber || !entry.name || seen.has(entry.studentNumber)) {
      throw rosterPersistenceError(
        "ROSTER_PERSISTENCE_INPUT_INVALID",
        "The roster contains an invalid or duplicate student identity.",
      );
    }
    seen.add(entry.studentNumber);
  }
  return normalized.sort((left, right) => left.studentNumber.localeCompare(right.studentNumber));
}

function assertRowsMatch(
  expected: readonly NormalizedStudentIdentity[],
  rows: readonly StudentRow[],
  nameField: "name" | "roster_name",
  code: string,
): Map<string, StudentRow> {
  if (rows.length !== expected.length) {
    throw rosterPersistenceError(code, "The persisted roster row count does not match the validated roster.");
  }
  const byStudentNumber = new Map(rows.map((row) => [row.student_number, row]));
  for (const entry of expected) {
    const row = byStudentNumber.get(entry.studentNumber);
    const persistedName = normalizeStudentIdentity({ name: row?.[nameField] }).name;
    if (!row || persistedName !== entry.name) {
      throw rosterPersistenceError(code, "A persisted roster identity does not match the validated roster.");
    }
  }
  return byStudentNumber;
}

/**
 * Persists a roster inside the caller's transaction.
 *
 * Student numbers are durable identities, while names are mutable attributes.
 * Each exam keeps its own immutable name snapshot so a corrected official name
 * does not rewrite the names displayed by older exam events.
 */
export async function persistExamRoster(client: RosterPersistenceClient, {
  examId,
  roster,
  createId,
}: {
  examId: unknown;
  roster: readonly StudentIdentityInput[];
  createId: () => unknown;
}) {
  const orderedRoster = normalizedRoster(roster);
  if (!orderedRoster.length) {
    return { ok: true, studentCount: 0, stages: [] };
  }

  const studentParameters: unknown[] = [];
  const studentGroups = orderedRoster.map((student, index) => {
    studentParameters.push(createId(), student.studentNumber, student.name);
    const base = index * 3;
    return `($${base + 1},$${base + 2},$${base + 3})`;
  });
  const persistedStudents = await client.query<StudentRow>(
    `INSERT INTO students (id,student_number,name_native)
     VALUES ${studentGroups.join(",")}
     ON CONFLICT (student_number) DO UPDATE
     SET name_native=EXCLUDED.name_native,updated_at=CURRENT_TIMESTAMP
     RETURNING id,student_number,COALESCE(NULLIF(name_native,''),name_ja) AS name`,
    studentParameters,
  );
  const studentByNumber = assertRowsMatch(
    orderedRoster,
    persistedStudents.rows,
    "name",
    "ROSTER_IDENTITY_PERSISTENCE_FAILED",
  );

  const rosterParameters: unknown[] = [];
  const rosterGroups = orderedRoster.map((entry, index) => {
    rosterParameters.push(examId, studentByNumber.get(entry.studentNumber)!.id, entry.name);
    const base = index * 3;
    return `($${base + 1},$${base + 2},$${base + 3})`;
  });
  await client.query(
    `INSERT INTO exam_roster (exam_id,student_id,roster_name)
     VALUES ${rosterGroups.join(",")}`,
    rosterParameters,
  );

  const persistedRoster = await client.query<StudentRow>(
    `SELECT student.student_number,roster.roster_name
     FROM exam_roster roster
     INNER JOIN students student ON student.id=roster.student_id
     WHERE roster.exam_id=$1
     ORDER BY student.student_number`,
    [examId],
  );
  assertRowsMatch(
    orderedRoster,
    persistedRoster.rows,
    "roster_name",
    "ROSTER_POSTCONDITION_FAILED",
  );

  return {
    ok: true,
    studentCount: orderedRoster.length,
    stages: [
      { code: "ROSTER_IDENTITIES_PERSISTED", count: orderedRoster.length },
      { code: "ROSTER_SNAPSHOT_WRITTEN", count: orderedRoster.length },
      { code: "ROSTER_POSTCONDITION_VERIFIED", count: orderedRoster.length },
    ],
  };
}
