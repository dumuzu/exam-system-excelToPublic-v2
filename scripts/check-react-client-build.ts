import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ViteManifestEntry {
  file: string;
  css?: string[];
  isEntry?: boolean;
  name?: string;
  src?: string;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repositoryRoot, "public", "admin", "react");
const manifestPath = path.join(outputRoot, ".vite", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, ViteManifestEntry>;
const entries = Object.values(manifest);
const adminEntry = manifest["index.html"];
const studentEntry = entries.find((candidate) =>
  candidate.isEntry
  && (candidate.name === "studentEntry" || candidate.src?.endsWith("student-entry/main.tsx")),
);

if (!adminEntry?.isEntry) throw new Error("React client manifest does not contain the administrator entry module.");
if (!studentEntry) throw new Error("React client manifest does not contain the student entry module.");

const generatedFiles = new Set([
  ...entries.map((candidate) => candidate.file),
  ...entries.flatMap((candidate) => candidate.css ?? []),
]);

for (const file of generatedFiles) {
  if (!/^assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2)$/.test(file) || file.endsWith(".map")) {
    throw new Error(`React client emitted a non-publishable asset: ${file}`);
  }
  await access(path.join(outputRoot, file));
}

const html = await readFile(path.join(outputRoot, "index.html"), "utf8");
if (!html.includes(`/admin/react/${adminEntry.file}`) || html.includes("src/client")) {
  throw new Error("React client HTML does not reference the generated entry safely.");
}

const examHtml = await readFile(path.join(repositoryRoot, "public", "exam", "index.html"), "utf8");
if (!examHtml.includes(`/admin/react/${studentEntry.file}`)
  || !examHtml.includes('id="studentEntryRoot"')
  || examHtml.includes("student-entry-pending")) {
  throw new Error("Student exam HTML does not reference the generated React entry safely.");
}

console.log(`React client build: PASS (${generatedFiles.size} generated assets, 2 entry modules)`);
