import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestEntry {
  file: string;
  isEntry?: boolean;
  name?: string;
  src?: string;
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function publishStudentEntry(): Promise<void> {
  const manifestPath = path.join(repositoryRoot, "public", "admin", "react", ".vite", "manifest.json");
  const examHtmlPath = path.join(repositoryRoot, "public", "exam", "index.html");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, ManifestEntry>;
  const studentEntry = Object.values(manifest).find((entry) =>
    entry.isEntry
    && (entry.name === "studentEntry" || entry.src?.endsWith("student-entry/main.tsx")),
  );

  if (!studentEntry || !/^assets\/[A-Za-z0-9_.-]+\.js$/.test(studentEntry.file)) {
    throw new Error("Vite manifest does not contain the student entry module.");
  }

  const html = await readFile(examHtmlPath, "utf8");
  const marker = /<!-- student-entry-react:start -->[\s\S]*?<!-- student-entry-react:end -->/;
  if (!marker.test(html)) throw new Error("Student entry publication marker is missing.");

  const published = html.replace(
    marker,
    `<!-- student-entry-react:start -->\n    <script type="module" crossorigin src="/admin/react/${studentEntry.file}"></script>\n    <!-- student-entry-react:end -->`,
  );
  await writeFile(examHtmlPath, published, "utf8");
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) await publishStudentEntry();
