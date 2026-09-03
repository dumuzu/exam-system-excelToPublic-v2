const ANOMALY_KEYS = Object.freeze([
  "expired_active_sessions",
  "duplicate_open_attempts",
  "session_identity_mismatches",
  "suspension_state_mismatches",
  "unresolved_failures_without_open_attempt",
  "completed_termination_runs_with_open_attempts",
  "ready_assignment_shared_paper_mismatches",
  "formal_exams_with_shared_papers",
  "roster_name_snapshot_mismatches",
]);

export interface MigrationLedgerRow {
  readonly version: number | string;
  readonly filename: string;
}

export interface DatabaseStabilityAssessment {
  readonly ok: boolean;
  readonly migrationCount: number;
  readonly ledgerCount: number;
  readonly anomalies: Readonly<Record<string, number>>;
  readonly problems: string[];
}

function migrationVersion(filename: unknown): number | null {
  const match = String(filename ?? "").match(/^([0-9]{3})_[a-z0-9_]+[.]sql$/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export function assessDatabaseStability({ migrationFiles = [], ledgerRows = [], anomalyRow = {} }: {
  migrationFiles?: readonly string[];
  ledgerRows?: readonly MigrationLedgerRow[];
  anomalyRow?: Readonly<Record<string, unknown>>;
} = {}): DatabaseStabilityAssessment {
  const problems: string[] = [];
  const filesByVersion = new Map<number, string>();
  for (const filename of migrationFiles) {
    const version = migrationVersion(filename);
    if (version === null) {
      problems.push(`invalid migration filename ${filename}`);
      continue;
    }
    if (filesByVersion.has(version)) problems.push(`duplicate migration version ${version}`);
    filesByVersion.set(version, filename);
  }

  const ledgerByVersion = new Map<number, string>(ledgerRows.map((row) => [Number(row.version), String(row.filename)]));
  for (const [version, filename] of filesByVersion) {
    const recorded = ledgerByVersion.get(version);
    if (!recorded) problems.push(`missing migration ${filename} in database ledger`);
    else if (recorded !== filename) problems.push(`filename mismatch for version ${version}: ${recorded} != ${filename}`);
  }
  for (const [version, filename] of ledgerByVersion) {
    if (!filesByVersion.has(version)) problems.push(`database ledger contains unknown migration ${filename}`);
  }

  const versions = [...filesByVersion.keys()].sort((left, right) => left - right);
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index] !== index + 1) problems.push(`migration files are not contiguous at version ${index + 1}`);
  }

  const anomalies: Record<string, number> = {};
  for (const key of ANOMALY_KEYS) {
    const value = Number(anomalyRow[key] ?? 0);
    anomalies[key] = Number.isFinite(value) ? value : -1;
    if (anomalies[key] !== 0) problems.push(`${key}=${anomalies[key]}`);
  }

  return {
    ok: problems.length === 0,
    migrationCount: filesByVersion.size,
    ledgerCount: ledgerByVersion.size,
    anomalies,
    problems,
  };
}
