import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { STYLE_BUNDLES, renderStyleBundle } from "../scripts/build-styles.ts";
import { findEngineeringConventionViolations } from "../scripts/check-engineering-conventions.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function files(directory: string, extension: string): Promise<string[]> {
  const entries = await readdir(path.join(repositoryRoot, directory), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("feature-first style modules deterministically own the public CSS bundles", async () => {
  const examBundle = STYLE_BUNDLES.find((bundle) => bundle.output === "public/exam/exam.css");
  assert.deepEqual(STYLE_BUNDLES.map((bundle) => bundle.output), ["public/exam/exam.css"]);
  assert.equal(examBundle?.sources.length, 7);
  for (const bundle of STYLE_BUNDLES) {
    assert.equal(new Set(bundle.sources).size, bundle.sources.length);
    assert.equal(await readFile(path.join(repositoryRoot, bundle.output), "utf8"), await renderStyleBundle(bundle.sources));
  }
});

test("HTML and authored styles use synchronized camelCase hooks without direct style mutation", async () => {
  const violations = await findEngineeringConventionViolations({ repositoryRoot });
  assert.deepEqual(violations, []);
  const html = (await Promise.all((await files("public", ".html")).map((file) => readFile(file, "utf8")))).join("\n");
  const classNames = [...html.matchAll(/\bclass="([^"]+)"/g)]
    .flatMap((match) => match[1]!.split(/\s+/))
    .filter(Boolean);
  assert.equal(classNames.length > 100, true);
  assert.deepEqual(classNames.filter((className) => !/^[a-z][a-zA-Z0-9]*$/.test(className)), []);
});

test("the legacy room stylesheet pipeline is retired", async () => {
  for (const relativePath of [
    "public/admin/room.css",
    "src/client/admin/styles/foundation.css",
    "src/client/admin/styles/room.css",
  ]) {
    await assert.rejects(access(path.join(repositoryRoot, relativePath)));
  }
});
