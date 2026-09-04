import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function text(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, root), "utf8");
}

test("the public package supports a published image and an optional local build", async () => {
  const [packageJson, dockerfile, dockerignore, compose, composeBuild, dockerEnvironment, bootstrap, workflow, readme] = await Promise.all([
    text("package.json").then(JSON.parse),
    text("Dockerfile"),
    text(".dockerignore"),
    text("compose.yaml"),
    text("compose.build.yaml"),
    text(".env.docker.example"),
    text("scripts/bootstrap-super-admin.ts"),
    text(".github/workflows/ci.yml"),
    text("README.md"),
  ]);

  assert.match(packageJson.scripts.start, /src\/server\/server\.ts/);
  assert.match(dockerfile, /FROM node:24-/);
  assert.match(dockerfile, /HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /\/api\/health/);
  assert.match(dockerfile, /org\.opencontainers\.image\.source/);
  assert.doesNotMatch(dockerfile, /vercel/i);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^test$/m);
  assert.match(packageJson.scripts["docker:validate"], /validate-docker-environment/);
  assert.match(compose, /postgres:17-alpine/);
  assert.match(compose, /ghcr\.io\/dumuzu\/exam-system-exceltopublic-v2/);
  assert.doesNotMatch(compose, /build:\s*\n/);
  assert.match(composeBuild, /build:\s*\n\s+context: \./);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(compose, /BOOTSTRAP_IF_MISSING: "true"/);
  assert.doesNotMatch(compose, /5432:5432/);
  assert.match(dockerEnvironment, /POSTGRES_PASSWORD=replace-/);
  assert.match(dockerEnvironment, /BOOTSTRAP_ADMIN_PASSWORD=replace-/);
  assert.match(bootstrap, /bootstrapIfMissing/);
  assert.match(bootstrap, /bootstrap was skipped/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /docker\/build-push-action@[a-f0-9]{40}/);
  assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(workflow, /\$\{\{ env\.IMAGE \}\}:latest/);
  assert.match(readme, /Node\.js 24/);
  assert.match(readme, /Docker/);
  assert.match(readme, /docker compose --env-file \.env\.docker pull/);
  assert.match(readme, /compose\.build\.yaml/);
  assert.match(readme, /ghcr\.io\/dumuzu\/exam-system-exceltopublic-v2:latest/);
});

test("the public package documents an empty operational-data baseline", async () => {
  const readme = await text("README.md");
  assert.match(readme, /不包含任何现有考试、考场、教师账号、学生名册、答卷、违规记录或成绩数据/);
  assert.match(readme, /npm run check:public-release/);
});
