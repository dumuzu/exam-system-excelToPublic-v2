import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedLocalEntries = new Set([".git", "node_modules", ".env"]);

async function listReleaseFiles(directory: string, relativeDirectory = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excludedLocalEntries.has(entry.name) || (entry.name.startsWith(".env.") && entry.name !== ".env.example")) continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listReleaseFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

const releaseFiles = await listReleaseFiles(repositoryRoot);
const violations: string[] = [];
const allowedMarkdownFiles = new Set(["README.md", "SECURITY.md"]);
const forbiddenDataExtensions = new Set([
  ".xls", ".xlsx", ".csv", ".tsv", ".db", ".sqlite", ".sqlite3",
  ".dump", ".bak", ".log", ".zip", ".7z",
]);
const textExtensions = new Set([
  ".css", ".html", ".js", ".json", ".md", ".mjs", ".sql", ".ts", ".tsx", ".txt", ".yml", ".yaml",
]);
const forbiddenPathPattern = /(^|\/)(?:\.codex|\.agents|\.harness|\.vercel|\.idea|\.vscode)(?:\/|$)/iu;
const privateMarkerPatterns = [
  /(?:^|[\s"'=])C:\\Users\\/imu,
  /(?:^|[\s"'=])D:\\/imu,
  /表計算応用演習/u,
  /表计算应用演习/u,
  /Advanced Spreadsheet Applications/u,
  /(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_-]{16,}/u,
];
const operationalInsertPattern = /\binsert\s+into\s+(?:teachers|teacher_accounts|subjects|subject_memberships|students|exams|exam_roster|exam_configuration_history|admission_approvals|active_sessions|attempts|answers|answer_revisions|submissions|grade_results|teacher_adjustments|proctor_events|prepared_question_instances|assignment_shared_question_instances|attempt_policy_suspensions|exam_termination_runs|exam_termination_failures)\b/iu;
const operationalMigrationAllowlist = new Set(["db/migrations/023_multi_subject_account_ownership.sql"]);

for (const file of releaseFiles) {
  const normalizedFile = file.replaceAll("\\", "/");
  const absoluteFile = path.join(repositoryRoot, file);
  const extension = path.extname(normalizedFile).toLowerCase();

  if (forbiddenPathPattern.test(normalizedFile)) violations.push(`${normalizedFile}: private workspace path`);
  if (forbiddenDataExtensions.has(extension)) violations.push(`${normalizedFile}: operational data-like file`);
  if (extension === ".md" && !allowedMarkdownFiles.has(normalizedFile)) {
    violations.push(`${normalizedFile}: nonessential Markdown document`);
  }
  if (!textExtensions.has(extension) || normalizedFile === ".env.example") continue;

  const content = await readFile(absoluteFile, "utf8");
  if (normalizedFile !== "scripts/check-public-release.ts") {
    for (const pattern of privateMarkerPatterns) {
      if (pattern.test(content)) violations.push(`${normalizedFile}: private or machine-specific marker`);
    }
  }
  if (extension === ".sql" && operationalInsertPattern.test(content) && !operationalMigrationAllowlist.has(normalizedFile)) {
    violations.push(`${normalizedFile}: operational exam data insert`);
  }
}

if (violations.length > 0) {
  throw new Error(`Public release check failed:\n${violations.map((violation) => `- ${violation}`).join("\n")}`);
}

process.stdout.write(`Public release check passed for ${releaseFiles.length} repository files.\n`);
