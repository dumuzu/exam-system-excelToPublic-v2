import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { publishStudentEntry } from "./scripts/publish-student-entry.ts";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(repositoryRoot, "src", "client", "app"),
  base: "/admin/react/",
  plugins: [
    react(),
    {
      name: "publish-student-entry",
      apply: "build",
      async closeBundle() {
        await publishStudentEntry();
      },
    },
  ],
  build: {
    outDir: path.join(repositoryRoot, "public", "admin", "react"),
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        admin: path.join(repositoryRoot, "src", "client", "app", "index.html"),
        studentEntry: path.join(repositoryRoot, "src", "client", "student-entry", "main.tsx"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
