import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

interface ClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  release(): void;
}

interface PoolLike {
  connect(): Promise<ClientLike>;
  end(): Promise<void>;
}

const require = createRequire(import.meta.url);
const { Pool } = require("pg") as {
  Pool: new (options: Record<string, unknown>) => PoolLike;
};

const connectionString = process.env["MIGRATION_DATABASE_URL"];
if (!connectionString) {
  throw new Error("MIGRATION_DATABASE_URL is required. Use a direct PostgreSQL URL, not the pooled application URL.");
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(projectRoot, "db", "migrations");
const seedPath = path.join(projectRoot, "db", "seeds", "001_function_catalog.sql");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((filename) => /^[0-9]{3}_[a-z0-9_]+[.]sql$/.test(filename))
  .sort();

if (migrationFiles.length === 0) throw new Error("No database migrations were found.");

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();

async function tableExists(tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1)::text IS NOT NULL AS exists",
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

async function readLedger(): Promise<Map<number, string>> {
  if (!await tableExists("schema_migrations")) return new Map();
  const result = await client.query<{ version: number; filename: string }>(
    "SELECT version,filename FROM schema_migrations ORDER BY version",
  );
  return new Map(result.rows.map((row) => [Number(row.version), String(row.filename)]));
}

try {
  await client.query("SELECT pg_advisory_lock(hashtext('exam-system-public-migrations'))");

  const hasInitialSchema = await tableExists("teachers");
  let ledger = await readLedger();
  if (hasInitialSchema && ledger.size === 0) {
    throw new Error(
      "The database contains an unversioned or partially migrated schema. Refusing to guess its version; use a fresh database or migrate it manually.",
    );
  }

  for (const filename of migrationFiles) {
    const version = Number.parseInt(filename.slice(0, 3), 10);
    const recordedFilename = ledger.get(version);
    if (recordedFilename) {
      if (recordedFilename !== filename) {
        throw new Error(`Migration ${version} is recorded as ${recordedFilename}, not ${filename}.`);
      }
      process.stdout.write(`skip ${filename}\n`);
      continue;
    }

    const sql = await readFile(path.join(migrationDirectory, filename), "utf8");
    process.stdout.write(`apply ${filename}\n`);
    await client.query(sql);

    if (version === 1) {
      process.stdout.write("seed 001_function_catalog.sql\n");
      await client.query(await readFile(seedPath, "utf8"));
    }
    ledger = await readLedger();
  }

  const expectedVersions = migrationFiles.map((filename) => Number.parseInt(filename.slice(0, 3), 10));
  const finalLedger = await readLedger();
  for (const version of expectedVersions) {
    if (!finalLedger.has(version)) throw new Error(`Migration ${version} is missing from the migration ledger.`);
  }
  process.stdout.write(`Database ready: ${migrationFiles.length} migrations applied or verified.\n`);
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock(hashtext('exam-system-public-migrations'))");
  } finally {
    client.release();
    await pool.end();
  }
}
