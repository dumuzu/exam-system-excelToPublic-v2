import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, root), "utf8");
}

test("the public package runs as a standard Node service with an optional Docker image", async () => {
  const [packageJson, dockerfile, dockerignore, readme] = await Promise.all([
    text("package.json").then(JSON.parse),
    text("Dockerfile"),
    text(".dockerignore"),
    text("README.md"),
  ]);

  assert.match(packageJson.scripts.start, /src\/server\/server\.ts/);
  assert.match(dockerfile, /FROM node:24-/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /\/api\/health/);
  assert.doesNotMatch(dockerfile, /vercel/i);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^test$/m);
  assert.match(readme, /Node\.js 进程/);
  assert.match(readme, /Docker/);
  assert.match(readme, /Vercel（可选）/);
  assert.match(readme, /不依赖 Vercel/);
});

test("the public package documents an empty operational-data baseline", async () => {
  const readme = await text("README.md");
  assert.match(readme, /不包含任何现有考试、考场、教师账号、学生名册、答卷、违规记录或成绩数据/);
  assert.match(readme, /npm run check:public-release/);
});
