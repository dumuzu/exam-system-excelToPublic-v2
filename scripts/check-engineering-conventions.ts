import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const CAMEL_CASE_CLASS = /^[a-z][a-zA-Z0-9]*$/;
const LOCAL_AI_PATH = /(^|\/)(?:\.codex|\.agents|\.cursor|\.claude|\.continue|\.roo|\.windsurf)(?:\/|$)|(^|\/)\.aider[^/]*$/i;

export type EngineeringConventionCode =
  | "TRACKED_LOCAL_AI_FILE"
  | "INLINE_STYLE_ATTRIBUTE"
  | "DIRECT_STYLE_MUTATION"
  | "NON_CAMEL_CASE_CLASS"
  | "NON_CAMEL_CASE_CUSTOM_PROPERTY";

export interface EngineeringConventionViolation {
  code: EngineeringConventionCode;
  file: string;
  detail: string;
}

interface ConventionCheckOptions {
  repositoryRoot: string;
  trackedFiles?: readonly string[];
}

async function listFiles(directory: string, extension: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function relativePath(repositoryRoot: string, file: string): string {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

async function gitTrackedFiles(repositoryRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: repositoryRoot, encoding: "utf8" });
  return stdout.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/"));
}

function cssClassNames(css: string): string[] {
  return [...css.matchAll(/(?:^|[\s,{>+~])\.([A-Za-z_][A-Za-z0-9_-]*)/gm)].map((match) => match[1]!);
}

function cssCustomProperties(css: string): string[] {
  return [...css.matchAll(/--([a-z][A-Za-z0-9-]*)/g)].map((match) => match[1]!);
}

export async function findEngineeringConventionViolations({
  repositoryRoot,
  trackedFiles,
}: ConventionCheckOptions): Promise<EngineeringConventionViolation[]> {
  const violations: EngineeringConventionViolation[] = [];
  const normalizedTrackedFiles = trackedFiles ?? await gitTrackedFiles(repositoryRoot);

  for (const file of normalizedTrackedFiles) {
    const normalized = file.replaceAll("\\", "/");
    if (LOCAL_AI_PATH.test(normalized)) {
      violations.push({ code: "TRACKED_LOCAL_AI_FILE", file: normalized, detail: "本机 AI 辅助文件不应被 Git 跟踪" });
    }
  }

  const htmlFiles = await listFiles(path.join(repositoryRoot, "public"), ".html");
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    if (/\sstyle\s*=/i.test(html)) {
      violations.push({ code: "INLINE_STYLE_ATTRIBUTE", file: relativePath(repositoryRoot, file), detail: "HTML 样式必须通过命名类封装" });
    }
  }

  const clientRoot = path.join(repositoryRoot, "src", "client");
  const clientTypeScriptFiles = [
    ...await listFiles(clientRoot, ".ts"),
    ...await listFiles(clientRoot, ".tsx"),
  ];
  for (const file of clientTypeScriptFiles) {
    const source = await readFile(file, "utf8");
    if (/\.style(?:\.|\[)|\.cssText\b/.test(source)) {
      violations.push({ code: "DIRECT_STYLE_MUTATION", file: relativePath(repositoryRoot, file), detail: "动态样式必须通过命名类、属性或原生控件表达" });
    }
  }

  const cssFiles = await listFiles(clientRoot, ".css");
  for (const file of cssFiles) {
    const css = await readFile(file, "utf8");
    for (const className of new Set(cssClassNames(css))) {
      if (!CAMEL_CASE_CLASS.test(className)) {
        violations.push({
          code: "NON_CAMEL_CASE_CLASS",
          file: relativePath(repositoryRoot, file),
          detail: `CSS 类名 .${className} 必须使用 camelCase`,
        });
      }
    }
    for (const propertyName of new Set(cssCustomProperties(css))) {
      if (propertyName.includes("-")) {
        violations.push({
          code: "NON_CAMEL_CASE_CUSTOM_PROPERTY",
          file: relativePath(repositoryRoot, file),
          detail: `CSS 自定义属性 --${propertyName} 必须使用 camelCase`,
        });
      }
    }
  }

  return violations;
}

export function formatEngineeringConventionViolations(violations: readonly EngineeringConventionViolation[]): string {
  return violations.map((violation) => `${violation.code} ${violation.file}: ${violation.detail}`).join("\n");
}

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const violations = await findEngineeringConventionViolations({ repositoryRoot });
  if (violations.length > 0) {
    console.error(formatEngineeringConventionViolations(violations));
    process.exitCode = 1;
    return;
  }
  console.log("Engineering conventions: PASS");
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) await main();
