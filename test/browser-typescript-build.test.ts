import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root: any = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authoredModules: any = [
  "src/client/exam/browser-compatibility.ts",
  "src/client/exam/exam-behavior-guard.ts",
  "src/client/exam/exam.ts",
  "src/client/exam/formula-assistant.ts",
  "src/client/exam/fullscreen-compatibility.ts",
  "src/client/exam/japanese-readings.ts",
  "src/client/exam/submission-request.ts",
  "src/client/shared/roster/index.ts",
];

async function text(relativePath: any) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("every shipped browser module has strict TypeScript source outside public assets", async () => {
  await Promise.all(authoredModules.map((relativePath: any) => access(path.join(root, relativePath))));
  const sourceFiles: any = await readdir(path.join(root, "src/client/exam"));
  assert.equal(sourceFiles.some((name: any) => name.endsWith(".js")), false);

  const [tsconfig, reactConfig, baseConfig]: any = await Promise.all([
    text("tsconfig.client.json").then(JSON.parse),
    text("tsconfig.react.json").then(JSON.parse),
    text("tsconfig.base.json").then(JSON.parse),
  ]);
  assert.equal(tsconfig.extends, "./tsconfig.base.json");
  assert.equal(baseConfig.compilerOptions.strict, true);
  assert.equal(tsconfig.compilerOptions.noEmitOnError, true);
  assert.equal(tsconfig.compilerOptions.rootDir, "src/client");
  assert.equal(tsconfig.compilerOptions.outDir, "public");
  assert.equal(tsconfig.compilerOptions.sourceMap, false);
  assert.deepEqual(tsconfig.include, [
    "src/client/exam/**/*.ts",
    "src/client/shared/safe-markdown.ts",
  ]);
  assert.equal(reactConfig.extends, "./tsconfig.base.json");
  assert.equal(reactConfig.compilerOptions.noEmit, true);
  assert.equal(reactConfig.compilerOptions.jsx, "react-jsx");
});

test("the deterministic browser build lifecycle owns public JavaScript generation", async () => {
  const [builder, packageJson] = await Promise.all([
    text("scripts/build-client.ts"),
    text("package.json").then(JSON.parse),
  ]);
  assert.match(builder, /tsconfig\.client\.json/);
  assert.match(builder, /removeStaleBrowserModules/);
  assert.match(builder, /noEmitOnError/);
  assert.equal(
    packageJson.scripts["prebuild:client"],
    "node scripts/build-client.ts && node scripts/build-styles.ts",
  );
  assert.equal(packageJson.scripts["build:client"], "tsc --project tsconfig.client.json && vite build");
  assert.equal(packageJson.scripts["typecheck"].includes("tsconfig.react.json"), true);
  assert.match(packageJson.scripts["check:generated"], /public\/shared\/safe-markdown\.js/);
  assert.doesNotMatch(packageJson.scripts["check:generated"], /public\/admin\//);
});

test("the retired live-room shell is absent from authored and generated assets", async () => {
  for (const relativePath of [
    "src/client/admin/room-selection.ts",
    "src/client/admin/room-shell.ts",
    "src/client/admin/room.ts",
    "public/admin/room-selection.js",
    "public/admin/room-shell.js",
    "public/admin/room.js",
    "public/admin/room.css",
    "public/admin/room.html",
  ]) {
    await assert.rejects(access(path.join(root, relativePath)));
  }
});

test("exam hot paths batch DOM work and defer formula assistance", async () => {
  const [source, output] = await Promise.all([
    text("src/client/exam/exam.ts"),
    text("public/exam/exam.js"),
  ]);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /scheduleSelectionPaint/);
  assert.match(source, /scheduleQuestionIndexRender/);
  assert.match(source, /scheduleMarkdownPreview/);
  assert.match(source, /replaceChildren\(\.\.\.optionNodes\)/);
  assert.match(output, /import\("\.\/formula-assistant\.js"\)/);
  assert.doesNotMatch(output, /^import .*formula-assistant\.js/m);
});

test("browser packaging keeps routes stable, self-hosted and free of source maps", async () => {
  const pages: any = await Promise.all([
    "public/admin/react/index.html",
    "public/exam/index.html",
  ].map(text));
  assert.equal(
    pages.every((page: any) => /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="\/(?:admin|exam)\/[^"]+\.js")[^>]*><\/script>/.test(page)),
    true,
  );
  assert.equal(pages.some((page: any) => /(?:src|href)="https?:\/\//.test(page)), false);

  const adminEntries = await readdir(path.join(root, "public/admin"), { withFileTypes: true });
  assert.deepEqual(
    adminEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".js")).map((entry) => entry.name).sort(),
    [],
  );
  assert.deepEqual(
    adminEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".html")).map((entry) => entry.name).sort(),
    [],
  );
  assert.deepEqual(
    adminEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".css")).map((entry) => entry.name).sort(),
    [],
  );

  const maps: any = (await Promise.all([
    readdir(path.join(root, "public/admin")),
    readdir(path.join(root, "public/exam")),
  ])).flat().filter((name) => name.endsWith(".map"));
  assert.deepEqual(maps, []);

});
