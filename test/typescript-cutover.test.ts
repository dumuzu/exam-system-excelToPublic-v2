import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authoredRoots = ["api", "scripts", "src", "test", "test-support"];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(repositoryRoot, directory), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

async function text(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("every authored application, test and operation module is TypeScript", async () => {
  const files = (await Promise.all(authoredRoots.map(sourceFiles))).flat();
  const unchecked = files.filter((file) => /\.(?:js|mjs|cjs)$/.test(file));
  assert.deepEqual(unchecked, []);
  assert.equal(files.some((file) => file.endsWith("typescript-cutover.test.ts")), true);
});

test("Node and browser builds extend one strict configuration family", async () => {
  const [base, node, client] = await Promise.all([
    text("tsconfig.base.json").then(JSON.parse),
    text("tsconfig.json").then(JSON.parse),
    text("tsconfig.client.json").then(JSON.parse),
  ]);
  assert.equal(base.compilerOptions.strict, true);
  assert.equal(node.extends, "./tsconfig.base.json");
  assert.equal(client.extends, "./tsconfig.base.json");
  assert.equal("allowJs" in node.compilerOptions, false);
  assert.equal("checkJs" in node.compilerOptions, false);
  assert.equal(node.include.includes("test/**/*"), true);
});

test("check, test, start, serverless and browser commands use TypeScript paths", async () => {
  const [packageJson, vercel, readme] = await Promise.all([
    text("package.json").then(JSON.parse),
    text("vercel.json"),
    text("README.md"),
  ]);
  const commandText = Object.values(packageJson.scripts).join("\n");
  assert.doesNotMatch(commandText, /\.mjs\b/);
  assert.equal("postinstall" in packageJson.scripts, false);
  assert.match(packageJson.scripts.start, /\.ts\b/);
  assert.match(packageJson.scripts.test, /node --test/);
  assert.match(packageJson.scripts["build:client"], /tsconfig\.client\.json/);
  assert.match(vercel, /api\/index\.ts/);
  assert.match(vercel, /\{public\/\*\*,src\/\*\*\}/);
  assert.doesNotMatch(readme, /\.test\.mjs\b/);
  assert.match(readme, /npm run check/);
  assert.match(readme, /npm run build:client/);
});
