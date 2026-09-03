import {
  getAuthConfigFromEnvironment,
  getLegacyAccounts,
} from "../src/server/admin-auth.ts";

// This one-shot migration intentionally uses the same typed repository seam as the server.
import { PostgresTeacherAccountRepository } from "../src/server/teacher-account-repository.ts";

const connectionString = process.env["MIGRATION_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const authConfig = getAuthConfigFromEnvironment(process.env);
const legacyAccounts = getLegacyAccounts(authConfig);
if (legacyAccounts.length === 0) {
  throw new Error("No valid legacy administrator accounts were found in the environment.");
}

const repository = new PostgresTeacherAccountRepository({ connectionString });
try {
  const result = await repository.migrateLegacyAccounts(legacyAccounts);
  process.stdout.write(`Imported ${result.imported} teacher account(s). Remove legacy administrator variables after verification.\n`);
} finally {
  await repository.close();
}
