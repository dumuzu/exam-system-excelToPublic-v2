import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findEngineeringConventionViolations } from "../scripts/check-engineering-conventions.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the repository excludes local AI metadata and authored inline styles", async () => {
  assert.deepEqual(await findEngineeringConventionViolations({ repositoryRoot }), []);
  const gitignore = await readFile(path.join(repositoryRoot, ".gitignore"), "utf8");
  for (const localOnlyPath of [".codex/", ".agents/", ".cursor/", ".claude/", ".continue/", ".roo/", ".windsurf/"]) {
    assert.match(gitignore, new RegExp(`^${localOnlyPath.replace(".", "\\.")}$`, "m"));
  }
});

test("the convention checker reports every unsafe repository style", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "exam-engineering-conventions-"));
  await mkdir(path.join(fixtureRoot, "public"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "src", "client", "admin", "styles"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "public", "index.html"), '<main style="display:none"></main>', "utf8");
  await writeFile(path.join(fixtureRoot, "src", "client", "admin", "styles", "accounts.css"), ".account-card { display: block; }", "utf8");

  const violations = await findEngineeringConventionViolations({
    repositoryRoot: fixtureRoot,
    trackedFiles: [".codex/session.json", "src/client/admin/styles/accounts.css"],
  });
  assert.deepEqual(violations.map((violation) => violation.code).sort(), [
    "INLINE_STYLE_ATTRIBUTE",
    "NON_CAMEL_CASE_CLASS",
    "TRACKED_LOCAL_AI_FILE",
  ]);
});
