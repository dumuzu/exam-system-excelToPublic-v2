import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

interface TypeScriptConfig {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repositoryRoot, "tsconfig.client.json");
const compilerOptions = await resolveCompilerOptions(configPath);

if (compilerOptions["strict"] !== true
  || compilerOptions["noEmitOnError"] !== true
  || compilerOptions["sourceMap"] !== false) {
  console.error("Browser builds require strict=true, noEmitOnError=true and sourceMap=false.");
  process.exitCode = 1;
} else {
  await removeStaleBrowserModules();
}

async function resolveCompilerOptions(filePath: string, visited = new Set<string>()): Promise<Record<string, unknown>> {
  const resolvedPath = path.resolve(filePath);
  if (visited.has(resolvedPath)) throw new Error(`Circular TypeScript config inheritance: ${resolvedPath}`);
  visited.add(resolvedPath);
  const config = JSON.parse(await readFile(resolvedPath, "utf8")) as TypeScriptConfig;
  let inherited: Record<string, unknown> = {};
  if (config.extends) {
    const extendedPath = path.resolve(path.dirname(resolvedPath), config.extends);
    inherited = await resolveCompilerOptions(extendedPath, visited);
  }
  return { ...inherited, ...config.compilerOptions };
}

async function removeStaleBrowserModules() {
  for (const directory of ["exam"]) {
    const sourceDirectory = path.join(repositoryRoot, "src", "client", directory);
    const outputDirectory = path.join(repositoryRoot, "public", directory);
    const expected = new Set((await readdir(sourceDirectory))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.replace(/\.ts$/, ".js")));
    for (const entry of await readdir(outputDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".js") || expected.has(entry.name)) continue;
      const stalePath = path.resolve(outputDirectory, entry.name);
      if (path.dirname(stalePath) !== outputDirectory) throw new Error("Refusing to clean an output outside the browser directory.");
      await rm(stalePath);
    }
  }
}
