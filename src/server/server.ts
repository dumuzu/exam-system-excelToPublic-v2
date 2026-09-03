import { createServer, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { AdminSession, LoginResponse, WorkspaceSubject } from "../types/contracts/admin-auth.ts";
import {
  authoringConfigurationResponseSchema,
  authoringFunctionListResponseSchema,
  authoringModeListResponseSchema,
  authoringPreviewResponseSchema,
  preparationResponseSchema,
  preparationStepBodySchema,
  publishAssessmentResponseSchema,
} from "../types/contracts/exam-authoring.ts";
import { gradeResultIdSchema } from "../types/contracts/results.ts";
import { studentVerificationResponseSchema } from "../types/contracts/student-entry.ts";
import {
  ADMIN_PERMISSIONS,
  createAdminSession,
  createLoginRateLimitKey,
  createLoginRateLimiter,
  getAdminPermissions,
  getAuthConfigFromEnvironment,
  getLegacyAccounts,
  hashAdminPassword,
  hasAdminPermission,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  verifyAdminCredentials,
  verifyCsrfToken,
  verifyPersistedAdminCredentials,
  verifyPersistedAdminSession,
} from "./admin-auth.ts";
import type { AdminAuthConfig, AdminPermission, AdminSessionPayload } from "./admin-auth.ts";
import { authorizeAdminPage, getAdminLandingPath, getAdminNavigation, matchAdminPageRoute } from "./admin-route-policy.ts";
import { getCapacityPolicyFromEnvironment, normalizeCapacityPolicy, type CapacityPolicy } from "./capacity-policy.ts";
import { authorizeTeacherAction, getAuthorizedSubjectPermissions, getSubjectAuthorizedPermissions, resolveSubjectId } from "./authorization-policy.ts";
import type { AuthorizationDecision, AuthorizationResource, TeacherAuthorizationActor } from "./authorization-policy.ts";
import { createExamHistoryRepository } from "./exam-history-repository.ts";
import { createStudentExamRepository, PROCTOR_VIOLATION_LIMIT, type StudentExamRepository } from "./student-exam-repository.ts";
import { createTeacherAccountRepository, DEFAULT_EXCEL_SUBJECT_ID } from "./teacher-account-repository.ts";
import type { PublicSubject, TeacherAccountRepository } from "./teacher-account-repository.ts";
import {
  createSubmissionConfirmation,
  createStudentSession,
  hashStudentSession,
  serializeStudentSessionCookie,
  verifySubmissionConfirmation,
  verifyStudentSession,
} from "./student-auth.ts";
import type { StudentSessionPayload } from "./student-auth.ts";
import {
  decodeManagedAccountId,
  decodeManagedSubjectId,
  validateAccountCreation,
  validateAccountMembershipBatchMutation,
  validateAccountMembershipMutation,
  validateAccountPage,
  validateAccountPasswordMutation,
  validateAccountRoleMutation,
  validateAccountStatusMutation,
  validateSubjectCreation,
  validateSubjectSettingsMutation,
  validateSubjectStatusMutation,
} from "../features/account-administration/domain/account-input.ts";
import {
  composeSubjectAssessment,
  getAssessmentModeDefinitions,
  supportsAssessmentTypeKey,
  usesExcelAuthoring,
  usesManualAuthoring,
  validateConfigurationName,
  validateConfigurationPayload,
  validateAssessmentDuration,
  validatePlanPayload,
} from "../features/assessment-authoring/domain/assessment-authoring.ts";
import {
  validateAnswerPayload,
  validateBrowserPreflight,
  validateGradeAdjustment,
  validateProctorEvent,
  validateStudentVerificationPayload,
  validateSubmissionPayload,
} from "../features/exam-delivery/domain/exam-input.ts";
import { ASSIGNMENT_MODE, getRosterLimit } from "../core/exam-mode-config.ts";
import { FUNCTION_CATALOG } from "../core/function-catalog.ts";
import { auditExamPublication } from "../core/question-publication-gate.ts";
import { parseRosterCsv } from "../core/roster-csv.ts";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDirectory = path.resolve(moduleDirectory, "../../public");
const verifiedAdminSessions = new WeakMap<IncomingMessage, AdminSessionPayload>();
const verifiedAdminActors = new WeakMap<IncomingMessage, TeacherAuthorizationActor>();
const transientDatabaseCodes = new Set(["08000", "08001", "08003", "08004", "08006", "57P01", "57P02", "57P03"]);
interface ReactClientAssetManifestCacheEntry {
  modifiedTimeMs: number;
  size: number;
  files: Promise<ReadonlySet<string>>;
}

const reactClientAssetManifestCache = new Map<string, ReactClientAssetManifestCacheEntry>();

type HttpError = Error & { code?: string; statusCode?: number };
export interface AppRequestHandlerOptions {
  publicDirectory?: string;
  authConfig?: AdminAuthConfig | null;
  capacityPolicy?: Partial<CapacityPolicy>;
  historyRepository?: ReturnType<typeof createExamHistoryRepository>;
  studentExamRepository?: StudentExamRepository;
  teacherAccountRepository?: TeacherAccountRepository;
  publicationGate?: typeof auditExamPublication;
  internalTaskSecret?: string;
  isProduction?: boolean;
}

function isTransientDatabaseDisconnect(error: unknown) {
  const failure = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const code = String(failure.code ?? "").toUpperCase();
  const message = String(failure.message ?? "");
  return transientDatabaseCodes.has(code)
    || code === "ECONNRESET"
    || /connection (?:terminated|closed|reset)|socket hang up/i.test(message);
}

async function retryTransientDatabaseDisconnect<Result>(operation: () => Promise<Result>, { maximumAttempts = 2 }: { maximumAttempts?: number } = {}): Promise<Result> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maximumAttempts || !isTransientDatabaseDisconnect(error)) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
    }
  }
  throw lastError;
}

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

// A file placed under public/ is not internet-facing until it is deliberately
// added here. This prevents accidental publication of maps, backups and notes.
const publicStaticFiles = new Set([
  "admin/react/index.html",
  "exam/browser-compatibility.js",
  "exam/exam-behavior-guard.js",
  "exam/exam.css",
  "exam/exam.js",
  "exam/formula-assistant.js",
  "exam/fullscreen-compatibility.js",
  "exam/index.html",
  "exam/japanese-readings.js",
  "exam/submission-request.js",
  "exam/student-entry-bridge.js",
  "shared/safe-markdown.js",
]);

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// React 构建资源只信任 Vite Manifest 中的精确路径，避免 public 目录意外暴露源码或备份文件。
async function getReactClientAssetFiles(publicDirectory: string): Promise<ReadonlySet<string>> {
  const resolvedPublicDirectory = path.resolve(publicDirectory);
  const manifestPath = path.join(resolvedPublicDirectory, "admin", "react", ".vite", "manifest.json");
  let manifestFile: Awaited<ReturnType<typeof stat>>;
  try {
    manifestFile = await stat(manifestPath);
  } catch {
    return new Set<string>();
  }

  const cachedManifest = reactClientAssetManifestCache.get(resolvedPublicDirectory);
  if (cachedManifest
    && cachedManifest.modifiedTimeMs === manifestFile.mtimeMs
    && cachedManifest.size === manifestFile.size) {
    return cachedManifest.files;
  }

  const manifestPromise = (async () => {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      if (!isUnknownRecord(manifest)) return new Set<string>();

      const assetFiles = new Set<string>();
      for (const entry of Object.values(manifest)) {
        if (!isUnknownRecord(entry)) continue;
        const candidates = [entry["file"], ...(Array.isArray(entry["css"]) ? entry["css"] : [])];
        for (const candidate of candidates) {
          if (typeof candidate !== "string") continue;
          if (!/^assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2)$/.test(candidate)) continue;
          assetFiles.add(`admin/react/${candidate}`);
        }
      }
      return assetFiles;
    } catch {
      return new Set<string>();
    }
  })();

  reactClientAssetManifestCache.set(resolvedPublicDirectory, {
    modifiedTimeMs: manifestFile.mtimeMs,
    size: manifestFile.size,
    files: manifestPromise,
  });
  return manifestPromise;
}
const contentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'none'",
].join("; ");

function setCommonHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Security-Policy", contentSecurityPolicy);
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Origin-Agent-Cluster", "?1");
  response.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-DNS-Prefetch-Control", "off");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown, headers: OutgoingHttpHeaders = {}) {
  setCommonHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, statusCode: number, message: string) {
  setCommonHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

function csvCell(value: any) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function sendResultsCsv(response: ServerResponse, examCode: string, results: any[]) {
  const questionCount = Math.max(0, ...results.map((item: any) => item.questionResults?.length ?? 0));
  const questionHeaders = Array.from(
    { length: questionCount },
    (_: any, index: any) => `Q${String(index + 1).padStart(2, "0")} Result`,
  );
  const statusLabel = (status: any) => {
    if (status === "correct") return "Correct";
    if (status === "partial_core_function_missing") return "Partial";
    if (status === "incorrect") return "Incorrect";
    return "Unanswered";
  };
  const rows = [
    [
      "Student Number",
      "Name",
      "Highest Score",
      "Highest Maximum Score",
      "Latest Score",
      "Choice Accuracy (%)",
      "Formula Accuracy (%)",
      "Attempt Count",
      "Warning Count",
      "Policy Suspension Count",
      "Forced Submission Count",
      "Warning Events",
      "Correct Count",
      "Incorrect Count",
      ...questionHeaders,
    ],
    ...results.map((item: any) => {
      const isGraded = item.gradingStatus === "graded";
      const correctCount = Number(item.choiceCorrect ?? 0) + Number(item.formulaCorrect ?? 0);
      const totalCount = Number(item.choiceTotal ?? 0) + Number(item.formulaTotal ?? 0);
      return [
        item.studentNumber,
        item.name,
        item.highestScore,
        item.highestMaximumScore,
        item.score,
        isGraded && item.choiceTotal ? Math.round((item.choiceCorrect / item.choiceTotal) * 10000) / 100 : "",
        isGraded && item.formulaTotal ? Math.round((item.formulaCorrect / item.formulaTotal) * 10000) / 100 : "",
        item.attemptCount,
        item.warningCount ?? 0,
        item.policySuspensionCount ?? 0,
        item.forcedSubmissionCount ?? item.policySubmissionCount ?? 0,
        (item.warningEvents ?? []).map((event: any) => `#${event.attemptNumber} ${event.eventType} ${event.occurredAt}`).join(" | "),
        isGraded ? correctCount : "",
        isGraded ? totalCount - correctCount : "",
        ...Array.from({ length: questionCount }, (_: any, index: any) => {
          const result = item.questionResults?.[index];
          return isGraded && result ? statusLabel(result.resultStatus) : "";
        }),
      ];
    }),
  ];
  setCommonHeaders(response);
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${examCode}-results.csv"`,
  });
  response.end(`\uFEFF${rows.map((row: any) => row.map(csvCell).join(",")).join("\r\n")}`);
}

function sendWarningLogCsv(response: ServerResponse, examCode: string, results: any[]) {
  const rows = [[
    "Student Number", "Name", "Attempt Number", "Log Type", "Event Type",
    "Occurred At", "Remaining Seconds", "Resolved At", "Resolved By",
  ]];
  for (const item of results) {
    for (const event of item.warningEvents ?? []) {
      rows.push([item.studentNumber, item.name, event.attemptNumber, "warning", event.eventType, event.occurredAt, "", "", ""]);
    }
    for (const event of item.policySuspensions ?? []) {
      rows.push([item.studentNumber, item.name, event.attemptNumber, "policy_suspension", event.status, event.suspendedAt, event.remainingSeconds, event.resumedAt ?? event.collectedAt, event.resumedBy ?? event.collectedBy]);
    }
    for (const event of item.forcedSubmissionEvents ?? []) {
      rows.push([item.studentNumber, item.name, event.attemptNumber, "forced_submission", event.submissionType, event.submittedAt, "", "", ""]);
    }
  }
  setCommonHeaders(response);
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${examCode}-warning-log.csv"`,
  });
  response.end(`\uFEFF${rows.map((row: any) => row.map(csvCell).join(",")).join("\r\n")}`);
}

function sendEmpty(response: ServerResponse, statusCode: number, headers: OutgoingHttpHeaders = {}) {
  setCommonHeaders(response);
  response.writeHead(statusCode, headers);
  response.end();
}

function redirect(response: ServerResponse, location: string) {
  setCommonHeaders(response);
  response.writeHead(302, { Location: location });
  response.end();
}

async function readJsonBody(request: IncomingMessage, maxRequestBodyBytes: number): Promise<any> {
  const tooLargeError = () => {
    const error = new Error("Request body is too large.") as HttpError;
    error.statusCode = 413;
    error.code = "REQUEST_BODY_TOO_LARGE";
    return error;
  };
  const declaredLength = Number(request.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBodyBytes) throw tooLargeError();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maxRequestBodyBytes) throw tooLargeError();
    chunks.push(buffer);
  }

  if (receivedBytes === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks, receivedBytes).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body.") as HttpError;
    error.statusCode = 400;
    throw error;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((entry: any) => entry.trim().split(/=(.*)/s, 2))
      .filter(([name]: any) => name),
  );
}

function hasValidBearerSecret(request: IncomingMessage, expectedSecret: string | undefined) {
  if (typeof expectedSecret !== "string" || expectedSecret.length < 32) return false;
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function publicCatalog() {
  return FUNCTION_CATALOG.map(({ name, category, modes }: any) => ({ name, category, modes }));
}

function validateLoginPayload(body: any) {
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  return username.length > 0 && username.length <= 100 && password.length > 0 && password.length <= 200
    ? { valid: true, username, password }
    : { valid: false };
}

function resolveSubjectAssessmentType(
  request: IncomingMessage,
  response: ServerResponse,
  subject: PublicSubject,
): { assessmentTypeKey: string } | null {
  const raw = request.headers["x-assessment-type-key"];
  const requested = typeof raw === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(raw) ? raw : null;
  if (raw !== undefined && !requested) {
    sendJson(response, 422, { error: "Select a valid authoring capability.", code: "ASSESSMENT_TYPE_INVALID" });
    return null;
  }
  const assessmentTypeKey = requested ?? (subject.assessmentTypeKeys.length === 1 ? subject.assessmentTypeKeys[0]! : null);
  if (!assessmentTypeKey) {
    sendJson(response, 422, { error: "Select an authoring capability for this assessment.", code: "ASSESSMENT_TYPE_REQUIRED" });
    return null;
  }
  if (!subject.assessmentTypeKeys.includes(assessmentTypeKey as PublicSubject["assessmentTypeKeys"][number])) {
    sendJson(response, 422, { error: "That authoring capability is not enabled for this subject.", code: "ASSESSMENT_TYPE_NOT_AVAILABLE" });
    return null;
  }
  if (!supportsAssessmentTypeKey(assessmentTypeKey)) {
    sendJson(response, 422, { error: "The selected authoring capability is not supported.", code: "ASSESSMENT_TYPE_UNSUPPORTED" });
    return null;
  }
  return { assessmentTypeKey };
}

function firstForwardedAddress(value: any) {
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") return "";
  return header.split(",", 1)[0]!.trim().slice(0, 128);
}

function getRequestIp(request: IncomingMessage) {
  if (process.env["VERCEL"] === "1") {
    const forwardedAddress = firstForwardedAddress(request.headers["x-vercel-forwarded-for"])
      || firstForwardedAddress(request.headers["x-forwarded-for"])
      || firstForwardedAddress(request.headers["x-real-ip"]);
    if (forwardedAddress) return forwardedAddress;
  }
  return request.socket.remoteAddress ?? "unknown";
}

function getStudentVerificationRateLimitKey(request: IncomingMessage, verification: any) {
  const identityScope = verification.valid
    ? `${verification.examCode}:${verification.studentNumber}`
    : "invalid-payload";
  return `${getRequestIp(request)}:${identityScope}`;
}

function getSession(request: IncomingMessage, authConfig: AdminAuthConfig | null): AdminSessionPayload | null {
  return authConfig ? (verifiedAdminSessions.get(request) ?? null) : null;
}

function requireAdmin(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null): AdminSessionPayload | null {
  if (!authConfig) {
    sendJson(response, 503, { error: "Admin authentication is not configured." });
    return null;
  }

  const session = getSession(request, authConfig);
  if (!session) {
    sendJson(response, 401, { error: "Authentication required." });
    return null;
  }
  return session;
}

function requireAdminPermission(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null, permission: AdminPermission): AdminSessionPayload | null {
  const session = requireAdmin(request, response, authConfig);
  if (!session) return null;
  if (!hasAdminPermission(session, permission)) {
    sendJson(response, 403, { error: "Permission denied.", code: "FORBIDDEN" });
    return null;
  }
  return session;
}

function getAuthorizationActor(request: IncomingMessage) {
  return verifiedAdminActors.get(request) ?? null;
}

function requestedSubjectHeader(request: IncomingMessage): string | null {
  const value = request.headers["x-subject-id"];
  if (typeof value !== "string") return null;
  const subjectId = value.trim();
  return subjectId.length >= 1 && subjectId.length <= 100 && !/[\u0000-\u001f\u007f]/.test(subjectId)
    ? subjectId
    : null;
}

async function findActiveSubject(repository: TeacherAccountRepository, subjectId: string): Promise<PublicSubject | null> {
  return (await repository.listSubjects()).find((subject) => subject.id === subjectId) ?? null;
}

async function listWorkspaceSubjects(actor: TeacherAuthorizationActor, repository: TeacherAccountRepository): Promise<WorkspaceSubject[]> {
  const catalog = await repository.listSubjects();
  if (actor.platformRole === "super_admin" || actor.platformRole === "test_admin") {
    return catalog.map((subject) => ({
      ...subject,
      subjectRole: "subject_admin",
      accessScope: "platform",
      permissions: getAuthorizedSubjectPermissions(actor, subject.id),
    }));
  }
  const memberships = new Map(actor.memberships.map((membership) => [membership.subjectId, membership]));
  return catalog.flatMap((subject) => {
    const membership = memberships.get(subject.id);
    if (!membership) return [];
    return [{
      ...subject,
      subjectRole: membership.subjectRole,
      accessScope: membership.subjectRole === "teacher" ? "personal" : "subject",
      permissions: getAuthorizedSubjectPermissions(actor, subject.id),
    }];
  });
}

async function recordAuthorizationDecision(repository: TeacherAccountRepository, actor: TeacherAuthorizationActor, action: AdminPermission, resource: { subjectId?: string | null; resourceType?: string; resourceId?: string } | null, decision: AuthorizationDecision) {
  if (!decision.auditRequired) return;
  await repository.recordAuthorizationAudit({
    actorAccountId: actor.accountId,
    action,
    subjectId: resource?.subjectId ?? null,
    resourceType: resource?.resourceType ?? "platform",
    resourceId: resource?.resourceId ?? "all",
    decisionCode: decision.code,
  });
}

async function requireAuthorizedCollection(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null, accountRepository: TeacherAccountRepository, permission: AdminPermission) {
  const session = requireAdminPermission(request, response, authConfig, permission);
  if (!session) return null;
  const actor = getAuthorizationActor(request);
  if (!actor) {
    sendJson(response, 403, { error: "Permission denied.", code: "FORBIDDEN" });
    return null;
  }
  const requestedSubjectId = requestedSubjectHeader(request);
  if (request.headers["x-subject-id"] !== undefined && !requestedSubjectId) {
    sendJson(response, 403, { error: "Select an authorized subject.", code: "SUBJECT_REQUIRED" });
    return null;
  }
  const subjectId = requestedSubjectId ?? resolveSubjectId(actor);
  if (!subjectId && actor.platformRole !== "super_admin" && actor.platformRole !== "test_admin") {
    sendJson(response, 403, { error: "Select an authorized subject.", code: "SUBJECT_REQUIRED" });
    return null;
  }
  const subject = subjectId ? await findActiveSubject(accountRepository, subjectId) : null;
  if (subjectId && !subject) {
    sendJson(response, 403, { error: "Subject is not available.", code: "SUBJECT_NOT_FOUND" });
    return null;
  }
  const decision = subjectId
    ? authorizeTeacherAction({ actor, action: permission, subjectId })
    : authorizeTeacherAction({ actor, action: permission, subjectId: DEFAULT_EXCEL_SUBJECT_ID });
  if (!decision?.allowed) {
    sendJson(response, 403, { error: "Permission denied.", code: "FORBIDDEN" });
    return null;
  }
  await recordAuthorizationDecision(accountRepository, actor, permission, subject ? { subjectId: subject.id, resourceType: "subject", resourceId: subject.id } : null, decision);
  return { session, actor, subjectId, subject };
}

async function requireAuthorizedSubject(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null, accountRepository: TeacherAccountRepository, permission: AdminPermission, requestedSubjectId: string | null = null) {
  const session = requireAdminPermission(request, response, authConfig, permission);
  if (!session) return null;
  const actor = getAuthorizationActor(request);
  if (!actor) {
    sendJson(response, 403, { error: "Permission denied.", code: "FORBIDDEN" });
    return null;
  }
  const headerSubjectId = requestedSubjectHeader(request);
  if (request.headers["x-subject-id"] !== undefined && !headerSubjectId) {
    sendJson(response, 403, { error: "Select an authorized subject.", code: "SUBJECT_REQUIRED" });
    return null;
  }
  const subjectId = resolveSubjectId(actor, requestedSubjectId ?? headerSubjectId)
    ?? ((actor.platformRole === "super_admin" || actor.platformRole === "test_admin") ? DEFAULT_EXCEL_SUBJECT_ID : null);
  if (!subjectId) {
    sendJson(response, 403, { error: "Select an authorized subject.", code: "SUBJECT_REQUIRED" });
    return null;
  }
  const subject = await findActiveSubject(accountRepository, subjectId);
  if (!subject) {
    sendJson(response, 403, { error: "Subject is not available.", code: "SUBJECT_NOT_FOUND" });
    return null;
  }
  const decision = authorizeTeacherAction({ actor, action: permission, subjectId });
  if (!decision.allowed) {
    sendJson(response, 403, { error: "Permission denied.", code: "FORBIDDEN" });
    return null;
  }
  await recordAuthorizationDecision(
    accountRepository,
    actor,
    permission,
    { subjectId, resourceType: "subject", resourceId: subjectId },
    decision,
  );
  return { session, actor, subjectId, subject };
}

async function requireAuthorizedExam(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null, accountRepository: TeacherAccountRepository, examRepository: StudentExamRepository, permission: AdminPermission, examCode: string | undefined) {
  if (!examCode) return null;
  const session = requireAdminPermission(request, response, authConfig, permission);
  if (!session) return null;
  const actor = getAuthorizationActor(request);
  if (!actor) {
    sendJson(response, 404, { error: "Exam not found." });
    return null;
  }
  const resource: AuthorizationResource | null = typeof examRepository.getExamAuthorizationTarget === "function"
    ? await examRepository.getExamAuthorizationTarget(examCode)
    : { subjectId: DEFAULT_EXCEL_SUBJECT_ID, ownerAccountId: actor.accountId, resourceType: "exam", resourceId: examCode };
  if (!resource) {
    sendJson(response, 404, { error: "Exam not found." });
    return null;
  }
  const decision = authorizeTeacherAction({ actor, action: permission, resource });
  if (!decision.allowed) {
    sendJson(response, 404, { error: "Exam not found." });
    return null;
  }
  await recordAuthorizationDecision(accountRepository, actor, permission, resource, decision);
  return { session, actor, resource };
}

async function requireAuthorizedConfiguration(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null, accountRepository: TeacherAccountRepository, historyRepository: ReturnType<typeof createExamHistoryRepository>, permission: AdminPermission, configurationId: string | undefined) {
  if (!configurationId) return null;
  const session = requireAdminPermission(request, response, authConfig, permission);
  if (!session) return null;
  const actor = getAuthorizationActor(request);
  const resource = actor && typeof historyRepository.getAuthorizationTarget === "function"
    ? await historyRepository.getAuthorizationTarget(configurationId) as AuthorizationResource | null
    : null;
  if (!actor || !resource || !authorizeTeacherAction({ actor, action: permission, resource }).allowed) {
    sendJson(response, 404, { error: "Configuration not found." });
    return null;
  }
  const selectedSubjectId = requestedSubjectHeader(request);
  if (request.headers["x-subject-id"] !== undefined && !selectedSubjectId) {
    sendJson(response, 403, { error: "Select an authorized subject.", code: "SUBJECT_REQUIRED" });
    return null;
  }
  if (!selectedSubjectId && actor.platformRole !== "super_admin" && actor.platformRole !== "test_admin" && actor.memberships.length > 1) {
    sendJson(response, 403, { error: "Select an authorized subject.", code: "SUBJECT_REQUIRED" });
    return null;
  }
  if (selectedSubjectId) {
    const subject = await findActiveSubject(accountRepository, selectedSubjectId);
    const subjectDecision = subject ? authorizeTeacherAction({ actor, action: permission, subjectId: selectedSubjectId }) : null;
    if (!subject || !subjectDecision?.allowed) {
      sendJson(response, 403, { error: "Subject is not available.", code: subject ? "FORBIDDEN" : "SUBJECT_NOT_FOUND" });
      return null;
    }
    if (resource.subjectId !== selectedSubjectId) {
      sendJson(response, 409, { error: "Configuration belongs to a different subject.", code: "SUBJECT_SCOPE_MISMATCH" });
      return null;
    }
  }
  const decision = authorizeTeacherAction({ actor, action: permission, resource });
  await recordAuthorizationDecision(accountRepository, actor, permission, resource, decision);
  return { session, actor, resource };
}

async function requireAuthorizedGrade(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null, accountRepository: TeacherAccountRepository, examRepository: StudentExamRepository, permission: AdminPermission, gradeResultId: string | undefined) {
  if (!gradeResultId) return null;
  const session = requireAdminPermission(request, response, authConfig, permission);
  if (!session) return null;
  const actor = getAuthorizationActor(request);
  const resource = actor && typeof examRepository.getGradeAuthorizationTarget === "function"
    ? await examRepository.getGradeAuthorizationTarget(gradeResultId)
    : null;
  if (!actor || !resource || !authorizeTeacherAction({ actor, action: permission, resource }).allowed) {
    sendJson(response, 404, { error: "Grade result not found." });
    return null;
  }
  const decision = authorizeTeacherAction({ actor, action: permission, resource });
  await recordAuthorizationDecision(accountRepository, actor, permission, resource, decision);
  return { session, actor, resource };
}

function validateExamLifecycleConfirmation(body: any, examCode: any) {
  const confirmationCode = typeof body?.confirmationCode === "string"
    ? body.confirmationCode.trim().toUpperCase()
    : "";
  return confirmationCode === String(examCode).toUpperCase();
}

function requireCsrf(request: IncomingMessage, response: ServerResponse, session: { csrf: string }) {
  if (!verifyCsrfToken(request.headers["x-csrf-token"], session)) {
    sendJson(response, 403, { error: "Invalid request token." });
    return false;
  }
  return true;
}

function getStudentSession(request: IncomingMessage, authConfig: AdminAuthConfig | null): StudentSessionPayload | null {
  if (!authConfig) return null;
  return verifyStudentSession(parseCookies(request.headers.cookie)["student_session"], authConfig.sessionSecret);
}

function requireStudent(request: IncomingMessage, response: ServerResponse, authConfig: AdminAuthConfig | null): StudentSessionPayload | null {
  const session = getStudentSession(request, authConfig);
  if (!session) sendJson(response, 401, { error: "Student session required." });
  return session;
}

function resolveStaticPath(pathname: any) {
  if (pathname === "/exam" || pathname === "/exam/") return "exam/index.html";
  const adminPage = matchAdminPageRoute(pathname);
  if (adminPage) return adminPage.staticFile;
  return pathname.slice(1);
}

async function serveStaticFile(response: ServerResponse, publicDirectory: string, pathname: string) {
  const requestedFile = resolveStaticPath(pathname);
  const resolvedFile = path.resolve(publicDirectory, requestedFile);
  const allowedPrefix = `${path.resolve(publicDirectory)}${path.sep}`;
  const pathSegments = requestedFile.split(/[\\/]/);
  const normalizedPublicPath = requestedFile.replaceAll("\\", "/");
  const isReactClientAsset = normalizedPublicPath.startsWith("admin/react/assets/")
    && (await getReactClientAssetFiles(publicDirectory)).has(normalizedPublicPath);
  const isPublishableFile = (publicStaticFiles.has(normalizedPublicPath) || isReactClientAsset)
    && pathSegments.every((segment: any) => segment && !segment.startsWith("."))
    && !requestedFile.toLowerCase().endsWith(".map");

  if (!requestedFile || !resolvedFile.startsWith(allowedPrefix) || !isPublishableFile) {
    sendText(response, 404, "Not found");
    return;
  }

  try {
    const content = await readFile(resolvedFile);
    const contentType = contentTypes[path.extname(resolvedFile).toLowerCase()] ?? "application/octet-stream";
    setCommonHeaders(response);
    if (isReactClientAsset) {
      // Vite 产物使用内容哈希命名，可以安全长期缓存；HTML 与 API 仍保持 no-store。
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.removeHeader("Pragma");
    }
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    throw error;
  }
}

/**
 * Creates the shared request handler used by both the local HTTP server and
 * the Vercel Function entry point. Persistent data uses PostgreSQL only when
 * DATABASE_URL is configured.
 */
export function createAppRequestHandler(options: AppRequestHandlerOptions = {}) {
  const {
    publicDirectory = defaultPublicDirectory,
    authConfig = getAuthConfigFromEnvironment(),
    capacityPolicy = getCapacityPolicyFromEnvironment(),
    historyRepository,
    studentExamRepository,
    teacherAccountRepository,
    publicationGate = auditExamPublication,
    internalTaskSecret = process.env["CRON_SECRET"],
    isProduction = process.env["NODE_ENV"] === "production",
  } = options;
  const databaseUrl = process.env["DATABASE_URL"];
  const databaseOptions = databaseUrl ? { connectionString: databaseUrl } : {};
  const effectiveCapacityPolicy = normalizeCapacityPolicy(capacityPolicy);
  const effectiveHistoryRepository = historyRepository ?? createExamHistoryRepository({
    ...databaseOptions,
    capacityPolicy: effectiveCapacityPolicy,
  });
  const effectiveStudentExamRepository = studentExamRepository ?? createStudentExamRepository({
    ...databaseOptions,
    capacityPolicy: effectiveCapacityPolicy,
  });
  const effectiveTeacherAccountRepository = teacherAccountRepository ?? createTeacherAccountRepository({
    ...databaseOptions,
    legacyAccounts: getLegacyAccounts(authConfig),
    capacityPolicy: effectiveCapacityPolicy,
  });
  const legacyAccounts = getLegacyAccounts(authConfig);
  const legacyAccountMigrations = new Map<string, Promise<void>>();

  async function activateLegacyAccountOnFirstLogin(login: { username?: unknown; password?: unknown }): Promise<void> {
    const verifiedLegacyAccount = verifyAdminCredentials(login, authConfig);
    if (!verifiedLegacyAccount) return;

    const persistedAccount = await effectiveTeacherAccountRepository.findAuthenticationAccount(
      verifiedLegacyAccount.username,
    );
    if (persistedAccount && persistedAccount.status !== "migration_pending") return;

    const normalizedUsername = verifiedLegacyAccount.username.normalize("NFKC").trim().toLowerCase();
    const legacyAccount = legacyAccounts.find((candidate) => (
      candidate.username.normalize("NFKC").trim().toLowerCase() === normalizedUsername
    ));
    if (!legacyAccount) return;

    let migration = legacyAccountMigrations.get(normalizedUsername);
    if (!migration) {
      migration = effectiveTeacherAccountRepository
        .migrateLegacyAccounts([legacyAccount])
        .then(() => undefined);
      legacyAccountMigrations.set(normalizedUsername, migration);
    }
    await migration;
  }
  const studentVerificationRateLimiter = createLoginRateLimiter({
    limit: effectiveCapacityPolicy.loginRateLimit,
    windowMilliseconds: effectiveCapacityPolicy.loginRateWindowMilliseconds,
    maxTrackedKeys: effectiveCapacityPolicy.loginRateTrackedKeyLimit,
  });

  return async function handleAppRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const { pathname } = requestUrl;
      const isPageRequest = request.method === "GET" || request.method === "HEAD";
      const adminPage = isPageRequest ? matchAdminPageRoute(pathname) : null;
      const requiresAdminContext = pathname.startsWith("/api/admin/")
        || (isPageRequest && (
          pathname === "/admin"
          || pathname === "/admin/"
          || pathname === "/admin/login"
          || pathname === "/admin/login/"
          || pathname === "/admin/react/index.html"
          || /^\/admin\/[^/]+\.html$/.test(pathname)
          || adminPage !== null
        ));
      if (requiresAdminContext && authConfig) {
        const cookies = parseCookies(request.headers.cookie);
        const verifiedSession = await verifyPersistedAdminSession(
          cookies["admin_session"],
          authConfig,
          effectiveTeacherAccountRepository,
        );
        if (verifiedSession) {
          verifiedAdminSessions.set(request, verifiedSession);
          const memberships = await effectiveTeacherAccountRepository.listActiveSubjectMemberships(verifiedSession.aid);
          verifiedAdminActors.set(request, {
            accountId: verifiedSession.aid,
            platformRole: verifiedSession.role,
            memberships,
          });
        }
      }

      if (request.method === "GET" && pathname === "/api/health") {
        try {
          await effectiveHistoryRepository.checkHealth();
        } catch {
          sendJson(response, 503, {
            status: "degraded",
          });
          return;
        }
        sendJson(response, 200, {
          status: "ok",
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/internal/attempt-expiry") {
        if (!hasValidBearerSecret(request, internalTaskSecret)) {
          sendJson(response, 401, { error: "Authentication required." });
          return;
        }
        const payload = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        const limit = payload?.limit === undefined ? 100 : payload.limit;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          sendJson(response, 422, { error: "Limit must be an integer between 1 and 100." });
          return;
        }
        sendJson(response, 200, await effectiveStudentExamRepository.submitExpiredAttempts({ limit }));
        return;
      }

      if (isPageRequest && (pathname === "/admin" || pathname === "/admin/")) {
        const actor = getAuthorizationActor(request);
        redirect(response, actor ? getAdminLandingPath(actor) : "/admin/login/");
        return;
      }

      if (isPageRequest && (pathname === "/admin/login" || pathname === "/admin/login/")) {
        const actor = getAuthorizationActor(request);
        if (actor) {
          redirect(response, getAdminLandingPath(actor));
          return;
        }
        await serveStaticFile(response, publicDirectory, pathname);
        return;
      }

      if (adminPage) {
        const session = getSession(request, authConfig);
        const actor = getAuthorizationActor(request);
        if (!session || !actor) { redirect(response, "/admin/login/"); return; }
        const access = authorizeAdminPage(actor, pathname);
        if (!access.allowed) { redirect(response, access.redirectTo); return; }
        if (!adminPage.canonical) { redirect(response, `${adminPage.path}${requestUrl.search}`); return; }
        await serveStaticFile(response, publicDirectory, adminPage.path);
        return;
      }

      if (isPageRequest && /^\/admin\/[^/]+\.html$/.test(pathname)) {
        const actor = getAuthorizationActor(request);
        redirect(response, actor ? getAdminLandingPath(actor) : "/admin/login/");
        return;
      }

      if (isPageRequest && pathname === "/admin/react/index.html") {
        const actor = getAuthorizationActor(request);
        redirect(response, actor ? getAdminLandingPath(actor) : "/admin/login/");
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/login") {
        if (!authConfig) {
          sendJson(response, 503, { error: "Admin authentication is not configured." });
          return;
        }

        const login = validateLoginPayload(
          await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes),
        );
        const ipAddress = getRequestIp(request);
        const accountIdentity = login.valid
          ? login.username.normalize("NFKC").trim().toLowerCase()
          : "invalid-payload";
        const rateLimitKeys = {
          ipKey: createLoginRateLimitKey("ip", ipAddress, authConfig.sessionSecret),
          accountKey: createLoginRateLimitKey("account", accountIdentity, authConfig.sessionSecret),
        };
        const rateLimit = await effectiveTeacherAccountRepository.consumeLoginRateLimit({
          ...rateLimitKeys,
          limit: effectiveCapacityPolicy.loginRateLimit,
          windowMilliseconds: effectiveCapacityPolicy.loginRateWindowMilliseconds,
          maxTrackedKeys: effectiveCapacityPolicy.loginRateTrackedKeyLimit,
        });
        if (!rateLimit.allowed) {
          sendJson(response, 429, { error: "Too many login attempts. Try again later." }, { "Retry-After": rateLimit.retryAfterSeconds });
          return;
        }

        let account = login.valid
          ? await verifyPersistedAdminCredentials(login, effectiveTeacherAccountRepository)
          : null;
        if (!account && login.valid) {
          await activateLegacyAccountOnFirstLogin(login);
          account = await verifyPersistedAdminCredentials(login, effectiveTeacherAccountRepository);
        }
        if (!login.valid || !account) {
          sendJson(response, 401, { error: "Invalid username or password." });
          return;
        }

        await effectiveTeacherAccountRepository.resetLoginRateLimit(rateLimitKeys);
        const { token, csrfToken } = createAdminSession({ account, sessionSecret: authConfig.sessionSecret });
        const loginActor = {
          accountId: account.accountId,
          platformRole: account.role,
          memberships: await effectiveTeacherAccountRepository.listActiveSubjectMemberships(account.accountId),
        };
        const permissions = getAdminPermissions(account.role)
          .filter((permission: any) => getSubjectAuthorizedPermissions(loginActor).includes(permission));
        const loginResponse: LoginResponse = {
          user: account.username,
          role: account.role,
          permissions,
          csrfToken,
          landingPath: getAdminLandingPath(loginActor),
        };
        sendJson(
          response,
          200,
          loginResponse,
          { "Set-Cookie": serializeSessionCookie(token, { secure: isProduction }) },
        );
        return;
      }

      if (request.method === "POST" && pathname === "/api/student/verify") {
        if (!authConfig) {
          sendJson(response, 503, { error: "Student sessions are not configured." });
          return;
        }
        const verification = validateStudentVerificationPayload(
          await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes),
        );
        const rateLimitKey = getStudentVerificationRateLimitKey(request, verification);
        const rateLimit = studentVerificationRateLimiter.check(rateLimitKey);
        if (!rateLimit.allowed) {
          sendJson(response, 429, { error: "Too many verification attempts. Try again later." }, { "Retry-After": rateLimit.retryAfterSeconds });
          return;
        }

        if (!verification.valid) {
          sendJson(response, 400, { error: "Invalid verification request." });
          return;
        }

        const verified = await retryTransientDatabaseDisconnect(
          () => effectiveStudentExamRepository.verifyIdentity(verification),
        );
        if (!verified?.exam || !verified.student) {
          const room = await retryTransientDatabaseDisconnect(
            () => effectiveStudentExamRepository.getRoomMetadata(verification.examCode),
          );
          if (room?.["terminationCollecting"]) {
            sendJson(response, 409, { error: "This exam is being collected.", code: "ROOM_COLLECTION_ACTIVE" });
            return;
          }
          if (room && ["closed", "archived"].includes(room["state"])) {
            sendJson(response, 409, { error: "This exam has ended.", code: "EXAM_CLOSED" });
            return;
          }
          sendJson(response, 401, { error: "Identity could not be verified." });
          return;
        }
        studentVerificationRateLimiter.reset(rateLimitKey);
        const cookies = parseCookies(request.headers.cookie);
        const existingSession = verifyStudentSession(cookies["student_session"], authConfig.sessionSecret);
        const reusable = existingSession
          && existingSession.examCode === verified.exam.code
          && existingSession.studentNumber === verified.student.studentNumber
          && verified.experience?.mode !== ASSIGNMENT_MODE;
        const sessionLifetimeSeconds = verified.experience?.hasTimeLimit === false ? 24 * 60 * 60 : 2 * 60 * 60;
        const created: { token: string; csrfToken: string; maxAgeSeconds?: number } = reusable
          ? {
              token: cookies["student_session"]!,
              csrfToken: existingSession.csrf,
              maxAgeSeconds: Math.max(1, existingSession.exp - Math.floor(Date.now() / 1000)),
            }
          : createStudentSession({
              examCode: verified.exam.code,
              studentNumber: verified.student.studentNumber,
              sessionSecret: authConfig.sessionSecret,
              lifetimeSeconds: sessionLifetimeSeconds,
            });
        const verifiedSubject = await findActiveSubject(
          effectiveTeacherAccountRepository,
          typeof verified.exam["subjectId"] === "string" ? verified.exam["subjectId"] : DEFAULT_EXCEL_SUBJECT_ID,
        );
        sendJson(
          response,
          200,
          studentVerificationResponseSchema.parse({
            ...verified,
            exam: {
              ...verified.exam,
              studentLocale: verifiedSubject?.studentLocale ?? "legacy_bilingual",
            },
            csrfToken: created.csrfToken,
          }),
          { "Set-Cookie": serializeStudentSessionCookie(created.token, { secure: isProduction, maxAgeSeconds: created.maxAgeSeconds ?? sessionLifetimeSeconds }) },
        );
        return;
      }

      if (request.method === "POST" && pathname === "/api/student/start") {
        const session = requireStudent(request, response, authConfig);
        if (!session || !requireCsrf(request, response, session)) return;
        const body = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        const admission = await retryTransientDatabaseDisconnect(
          () => effectiveStudentExamRepository.getAdmissionStatus({
            examCode: session.examCode,
            studentNumber: session.studentNumber,
          }),
        );
        const requiresFullscreen = admission?.experience?.requiresFullscreen !== false;
        const browserPreflight = body?.browserPreflight === undefined
          ? null
          : validateBrowserPreflight(body.browserPreflight);
        if (requiresFullscreen && (!browserPreflight || !browserPreflight.fullscreen || !browserPreflight.browserSupported)) {
          sendJson(response, 422, { error: "A supported browser and fullscreen preflight are required." });
          return;
        }
        const token = parseCookies(request.headers.cookie)["student_session"];
        const attempt = await retryTransientDatabaseDisconnect(
          () => effectiveStudentExamRepository.startAttempt({
            examCode: session.examCode,
            studentNumber: session.studentNumber,
            sessionTokenHash: hashStudentSession(token!),
            browserPreflight: browserPreflight ?? {},
          }),
        );
        sendJson(response, 200, { attempt, csrfToken: session.csrf });
        return;
      }

      if (request.method === "GET" && pathname === "/api/student/attempt") {
        const session = requireStudent(request, response, authConfig);
        if (!session) return;
        const token = parseCookies(request.headers.cookie)["student_session"];
        let attempt = await effectiveStudentExamRepository.getAttempt({
          examCode: session.examCode,
          studentNumber: session.studentNumber,
          sessionTokenHash: hashStudentSession(token!),
        });
        if (attempt?.status === "in_progress" && attempt["deadlineAt"]
          && new Date(attempt["deadlineAt"]).getTime() <= Date.now()) {
          await effectiveStudentExamRepository.submitExpiredAttempts({ examCode: session.examCode, limit: 100 });
          attempt = await effectiveStudentExamRepository.getAttempt({
            examCode: session.examCode,
            studentNumber: session.studentNumber,
            sessionTokenHash: hashStudentSession(token!),
          });
        }
        if (!attempt) {
          sendJson(response, 404, { error: "Attempt not started." });
          return;
        }
        sendJson(response, 200, { attempt, csrfToken: session.csrf });
        return;
      }

      if (request.method === "POST" && pathname === "/api/student/heartbeat") {
        const session = requireStudent(request, response, authConfig);
        if (!session || !requireCsrf(request, response, session)) return;
        const token = parseCookies(request.headers.cookie)["student_session"];
        const heartbeat = await effectiveStudentExamRepository.heartbeat({ examCode: session.examCode, studentNumber: session.studentNumber, sessionTokenHash: hashStudentSession(token!) });
        if (!heartbeat) { sendJson(response, 409, { error: "Active attempt session not found." }); return; }
        sendJson(response, 200, heartbeat);
        return;
      }

      if (request.method === "GET" && pathname === "/api/student/admission") {
        const session = requireStudent(request, response, authConfig);
        if (!session) return;
        const admission = await effectiveStudentExamRepository.getAdmissionStatus({ examCode: session.examCode, studentNumber: session.studentNumber });
        if (!admission) { sendJson(response, 404, { error: "Admission not found." }); return; }
        sendJson(response, 200, { ...admission, csrfToken: session.csrf });
        return;
      }

      if (request.method === "PUT" && pathname === "/api/student/answer") {
        const session = requireStudent(request, response, authConfig);
        if (!session || !requireCsrf(request, response, session)) return;
        const answerPayload = validateAnswerPayload(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!answerPayload) {
          sendJson(response, 422, { error: "Invalid answer payload." });
          return;
        }
        const token = parseCookies(request.headers.cookie)["student_session"];
        const answer = await effectiveStudentExamRepository.saveAnswer({
          examCode: session.examCode,
          studentNumber: session.studentNumber,
          sessionTokenHash: hashStudentSession(token!),
          ...answerPayload,
        });
        sendJson(response, 200, { answer });
        return;
      }

      if (request.method === "POST" && pathname === "/api/student/submission-confirmation") {
        const session = requireStudent(request, response, authConfig);
        if (!session || !requireCsrf(request, response, session)) return;
        const rawSessionToken = parseCookies(request.headers.cookie)["student_session"];
        const sessionTokenHash = hashStudentSession(rawSessionToken!);
        const attempt = await effectiveStudentExamRepository.getAttempt({
          examCode: session.examCode,
          studentNumber: session.studentNumber,
          sessionTokenHash,
        });
        if (!attempt || attempt["exam"]?.mode === ASSIGNMENT_MODE || attempt["status"] !== "in_progress" || attempt["submission"]) {
          sendJson(response, 409, {
            error: "This answer sheet is not available for manual submission.",
            code: "SUBMISSION_CONFIRMATION_UNAVAILABLE",
          });
          return;
        }
        sendJson(response, 201, {
          confirmationToken: createSubmissionConfirmation({
            examCode: session.examCode,
            studentNumber: session.studentNumber,
            sessionTokenHash,
            sessionSecret: authConfig!.sessionSecret,
          }),
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/student/submit") {
        const session = requireStudent(request, response, authConfig);
        if (!session || !requireCsrf(request, response, session)) return;
        const submissionPayload = validateSubmissionPayload(
          await readJsonBody(request, effectiveCapacityPolicy.maxSubmissionRequestBodyBytes),
        );
        if (!submissionPayload) {
          sendJson(response, 422, { error: "Invalid submission payload." });
          return;
        }
        const token = parseCookies(request.headers.cookie)["student_session"];
        const sessionTokenHash = hashStudentSession(token!);
        const manualConfirmationVerified = Boolean(verifySubmissionConfirmation(
          submissionPayload.confirmationToken,
          {
            examCode: session.examCode,
            studentNumber: session.studentNumber,
            sessionTokenHash,
            sessionSecret: authConfig!.sessionSecret,
          },
        ));
        const submission = await retryTransientDatabaseDisconnect(
          () => effectiveStudentExamRepository.submitAttempt({
            examCode: session.examCode,
            studentNumber: session.studentNumber,
            sessionTokenHash,
            answers: submissionPayload.answers,
            manualConfirmationVerified,
          }),
        );
        sendJson(response, 200, { submission });
        return;
      }

      if (request.method === "POST" && pathname === "/api/student/proctor-events") {
        const session = requireStudent(request, response, authConfig);
        if (!session || !requireCsrf(request, response, session)) return;
        const event = validateProctorEvent(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!event) { sendJson(response, 422, { error: "Invalid proctor event." }); return; }
        const token = parseCookies(request.headers.cookie)["student_session"];
        const identity = { examCode: session.examCode, studentNumber: session.studentNumber, sessionTokenHash: hashStudentSession(token!) };
        const recorded = await effectiveStudentExamRepository.recordProctorEvent({ ...identity, ...event });
        sendJson(response, 201, { occurredAt: recorded["occurredAt"], suspension: recorded["suspension"] ?? null });
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/logout") {
        const session = requireAdmin(request, response, authConfig);
        if (!session || !requireCsrf(request, response, session)) return;
        sendEmpty(response, 204, { "Set-Cookie": serializeExpiredSessionCookie({ secure: isProduction }) });
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/session") {
        const session = requireAdmin(request, response, authConfig);
        if (!session) return;
        const actor = getAuthorizationActor(request);
        const workspaceSubjects = actor ? await listWorkspaceSubjects(actor, effectiveTeacherAccountRepository) : [];
        const permissions = actor
          ? getAdminPermissions(session.role).filter((permission: any) => getSubjectAuthorizedPermissions(actor).includes(permission))
          : [];
        const sessionResponse: AdminSession = {
          user: session.sub,
          role: session.role,
          permissions,
          csrfToken: session.csrf,
          storageMode: effectiveHistoryRepository.storageMode,
          subjects: actor?.memberships ?? [],
          workspaceSubjects,
          landingPath: actor ? getAdminLandingPath(actor) : "/admin/login/",
          workspaceKind: actor && (actor.platformRole === "super_admin" || actor.platformRole === "test_admin") ? "system" : "teaching",
          navigation: actor ? getAdminNavigation(actor) : [],
        };
        sendJson(response, 200, sessionResponse);
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/accounts") {
        if (!requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS)) return;
        const pagination = validateAccountPage(requestUrl);
        if (!pagination) {
          sendJson(response, 422, { error: "Page must be positive and pageSize must be between 1 and 50.", code: "INVALID_PAGINATION" });
          return;
        }
        sendJson(response, 200, await effectiveTeacherAccountRepository.listAccounts(pagination));
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/subjects") {
        if (!requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS)) return;
        sendJson(response, 200, { subjects: await effectiveTeacherAccountRepository.listSubjects() });
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/subjects/catalog") {
        if (!requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS)) return;
        sendJson(response, 200, { subjects: await effectiveTeacherAccountRepository.listSubjects({ includeArchived: true }) });
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/subjects") {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const mutation = validateSubjectCreation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!mutation) {
          sendJson(response, 422, { error: "Enter valid subject names, code, authoring capabilities and language.", code: "INVALID_SUBJECT_INPUT" });
          return;
        }
        const subject = await effectiveTeacherAccountRepository.createSubject({ actorAccountId: session.aid, ...mutation });
        sendJson(response, 201, { subject });
        return;
      }

      const subjectSettingsMatch = pathname.match(/^\/api\/admin\/subjects\/([^/]{1,300})\/settings$/);
      if (request.method === "PATCH" && subjectSettingsMatch) {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const subjectId = decodeManagedSubjectId(subjectSettingsMatch[1]);
        const mutation = validateSubjectSettingsMutation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!subjectId || !mutation) {
          sendJson(response, 422, { error: "Invalid subject settings request.", code: "INVALID_SUBJECT_INPUT" });
          return;
        }
        const subject = await effectiveTeacherAccountRepository.updateSubjectSettings({
          actorAccountId: session.aid,
          subjectId,
          ...mutation,
        });
        sendJson(response, 200, { subject });
        return;
      }

      const subjectStatusMatch = pathname.match(/^\/api\/admin\/subjects\/([^/]{1,300})\/status$/);
      if (request.method === "PATCH" && subjectStatusMatch) {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const actor = getAuthorizationActor(request);
        const subjectId = decodeManagedSubjectId(subjectStatusMatch[1]);
        const mutation = validateSubjectStatusMutation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!actor || !subjectId || !mutation) {
          sendJson(response, 422, { error: "Invalid subject status request.", code: "INVALID_SUBJECT_INPUT" });
          return;
        }
        if (mutation.status === "archived") {
          const exams = await effectiveStudentExamRepository.listExamEvents({ authorization: actor, action: ADMIN_PERMISSIONS.VIEW_ROOM });
          const hasOpenExam = exams.some((exam) => (
            exam["subjectId"] === subjectId && !["closed", "archived"].includes(String(exam["state"] ?? ""))
          ));
          if (hasOpenExam) {
            sendJson(response, 409, { error: "Close every open exam before archiving this subject.", code: "SUBJECT_HAS_OPEN_EXAMS" });
            return;
          }
        }
        const subject = await effectiveTeacherAccountRepository.setSubjectStatus({
          actorAccountId: session.aid,
          subjectId,
          ...mutation,
        });
        sendJson(response, 200, { subject });
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/accounts") {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const accountInput = validateAccountCreation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!accountInput) {
          sendJson(response, 422, { error: "Enter valid account details and confirm the operation.", code: "INVALID_ACCOUNT_INPUT" });
          return;
        }
        const account = await effectiveTeacherAccountRepository.createAccount({
          actorAccountId: session.aid,
          username: accountInput.username,
          displayName: accountInput.displayName,
          passwordHash: hashAdminPassword(accountInput.password),
          platformRole: accountInput.platformRole,
        });
        sendJson(response, 201, { account });
        return;
      }

      const accountStatusMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]{1,300})\/status$/);
      if (request.method === "POST" && accountStatusMatch) {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const accountId = decodeManagedAccountId(accountStatusMatch[1]);
        const mutation = validateAccountStatusMutation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!accountId || !mutation) { sendJson(response, 422, { error: "Invalid account status request.", code: "INVALID_ACCOUNT_INPUT" }); return; }
        const account = await effectiveTeacherAccountRepository.setAccountStatus({ actorAccountId: session.aid, accountId, status: mutation.status });
        sendJson(response, 200, { account });
        return;
      }

      const accountRoleMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]{1,300})\/role$/);
      if (request.method === "POST" && accountRoleMatch) {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const accountId = decodeManagedAccountId(accountRoleMatch[1]);
        const mutation = validateAccountRoleMutation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!accountId || !mutation) { sendJson(response, 422, { error: "Invalid account role request.", code: "INVALID_ACCOUNT_INPUT" }); return; }
        const account = await effectiveTeacherAccountRepository.setPlatformRole({ actorAccountId: session.aid, accountId, platformRole: mutation.platformRole });
        sendJson(response, 200, { account });
        return;
      }

      const accountPasswordMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]{1,300})\/reset-password$/);
      if (request.method === "POST" && accountPasswordMatch) {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const accountId = decodeManagedAccountId(accountPasswordMatch[1]);
        const mutation = validateAccountPasswordMutation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!accountId || !mutation) { sendJson(response, 422, { error: "Password must contain 12 to 200 characters.", code: "INVALID_ACCOUNT_INPUT" }); return; }
        const account = await effectiveTeacherAccountRepository.resetAccountPassword({
          actorAccountId: session.aid,
          accountId,
          passwordHash: hashAdminPassword(mutation.password),
        });
        sendJson(response, 200, { account });
        return;
      }

      const accountMembershipMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]{1,300})\/memberships$/);
      if (request.method === "POST" && accountMembershipMatch) {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const accountId = decodeManagedAccountId(accountMembershipMatch[1]);
        const mutation = validateAccountMembershipMutation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!accountId || !mutation) { sendJson(response, 422, { error: "Invalid subject membership request.", code: "INVALID_ACCOUNT_INPUT" }); return; }
        const account = await effectiveTeacherAccountRepository.assignSubjectMembership({ actorAccountId: session.aid, accountId, subjectId: mutation.subjectId, subjectRole: mutation.subjectRole });
        sendJson(response, 200, { account });
        return;
      }

      const accountMembershipBatchMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]{1,300})\/memberships\/batch$/);
      if (request.method === "POST" && accountMembershipBatchMatch) {
        const session = requireAdminPermission(request, response, authConfig, ADMIN_PERMISSIONS.MANAGE_ACCOUNTS);
        if (!session || !requireCsrf(request, response, session)) return;
        const accountId = decodeManagedAccountId(accountMembershipBatchMatch[1]);
        const mutation = validateAccountMembershipBatchMutation(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!accountId || !mutation) {
          sendJson(response, 422, { error: "Select one or more valid subjects.", code: "INVALID_ACCOUNT_INPUT" });
          return;
        }
        const account = await effectiveTeacherAccountRepository.assignSubjectMemberships({ actorAccountId: session.aid, accountId, memberships: mutation.memberships });
        sendJson(response, 200, { account });
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/functions") {
        const authorization = await requireAuthorizedSubject(request, response, authConfig, effectiveTeacherAccountRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM);
        if (!authorization) return;
        const assessment = resolveSubjectAssessmentType(request, response, authorization.subject);
        if (!assessment) return;
        const payload = authoringFunctionListResponseSchema.parse({
          functions: usesManualAuthoring(assessment) ? [] : publicCatalog(),
        });
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/exam-modes") {
        const authorization = await requireAuthorizedSubject(request, response, authConfig, effectiveTeacherAccountRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM);
        if (!authorization) return;
        const assessment = resolveSubjectAssessmentType(request, response, authorization.subject);
        if (!assessment) return;
        const payload = authoringModeListResponseSchema.parse({
          modes: getAssessmentModeDefinitions(assessment),
        });
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/exam-preview") {
        const authorization = await requireAuthorizedSubject(request, response, authConfig, effectiveTeacherAccountRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM);
        if (!authorization) return;
        const assessment = resolveSubjectAssessmentType(request, response, authorization.subject);
        if (!assessment) return;
        const body = await readJsonBody(request, effectiveCapacityPolicy.maxAuthoringRequestBodyBytes);
        const configuration = usesExcelAuthoring(assessment)
          ? validatePlanPayload(body)
          : body;
        if (usesExcelAuthoring(assessment) && !configuration.valid) {
          sendJson(response, 422, { error: configuration.error, code: configuration.code });
          return;
        }
        const result = composeSubjectAssessment(assessment, configuration, publicationGate);
        sendJson(
          response,
          result.ok && result.publicationAudit?.ok ? 200 : 422,
          authoringPreviewResponseSchema.parse(result),
        );
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/exam-configurations") {
        const authorization = await requireAuthorizedCollection(request, response, authConfig, effectiveTeacherAccountRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM);
        if (!authorization) return;
        const assessment = authorization.subject
          ? resolveSubjectAssessmentType(request, response, authorization.subject)
          : null;
        if (authorization.subject && !assessment) return;
        const configurations = await effectiveHistoryRepository.list({ authorization: authorization.actor, action: ADMIN_PERMISSIONS.COMPOSE_EXAM });
        sendJson(response, 200, { configurations: authorization.subjectId ? configurations.filter((configuration) => (
          configuration.subjectId === authorization.subjectId
          && (!assessment || configuration.assessmentTypeKey === assessment.assessmentTypeKey)
        )) : configurations });
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/exams") {
        const authorization = await requireAuthorizedCollection(request, response, authConfig, effectiveTeacherAccountRepository, ADMIN_PERMISSIONS.VIEW_ROOM);
        if (!authorization) return;
        const exams = await effectiveStudentExamRepository.listExamEvents({ authorization: authorization.actor, action: ADMIN_PERMISSIONS.VIEW_ROOM });
        sendJson(response, 200, { exams: authorization.subjectId ? exams.filter((exam: any) => exam.subjectId === authorization.subjectId) : exams });
        return;
      }

      const terminationFailuresMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/termination-failures$/);
      if (request.method === "GET" && terminationFailuresMatch) {
        if (!await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.VIEW_ROOM, terminationFailuresMatch[1])) return;
        const failures = await effectiveStudentExamRepository.listTerminationFailures(terminationFailuresMatch[1]);
        sendJson(response, 200, { failures });
        return;
      }

      const retryTerminationFailureMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/termination-failures\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/retry$/i);
      if (request.method === "POST" && retryTerminationFailureMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.TERMINATE_EXAM, retryTerminationFailureMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const payload = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        if (!validateExamLifecycleConfirmation(payload, retryTerminationFailureMatch[1])) {
          sendJson(response, 422, { error: "Exam code confirmation does not match.", code: "CONFIRMATION_MISMATCH" });
          return;
        }
        const exam = await effectiveStudentExamRepository.retryTerminationAttempt({
          examCode: retryTerminationFailureMatch[1],
          attemptId: retryTerminationFailureMatch[2]!.toLowerCase(),
          retriedByLogin: session.sub,
        });
        if (!exam) { sendJson(response, 404, { error: "Collection failure not found.", code: "TERMINATION_FAILURE_NOT_FOUND" }); return; }
        sendJson(response, 200, { exam });
        return;
      }

      const terminationCollectionMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/termination-collection$/);
      if (request.method === "POST" && terminationCollectionMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.TERMINATE_EXAM, terminationCollectionMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const payload = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        if (!validateExamLifecycleConfirmation(payload, terminationCollectionMatch[1])) {
          sendJson(response, 422, { error: "Exam code confirmation does not match.", code: "CONFIRMATION_MISMATCH" });
          return;
        }
        const collection = await effectiveStudentExamRepository.requestExamTermination({
          examCode: terminationCollectionMatch[1],
          requestedByLogin: session.sub,
          collectionSeconds: 8,
        });
        if (!collection) { sendJson(response, 409, { error: "Exam is not active.", code: "EXAM_NOT_ACTIVE" }); return; }
        sendJson(response, 200, { collection });
        return;
      }

      const terminateExamMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/terminate$/);
      if (request.method === "POST" && terminateExamMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.TERMINATE_EXAM, terminateExamMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const payload = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        if (!validateExamLifecycleConfirmation(payload, terminateExamMatch[1])) {
          sendJson(response, 422, { error: "Exam code confirmation does not match.", code: "CONFIRMATION_MISMATCH" });
          return;
        }
        const exam = await effectiveStudentExamRepository.terminateExam({ examCode: terminateExamMatch[1], terminatedByLogin: session.sub });
        if (!exam) { sendJson(response, 404, { error: "Exam not found." }); return; }
        sendJson(response, 200, { exam });
        return;
      }

      const deleteExamMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})$/);
      if (request.method === "DELETE" && deleteExamMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.DELETE_EXAM, deleteExamMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const payload = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        if (!validateExamLifecycleConfirmation(payload, deleteExamMatch[1])) {
          sendJson(response, 422, { error: "Exam code confirmation does not match.", code: "CONFIRMATION_MISMATCH" });
          return;
        }
        const deleted = await effectiveStudentExamRepository.deleteExam({ examCode: deleteExamMatch[1], deletedByLogin: session.sub });
        if (!deleted) { sendJson(response, 404, { error: "Exam not found." }); return; }
        sendJson(response, 200, deleted);
        return;
      }

      const attendanceMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/attendance$/);
      if (request.method === "GET" && attendanceMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.VIEW_ROOM, attendanceMatch[1]);
        if (!authorization) return;
        const room = typeof effectiveStudentExamRepository.getRoomMetadata === "function"
          ? await effectiveStudentExamRepository.getRoomMetadata(attendanceMatch[1]!)
          : null;
        if (room?.["mode"] !== ASSIGNMENT_MODE && typeof effectiveStudentExamRepository.submitExpiredAttempts === "function") {
          await effectiveStudentExamRepository.submitExpiredAttempts({ examCode: attendanceMatch[1], limit: 100 });
        }
        const students = await effectiveStudentExamRepository.listAttendance(attendanceMatch[1]!);
        if (!students) {
          sendJson(response, 404, { error: "Exam not found." });
          return;
        }
        // UI 仅消费当前考试资源的有效权限，避免多科目账户误用会话权限并集。
        const rolePermissions = new Set(getAdminPermissions(authorization.session.role));
        const permissions = [
          ADMIN_PERMISSIONS.VIEW_ROOM,
          ADMIN_PERMISSIONS.MANAGE_ADMISSION,
          ADMIN_PERMISSIONS.AUTHORIZE_RESUME,
          ADMIN_PERMISSIONS.AUTHORIZE_RETAKE,
          ADMIN_PERMISSIONS.TERMINATE_EXAM,
        ].filter((permission) => rolePermissions.has(permission) && authorizeTeacherAction({
          actor: authorization.actor,
          action: permission,
          resource: authorization.resource,
        }).allowed);
        sendJson(response, 200, { students, room, permissions, violationLimit: PROCTOR_VIOLATION_LIMIT });
        return;
      }

      const preparationMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/preparation$/);
      if (request.method === "GET" && preparationMatch) {
        if (!await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.VIEW_ROOM, preparationMatch[1])) return;
        const preparation = await effectiveStudentExamRepository.getPreparation(preparationMatch[1]!);
        if (!preparation) { sendJson(response, 404, { error: "Preparation not found." }); return; }
        sendJson(response, 200, preparationResponseSchema.parse({ preparation }));
        return;
      }

      const preparationStepMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/preparation\/step$/);
      if (request.method === "POST" && preparationStepMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM, preparationStepMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const payload = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        const input = preparationStepBodySchema.safeParse({ batchSize: payload?.batchSize ?? 25 });
        if (!input.success) { sendJson(response, 422, { error: "Batch size must be 1-25." }); return; }
        const preparation = await retryTransientDatabaseDisconnect(
          () => effectiveStudentExamRepository.prepareNextBatch({ examCode: preparationStepMatch[1], batchSize: input.data.batchSize }),
        );
        if (!preparation) { sendJson(response, 404, { error: "Preparation not found." }); return; }
        sendJson(response, 200, preparationResponseSchema.parse({ preparation }));
        return;
      }

      const admitWaitingMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/admit-waiting$/);
      if (request.method === "POST" && admitWaitingMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.MANAGE_ADMISSION, admitWaitingMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const result = await effectiveStudentExamRepository.admitWaitingStudents({ examCode: admitWaitingMatch[1], approvedByLogin: session.sub });
        sendJson(response, 200, result);
        return;
      }

      const admitSelectedMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/admit-selected$/);
      if (request.method === "POST" && admitSelectedMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.MANAGE_ADMISSION, admitSelectedMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const payload = await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes);
        const studentNumbers = payload?.studentNumbers;
        if (!Array.isArray(studentNumbers) || studentNumbers.length < 1 || studentNumbers.length > 200 || studentNumbers.some((value: any) => typeof value !== "string" || !/^[A-Za-z0-9-]{1,32}$/.test(value))) {
          sendJson(response, 422, { error: "Select 1-200 valid student numbers." }); return;
        }
        const result = await effectiveStudentExamRepository.admitStudents({ examCode: admitSelectedMatch[1], studentNumbers, approvedByLogin: session.sub });
        sendJson(response, 200, result);
        return;
      }

      const resultsMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/results$/);
      if (request.method === "GET" && resultsMatch) {
        if (!await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.VIEW_RESULTS, resultsMatch[1])) return;
        const results = await effectiveStudentExamRepository.listResults(resultsMatch[1]!);
        if (!results) {
          sendJson(response, 404, { error: "Exam not found." });
          return;
        }
        sendJson(response, 200, { results });
        return;
      }

      const resultsCsvMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/results\.csv$/);
      if (request.method === "GET" && resultsCsvMatch) {
        if (!await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.EXPORT_RESULTS, resultsCsvMatch[1])) return;
        const results = await effectiveStudentExamRepository.listResults(resultsCsvMatch[1]!);
        if (!results) {
          sendJson(response, 404, { error: "Exam not found." });
          return;
        }
        sendResultsCsv(response, resultsCsvMatch[1]!.toUpperCase(), results);
        return;
      }

      const warningLogCsvMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/warnings\.csv$/);
      if (request.method === "GET" && warningLogCsvMatch) {
        if (!await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.EXPORT_RESULTS, warningLogCsvMatch[1])) return;
        const results = await effectiveStudentExamRepository.listResults(warningLogCsvMatch[1]!);
        if (!results) {
          sendJson(response, 404, { error: "Exam not found." });
          return;
        }
        sendWarningLogCsv(response, warningLogCsvMatch[1]!.toUpperCase(), results);
        return;
      }

      const resultDetailMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/students\/([A-Za-z0-9-]{1,32})\/result$/);
      if (request.method === "GET" && resultDetailMatch) {
        if (!await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.VIEW_RESULTS, resultDetailMatch[1])) return;
        const result = await effectiveStudentExamRepository.getResult({ examCode: resultDetailMatch[1], studentNumber: resultDetailMatch[2] });
        if (!result) {
          sendJson(response, 404, { error: "Submitted result not found." });
          return;
        }
        sendJson(response, 200, { result });
        return;
      }

      const adjustmentMatch = pathname.match(/^\/api\/admin\/grade-results\/([0-9a-f-]{36})\/adjust$/i);
      if (request.method === "POST" && adjustmentMatch) {
        const gradeResultId = gradeResultIdSchema.safeParse(adjustmentMatch[1]);
        if (!gradeResultId.success) {
          sendJson(response, 404, { error: "Grade result not found." });
          return;
        }
        const authorization = await requireAuthorizedGrade(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.ADJUST_GRADES, gradeResultId.data);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const adjustmentPayload = validateGradeAdjustment(await readJsonBody(request, effectiveCapacityPolicy.maxRequestBodyBytes));
        if (!adjustmentPayload) {
          sendJson(response, 422, { error: "Invalid grade adjustment." });
          return;
        }
        const adjustment = await effectiveStudentExamRepository.adjustGrade({ gradeResultId: gradeResultId.data, adjustedByLogin: session.sub, ...adjustmentPayload });
        if (!adjustment) {
          sendJson(response, 404, { error: "Grade result not found or score exceeds maximum." });
          return;
        }
        sendJson(response, 200, { adjustment });
        return;
      }

      const admissionMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/students\/([A-Za-z0-9-]{1,32})\/admit$/);
      if (request.method === "POST" && admissionMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.MANAGE_ADMISSION, admissionMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const admission = await effectiveStudentExamRepository.admitStudent({
          examCode: admissionMatch[1],
          studentNumber: admissionMatch[2],
          approvedByLogin: session.sub,
        });
        if (!admission) {
          sendJson(response, 409, { error: "Student is not waiting for admission." });
          return;
        }
        sendJson(response, 200, admission);
        return;
      }

      const resumeMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/students\/([A-Za-z0-9-]{1,32})\/resume$/);
      if (request.method === "POST" && resumeMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.AUTHORIZE_RESUME, resumeMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const recovery = await effectiveStudentExamRepository.authorizeResume({ examCode: resumeMatch[1], studentNumber: resumeMatch[2], authorizedByLogin: session.sub });
        if (!recovery) { sendJson(response, 409, { error: "Attempt cannot be resumed." }); return; }
        sendJson(response, 200, recovery);
        return;
      }

      const retakeMatch = pathname.match(/^\/api\/admin\/exams\/([A-Za-z0-9-]{1,50})\/students\/([A-Za-z0-9-]{1,32})\/retake$/);
      if (request.method === "POST" && retakeMatch) {
        const authorization = await requireAuthorizedExam(request, response, authConfig, effectiveTeacherAccountRepository, effectiveStudentExamRepository, ADMIN_PERMISSIONS.AUTHORIZE_RETAKE, retakeMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session } = authorization;
        const retake = await effectiveStudentExamRepository.authorizeRetake({ examCode: retakeMatch[1], studentNumber: retakeMatch[2], authorizedByLogin: session.sub });
        if (!retake) { sendJson(response, 409, { error: "A new attempt cannot be opened for the current student state." }); return; }
        sendJson(response, 200, retake);
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/exam-configurations") {
        const authorization = await requireAuthorizedSubject(request, response, authConfig, effectiveTeacherAccountRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session, actor, subjectId, subject } = authorization;
        const assessment = resolveSubjectAssessmentType(request, response, subject);
        if (!assessment) return;
        const body = await readJsonBody(request, effectiveCapacityPolicy.maxAuthoringRequestBodyBytes);
        const name = validateConfigurationName(body);
        if (!name) { sendJson(response, 422, { error: "请输入 1 至 100 个字符的配置名称。", code: "INVALID_CONFIGURATION_NAME" }); return; }
        const configuration = usesExcelAuthoring(assessment)
          ? validateConfigurationPayload(body)
          : { ...body, name, mode: "exam" };
        if (configuration.valid === false) { sendJson(response, 422, { error: configuration.error, code: configuration.code }); return; }
        const duration = validateAssessmentDuration(body, configuration.mode);
        if (!duration.valid) { sendJson(response, 422, { error: duration.error, code: duration.code }); return; }
        const composition = composeSubjectAssessment(assessment, configuration, publicationGate);
        if (!composition.ok) {
          sendJson(response, 422, composition);
          return;
        }

        const saved = await effectiveHistoryRepository.save({
          name: configuration.name,
          mode: configuration.mode,
          durationMinutes: duration.durationMinutes,
          assignmentOptions: composition.plan.assignmentOptions ?? {},
          selectedFunctions: composition.plan.coverage.selected,
          plan: composition.plan,
          createdBy: session.sub,
          subjectId,
          ownerAccountId: actor.accountId,
          assessmentTypeKey: assessment.assessmentTypeKey,
        });
        sendJson(response, 201, authoringConfigurationResponseSchema.parse({
          configuration: saved,
          warnings: composition.warnings,
        }));
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/exams") {
        const authorization = await requireAuthorizedSubject(request, response, authConfig, effectiveTeacherAccountRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const { session, actor, subjectId, subject } = authorization;
        const assessment = resolveSubjectAssessmentType(request, response, subject);
        if (!assessment) return;
        const body = await readJsonBody(request, effectiveCapacityPolicy.maxAuthoringRequestBodyBytes);
        const name = validateConfigurationName(body);
        if (!name) { sendJson(response, 422, { error: "请输入 1 至 100 个字符的配置名称。", code: "INVALID_CONFIGURATION_NAME" }); return; }
        const configuration = usesExcelAuthoring(assessment)
          ? validateConfigurationPayload(body)
          : { ...body, name, mode: "exam" };
        if (configuration.valid === false) { sendJson(response, 422, { error: configuration.error, code: configuration.code }); return; }
        const duration = validateAssessmentDuration(body, configuration.mode);
        if (!duration.valid) { sendJson(response, 422, { error: duration.error, code: duration.code }); return; }
        const composition = composeSubjectAssessment(assessment, configuration, publicationGate);
        if (!composition.ok) { sendJson(response, 422, composition); return; }
        const publicationAudit = composition.publicationAudit;
        if (!publicationAudit.ok) {
          sendJson(response, 422, { error: "Exam publication validation failed.", code: "PUBLICATION_BLOCKED", publicationAudit });
          return;
        }
        const roster = parseRosterCsv(body?.rosterCsv, { maximumStudents: getRosterLimit(composition.plan.mode) });
        if (!roster.ok) { sendJson(response, 422, { error: "Invalid roster CSV.", code: "INVALID_ROSTER", errors: roster.errors }); return; }
        const exam = await effectiveStudentExamRepository.publishExam({ title: name, mode: composition.plan.mode, durationMinutes: duration.durationMinutes, selectedFunctions: composition.plan.coverage.selected, plan: composition.plan, publicationAudit, roster: roster.students, createdByLogin: session.sub, createdByAccountId: actor.accountId, subjectId, assessmentTypeKey: assessment.assessmentTypeKey });
        sendJson(response, 201, publishAssessmentResponseSchema.parse({ exam }));
        return;
      }

      const useMatch = pathname.match(/^\/api\/admin\/exam-configurations\/([0-9a-f-]{36})\/use$/i);
      if (request.method === "POST" && useMatch) {
        const authorization = await requireAuthorizedConfiguration(request, response, authConfig, effectiveTeacherAccountRepository, effectiveHistoryRepository, ADMIN_PERMISSIONS.COMPOSE_EXAM, useMatch[1]);
        if (!authorization || !requireCsrf(request, response, authorization.session)) return;
        const existingConfiguration = await effectiveHistoryRepository.get(useMatch[1]!);
        const subject = existingConfiguration
          ? await findActiveSubject(effectiveTeacherAccountRepository, existingConfiguration.subjectId)
          : null;
        if (!existingConfiguration || !subject) {
          sendJson(response, 404, { error: "Configuration not found." });
          return;
        }
        const assessment = resolveSubjectAssessmentType(request, response, subject);
        if (!assessment) return;
        if (existingConfiguration.assessmentTypeKey !== assessment.assessmentTypeKey) {
          sendJson(response, 409, { error: "The saved configuration uses a different authoring capability.", code: "ASSESSMENT_TYPE_MISMATCH" });
          return;
        }
        const configuration = await effectiveHistoryRepository.markUsed(useMatch[1]!);
        if (!configuration) {
          sendJson(response, 404, { error: "Configuration not found." });
          return;
        }
        sendJson(response, 200, { configuration });
        return;
      }

      if (isPageRequest && pathname === "/") {
        redirect(response, "/exam/");
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        await serveStaticFile(response, publicDirectory, pathname);
        return;
      }

      sendJson(response, 405, { error: "Method not allowed." });
    } catch (error) {
      const failure = (error && typeof error === "object" ? error : new Error(String(error))) as HttpError;
      const databaseNotInitialized = failure.code === "DATABASE_NOT_INITIALIZED" || failure.code === "42P01";
      const statusCode = databaseNotInitialized
        ? 503
        : Number.isInteger(failure.statusCode)
          ? failure.statusCode!
          : 500;
      if (statusCode >= 500 && !databaseNotInitialized) console.error("Request failed", error);
      sendJson(response, statusCode, {
        error: databaseNotInitialized
          ? "Service temporarily unavailable."
          : statusCode >= 500
            ? "Internal server error."
            : failure.message,
        ...(typeof failure.code === "string" && statusCode < 500 ? { code: failure.code } : {}),
      });
    }
  };
}

/**
 * Creates the local HTTP server around the shared application handler.
 */
export function createAppServer(options: AppRequestHandlerOptions = {}) {
  return createServer(createAppRequestHandler(options));
}

function startLocalServer() {
  const port = Number.parseInt(process.env["PORT"] ?? "4173", 10);
  const host = process.env["HOST"] ?? "127.0.0.1";
  const server = createAppServer();

  server.listen(port, host, () => {
    process.stdout.write(`Excel web exam system: http://${host}:${port}\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startLocalServer();
}
