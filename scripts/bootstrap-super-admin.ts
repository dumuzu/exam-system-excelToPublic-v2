import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { hashAdminPassword } from "../src/server/admin-auth.ts";

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number;
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
const username = process.env["BOOTSTRAP_ADMIN_USERNAME"]?.trim();
const displayName = process.env["BOOTSTRAP_ADMIN_DISPLAY_NAME"]?.trim();
const password = process.env["BOOTSTRAP_ADMIN_PASSWORD"];

if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!username || username.length > 100 || /[\u0000-\u001f\u007f]/.test(username)) {
  throw new Error("BOOTSTRAP_ADMIN_USERNAME must contain 1-100 printable characters.");
}
if (!displayName || displayName.length > 100 || /[\u0000-\u001f\u007f]/.test(displayName)) {
  throw new Error("BOOTSTRAP_ADMIN_DISPLAY_NAME must contain 1-100 printable characters.");
}
if (!password || password.length < 12 || password.length > 200 || password.trim().length === 0) {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain 12-200 characters.");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('exam-system-public-bootstrap-admin'))");

  const existingSuperAdmin = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM teacher_accounts WHERE platform_role='super_admin' AND account_status='active') AS exists",
  );
  if (existingSuperAdmin.rows[0]?.exists) {
    throw new Error("An active super administrator already exists. Create additional accounts from the system administration UI.");
  }

  const canonicalConflict = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM teachers WHERE lower(btrim(login_name))=lower(btrim($1))) AS exists",
    [username],
  );
  if (canonicalConflict.rows[0]?.exists) throw new Error("The requested administrator username already exists.");

  const accountId = randomUUID();
  const passwordHash = hashAdminPassword(password);
  await client.query(
    "INSERT INTO teachers (id,login_name,display_name,preferred_locale) VALUES ($1,$2,$3,'zh')",
    [accountId, username, displayName],
  );
  await client.query(
    `INSERT INTO teacher_accounts (
       id,password_hash,platform_role,account_status,activated_at
     ) VALUES ($1,$2,'super_admin','active',CURRENT_TIMESTAMP)`,
    [accountId, passwordHash],
  );
  await client.query("COMMIT");
  process.stdout.write(`Super administrator created for ${username}. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.\n`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
