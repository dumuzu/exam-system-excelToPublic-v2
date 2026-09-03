import { z } from "zod";

import {
  MAX_EXAM_REQUEST_BODY_BYTES as sharedMaximumExamRequestBytes,
  importRosterFiles as importSharedRosterFiles,
} from "../../../shared/roster/index.ts";
import type { RosterImportResult } from "../types.ts";

export const maximumExcelExamRequestBytes = Number(sharedMaximumExamRequestBytes);
export const maximumManualExamRequestBytes = 4 * 1024 * 1024;

const rosterImportResultSchema = z.object({
  text: z.string().min(1),
  count: z.number().int().positive(),
  duplicateCount: z.number().int().nonnegative(),
  sourceFileCount: z.number().int().positive(),
  originalByteLength: z.number().int().positive(),
  previewRows: z.array(z.object({
    studentNumber: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
    name: z.string().min(1).max(100),
    sourceFiles: z.array(z.string()),
  })),
  files: z.array(z.object({
    name: z.string().min(1),
    studentCount: z.number().int().nonnegative(),
    sheetCount: z.number().int().positive(),
    sheets: z.array(z.object({
      name: z.string().min(1),
      studentCount: z.number().int().nonnegative(),
    })),
    encoding: z.string().nullable(),
    originalByteLength: z.number().int().positive(),
  })),
}).transform((result): RosterImportResult => result);

export class RosterImportError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, details: Readonly<Record<string, unknown>> = {}) {
    super(code);
    this.name = "RosterImportError";
    this.code = code;
    this.details = details;
  }
}

function normalizeRosterError(error: unknown): RosterImportError {
  if (!error || typeof error !== "object") return new RosterImportError("ROSTER_FILE_PARSE_FAILED");
  const record = error as Record<string, unknown>;
  const code = typeof record["code"] === "string" ? record["code"] : "ROSTER_FILE_PARSE_FAILED";
  return new RosterImportError(code, record);
}

// 工作簿解析器只在教师选择 Excel 名册后加载，不进入首屏主线程任务。
export async function importRosterFiles(
  files: FileList | readonly File[],
  maximumStudents: number,
): Promise<RosterImportResult> {
  try {
    const selectedFiles = Array.from(files);
    const hasWorkbook = selectedFiles.some((file) => /\.(?:xlsx?|xlsm)$/i.test(file.name));
    const workbookParser = hasWorkbook ? await import("xlsx") : null;
    const result: unknown = await importSharedRosterFiles(selectedFiles, { maximumStudents, workbookParser });
    return rosterImportResultSchema.parse(result);
  } catch (error) {
    if (error instanceof z.ZodError) throw new RosterImportError("ROSTER_IMPORT_RESULT_INVALID");
    throw normalizeRosterError(error);
  }
}

export function jsonRequestByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
