import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const secret = (label: string, minimumLength: number) => z.string()
  .min(minimumLength, `${label} must contain at least ${minimumLength} characters.`)
  .max(256, `${label} must contain no more than 256 characters.`)
  .refine((value) => !value.toLowerCase().startsWith("replace-"), `${label} still contains the example placeholder.`);

const dockerEnvironmentSchema = z.object({
  POSTGRES_PASSWORD: secret("POSTGRES_PASSWORD", 16)
    .regex(/^[A-Za-z0-9_-]+$/, "POSTGRES_PASSWORD must use only URL-safe letters, numbers, underscores and hyphens."),
  SESSION_SECRET: secret("SESSION_SECRET", 32),
  CRON_SECRET: secret("CRON_SECRET", 32),
  BOOTSTRAP_ADMIN_PASSWORD: z.union([
    z.literal(""),
    secret("BOOTSTRAP_ADMIN_PASSWORD", 12),
  ]),
});

export function validateDockerEnvironment(environment: NodeJS.ProcessEnv): void {
  const result = dockerEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Docker environment validation failed:\n${messages.join("\n")}`);
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) {
  validateDockerEnvironment(process.env);
  process.stdout.write("Docker environment validation passed.\n");
}
