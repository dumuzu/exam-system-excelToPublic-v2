import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";

import { excelAssessmentAdapter, gradeExcelResponse } from "../assessment-types/excel/index.ts";
import {
  MANUAL_ASSESSMENT_TYPE_KEY,
  manualAssessmentAdapter,
  type ManualAssessmentGrade,
} from "../assessment-types/manual/index.ts";
import {
  BROWSER_INTEGRITY_VIOLATION_LIMIT,
  browserThreeStrikeIntegrityPolicy,
  normalizeBrowserIntegritySignal,
} from "../core/integrity-policy.ts";
import {
  ASSIGNMENT_MODE,
  EXAM_MODE,
  FORMULA_QUESTIONS_PER_GROUP,
  getStudentExperiencePolicy,
} from "../core/exam-mode-config.ts";
import { generateSumStarterQuestion } from "../core/question-instance-generator.ts";
import { normalizeExamCode, normalizeStudentIdentity } from "../core/student-identity.ts";
import { resolveStudentEntryStatus } from "../core/student-entry-state.ts";
import { normalizeCapacityPolicy } from "./capacity-policy.ts";
import { authorizeTeacherAction, getAuthorizationQueryScope } from "./authorization-policy.ts";
import type { AuthorizationResource } from "./authorization-policy.ts";
import { chunkRowsForPostgres } from "./postgres-batch-policy.ts";
import { persistExamRoster } from "./postgres-roster-persistence.ts";
import { classifyTerminationFailure } from "./termination-failure-policy.ts";

const { Pool } = pg;
const AUTOMATIC_RECOVERY_AFTER_MS = 45_000;
export const PROCTOR_VIOLATION_LIMIT = BROWSER_INTEGRITY_VIOLATION_LIMIT;
export const ROOM_COLLECTION_BATCH_SIZE = 10;
const FORMAL_MANUAL_SUBMISSION_GUARD_MS = 5_000;
const DEFAULT_EXCEL_SUBJECT_ID = "00000000-0000-4000-8000-000000000023";

const EXAM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface StudentExamRecord {
  [key: string]: any;
  status?: string;
  mode?: string;
  exam?: { code: string; mode?: string; [key: string]: any };
  student?: { studentNumber: string; [key: string]: any };
  experience?: { mode?: string; hasTimeLimit?: boolean; requiresFullscreen?: boolean; [key: string]: any };
  occurredAt?: string;
  suspension?: StudentExamRecord | null;
}

export interface StudentExamRepository {
  getExamAuthorizationTarget(examCode: string): Promise<AuthorizationResource | null>;
  getGradeAuthorizationTarget(gradeResultId: string): Promise<AuthorizationResource | null>;
  verifyIdentity(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  listAttendance(examCode: string, options?: StudentExamRecord): Promise<StudentExamRecord[] | null>;
  getRoomMetadata(examCode: string): Promise<StudentExamRecord | null>;
  admitStudent(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  admitWaitingStudents(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  admitStudents(input: StudentExamRecord): Promise<StudentExamRecord>;
  listExamEvents(input?: StudentExamRecord): Promise<StudentExamRecord[]>;
  listTerminationFailures(examCode?: string): Promise<StudentExamRecord[]>;
  retryTerminationAttempt(input?: StudentExamRecord): Promise<StudentExamRecord | null>;
  requestExamTermination(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  terminateExam(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  deleteExam(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  getAdmissionStatus(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  publishExam(input: StudentExamRecord): Promise<StudentExamRecord>;
  getPreparation(examCode: string): Promise<StudentExamRecord | null>;
  prepareNextBatch(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  startAttempt(input: StudentExamRecord): Promise<StudentExamRecord>;
  getAttempt(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  heartbeat(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  authorizeResume(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  authorizeRetake(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  saveAnswer(input: StudentExamRecord): Promise<StudentExamRecord>;
  submitAttempt(input: StudentExamRecord): Promise<StudentExamRecord>;
  submitExpiredAttempts(input?: StudentExamRecord): Promise<StudentExamRecord>;
  recordProctorEvent(input: StudentExamRecord): Promise<StudentExamRecord>;
  listResults(examCode: string): Promise<StudentExamRecord[] | null>;
  getResult(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  adjustGrade(input: StudentExamRecord): Promise<StudentExamRecord | null>;
  close(): Promise<void>;
}

export function createExamCode() {
  const bytes = randomBytes(7);
  return Array.from(bytes, (value: any) => EXAM_CODE_ALPHABET[value % EXAM_CODE_ALPHABET.length]).join("");
}

type RepositoryError = Error & { code: string; statusCode: number; collectUntil?: string };

function attemptError(code: any, message: any, statusCode: any = 409): RepositoryError {
  const error = new Error(message) as RepositoryError;
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeExamDuration(mode: unknown, durationMinutes: unknown): number | null {
  if (mode === ASSIGNMENT_MODE) return null;
  const candidate = durationMinutes ?? 90;
  if (!Number.isInteger(candidate) || Number(candidate) < 1 || Number(candidate) > 240) {
    throw attemptError("INVALID_EXAM_DURATION", "Exam duration must be an integer from 1 to 240 minutes.", 422);
  }
  return Number(candidate);
}

function plannedAssessmentQuestionCount(plan: any, assessmentTypeKey = excelAssessmentAdapter.descriptor.key) {
  if (assessmentTypeKey === MANUAL_ASSESSMENT_TYPE_KEY) {
    if (!Array.isArray(plan?.questions)) return 0;
    return plan?.manualPaperRule?.strategy === "random_subset"
      ? Number(plan.manualPaperRule.questionCount ?? 0)
      : plan.questions.length;
  }
  return Number(plan?.questionCounts?.choice ?? 0) + Number(plan?.questionCounts?.formula ?? 0);
}

async function prepareAssessmentPaper({ assessmentTypeKey, examCode, mode, plan, participantKey = "SHARED-ASSIGNMENT" }: any) {
  const scope = mode === ASSIGNMENT_MODE
    ? { kind: "shared" as const }
    : { kind: "participant" as const, participantKey };
  if (assessmentTypeKey === MANUAL_ASSESSMENT_TYPE_KEY) {
    const prepared = await manualAssessmentAdapter.preparePaper({
      eventId: examCode,
      mode,
      seed: participantKey,
      scope,
      configuration: { questions: plan.questions, paperRule: plan.manualPaperRule },
    });
    return prepared.ok
      ? {
          ok: true as const,
          value: {
            questions: prepared.value.questions.map((question) => ({
              ...question,
              blueprintKey: plan.blueprintKeysByQuestion?.[question.key] ?? `manual-${createHash("sha256").update(question.key).digest("hex").slice(0, 40)}`,
              functionName: "manual",
            })),
          },
        }
      : prepared;
  }
  return excelAssessmentAdapter.preparePaper({
    eventId: examCode,
    mode,
    seed: participantKey,
    scope,
    configuration: { plan, warnings: [] },
  });
}

function gradePreparedSubmission({ assessmentTypeKey, questions, answers, policyViolation = false }: any) {
  if (assessmentTypeKey !== MANUAL_ASSESSMENT_TYPE_KEY) {
    const graded: any = gradeExcelResponse({ questions, answers, policyViolation });
    return { ...graded, gradingStatus: "graded" as const };
  }
  if (policyViolation) {
    const results = questions.map((question: any) => ({
      questionKey: question.key,
      awardedScore: 0,
      maximumScore: 1,
      status: "incorrect",
      explanation: { reason: "policy_violation_limit" },
    }));
    return { results, totals: { awardedScore: 0, maximumScore: results.length }, gradingStatus: "graded" as const };
  }
  const grade = manualAssessmentAdapter.gradeResponse({
    mode: EXAM_MODE,
    paper: { questions },
    response: answers,
  }) as ManualAssessmentGrade;
  const results = grade.questionGrades.map((question) => ({
    questionKey: question.questionKey,
    awardedScore: question.awardedScore,
    maximumScore: question.maximumScore,
    status: question.resultStatus,
    explanation: question.referenceAnswer === undefined ? {} : { referenceAnswer: question.referenceAnswer },
  }));
  return {
    results,
    totals: { awardedScore: grade.awardedScore, maximumScore: grade.maximumScore },
    gradingStatus: grade.gradingStatus,
  };
}

function hasMeaningfulAnswer(answerPayload: any) {
  const meaningful = (value: any): boolean => typeof value === "string"
    ? value.trim().length > 0
    : Array.isArray(value)
      ? value.some(meaningful)
      : value && typeof value === "object"
        ? Object.values(value).some(meaningful)
        : false;
  return Object.values(answerPayload ?? {}).some(meaningful);
}

function requireDeliberateFormalSubmission({
  examMode,
  submissionType,
  startedAt,
  answerPayload,
  manualConfirmationVerified,
  now,
}: any) {
  if (examMode === ASSIGNMENT_MODE || submissionType !== "manual") return;
  if (!manualConfirmationVerified) {
    throw attemptError(
      "SUBMISSION_CONFIRMATION_REQUIRED",
      "Complete both confirmation steps before submitting this answer sheet.",
    );
  }
  if (hasMeaningfulAnswer(answerPayload)) return;
  const startedAtMilliseconds = new Date(startedAt).getTime();
  const elapsedMilliseconds = now.getTime() - startedAtMilliseconds;
  if (Number.isFinite(elapsedMilliseconds)
    && elapsedMilliseconds >= 0
    && elapsedMilliseconds < FORMAL_MANUAL_SUBMISSION_GUARD_MS) {
    throw attemptError(
      "SUBMISSION_CONFIRMATION_REQUIRED",
      "The answer sheet has just opened. Review it before confirming submission.",
    );
  }
}

export function selectLatestSessionAttemptRows(rows: any) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const latestAttemptNumber = rows.reduce(
    (latest: any, row: any) => Math.max(latest, Number(row.attempt_number) || 0),
    0,
  );
  return rows.filter((row: any) => Number(row.attempt_number) === latestAttemptNumber);
}

function publicAttempt({ id, attemptNumber = 1, status, startedAt, deadlineAt, examCode, examMode = EXAM_MODE, titleJa, studentNumber, studentName = "", question, questions = null, answer = null, answers = null, submission = null }: any) {
  const sourceQuestions = questions ?? (question ? [question] : []);
  const experience = getStudentExperiencePolicy(examMode);
  if (submission) return { id, attemptNumber, status, startedAt, deadlineAt, exam: { code: examCode, titleJa, mode: examMode }, experience, student: { studentNumber, name: studentName }, questions: [], answers: null, answer: null, submission };
  return {
    id,
    attemptNumber,
    status,
    startedAt,
    deadlineAt,
    exam: { code: examCode, titleJa, mode: examMode },
    experience,
    student: { studentNumber, name: studentName },
    questions: sourceQuestions.map((item: any) => {
      const { functionName: _privateFunctionName, ...studentPayload } = item.studentPayload ?? {};
      return { key: item.key, questionMode: item.questionMode, ...studentPayload };
    }),
    answer,
    answers,
    submission,
  };
}

function publicAnswer({ questionKey, formula = "", version = 0, savedAt = null }: any) {
  return { questionKey, formula, version, savedAt };
}

function finalizeInMemoryAttempt(attempt: any, { submissionType, now }: any) {
  const gradedSubmission: any = gradePreparedSubmission({
    assessmentTypeKey: attempt.assessmentTypeKey,
    questions: attempt.questions,
    answers: attempt.answerPayload,
    policyViolation: submissionType === "policy",
  });
  attempt.grades = gradedSubmission.results.map((result: any) => ({ ...result, id: randomUUID(), adjustment: null }));
  attempt.grade = {
    ...gradedSubmission.totals,
    status: gradedSubmission.gradingStatus === "review_required"
      ? "review_required"
      : gradedSubmission.results.every((result: any) => result.status === "correct") ? "correct" : "graded",
  };
  attempt.gradingStatus = gradedSubmission.gradingStatus;
  attempt.status = submissionType === "policy" ? "policy_submitted" : submissionType === "timer" ? "auto_submitted" : submissionType === "teacher" ? "teacher_submitted" : "submitted";
  attempt.submission = { type: submissionType, submittedAt: now.toISOString(), status: "received" };
  return structuredClone(attempt.submission);
}

function currentPolicySuspension(attempt: any) {
  return attempt.policySuspensions?.findLast((item: any) => item.status === "suspended") ?? null;
}

function roomCollectionBlocksWrites(exam: any, now: any = new Date()) {
  return Boolean(
    exam?.terminationCollection?.collectUntil
    && new Date(exam.terminationCollection.collectUntil).getTime() <= now.getTime(),
  );
}

// 倒计时已先结束时保留“超时提交”语义；违规暂停不消耗被冻结的剩余时间。
function collectionSubmissionType(attempt: { status?: string; deadlineAt?: string | Date | null }, now: Date) {
  return attempt.status === "in_progress"
    && attempt.deadlineAt
    && new Date(attempt.deadlineAt).getTime() <= now.getTime()
    ? "timer"
    : "teacher";
}

function suspendInMemoryAttempt(attempt: any, { triggerEvent, now }: any) {
  const remainingSeconds = attempt.deadlineAt
    ? Math.max(0, Math.floor((new Date(attempt.deadlineAt).getTime() - now.getTime()) / 1000))
    : 0;
  const suspension = {
    id: randomUUID(),
    triggerEventId: triggerEvent.id,
    suspendedAt: now.toISOString(),
    remainingSeconds,
    resumedAt: null,
    resumedBy: null,
    status: "suspended",
  };
  attempt.policySuspensions ??= [];
  attempt.policySuspensions.push(suspension);
  attempt.status = "policy_suspended";
  return suspension;
}

function preparationView({ status, rosterCount, plannedQuestionCount, generatedQuestionCount, errorSummary = {} }: any) {
  const percent = plannedQuestionCount === 0 ? 0 : Math.min(100, Math.round((generatedQuestionCount / plannedQuestionCount) * 100));
  return { status, rosterCount, plannedQuestionCount, generatedQuestionCount, percent, errorSummary };
}

export function uniqueBlueprintsInLockOrder(instances: any = []): any[] {
  return [...new Map(instances.map((instance: any) => [instance.blueprintKey, instance])).values()]
    .sort((left: any, right: any) => left.blueprintKey.localeCompare(right.blueprintKey));
}

function toStudentExam(record: any, student: any) {
  const examMode = record.mode ?? EXAM_MODE;
  const experience = getStudentExperiencePolicy(examMode);
  const attemptStatus = student.retakeAuthorizedAt && !student.attempt
    ? "waiting"
    : student.attempt?.status ?? student.attemptHistory?.at(-1)?.status ?? null;
  return {
    status: resolveStudentEntryStatus({
      attemptStatus,
      approvalStatus: !experience.requiresAdmission || student.admissionStatus === "admitted" ? "approved" : "waiting",
    }),
    exam: {
      code: record.examCode,
      titleJa: record.titleJa,
      durationMinutes: record.durationMinutes,
      mode: examMode,
      subjectId: record.subjectId,
    },
    student: {
      studentNumber: student.studentNumber,
      name: student.name,
    },
    experience,
  };
}

function openNextAssignmentAttempt(exam: any, student: any, now: any = new Date()) {
  if ((exam.mode ?? EXAM_MODE) !== ASSIGNMENT_MODE || !student.attempt?.submission) return;
  if ((student.attempt.attemptNumber ?? 1) >= getStudentExperiencePolicy(ASSIGNMENT_MODE).maximumAttempts!) return;
  student.attemptHistory ??= [];
  student.attemptHistory.push(student.attempt);
  student.attempt = null;
  student.retakeAuthorizedAt = now.toISOString();
}

function requestNextExamAttempt(exam: any, student: any, now: any = new Date()) {
  if ((exam.mode ?? EXAM_MODE) !== EXAM_MODE) return false;
  if (!student.attempt?.submission || !["submitted", "auto_submitted", "teacher_submitted", "policy_submitted", "review_required"].includes(student.attempt.status)) {
    return false;
  }
  student.attemptHistory ??= [];
  student.attemptHistory.push(student.attempt);
  student.attempt = null;
  student.retakeAuthorizedAt = now.toISOString();
  student.retakeAuthorizedBy = null;
  student.admissionStatus = "waiting_approval";
  student.arrivedAt = now.toISOString();
  return true;
}

/**
 * Local-only adapter used by tests and UI prototyping. Production use relies
 * on the PostgreSQL adapter and a preloaded roster; no implicit demo roster is
 * ever exposed to students.
 */
export class InMemoryStudentExamRepository implements StudentExamRepository {
  #exams;

  constructor({ exams = [] }: any = {}) {
    this.#exams = exams.map((exam: any) => ({
      ...exam,
      examCode: normalizeExamCode(exam.examCode),
      subjectId: exam.subjectId ?? DEFAULT_EXCEL_SUBJECT_ID,
      ownerAccountId: exam.ownerAccountId ?? (exam.createdByLogin ? `legacy:${String(exam.createdByLogin).trim().toLowerCase()}` : null),
      mode: exam.mode ?? EXAM_MODE,
      students: exam.students.map((student: any) => ({
        ...student,
        ...normalizeStudentIdentity(student),
        admissionStatus: "not_entered",
      })),
    }));
  }

  async getExamAuthorizationTarget(examCode: any): Promise<AuthorizationResource | null> {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    return exam ? {
      subjectId: exam.subjectId,
      ownerAccountId: exam.ownerAccountId,
      resourceType: "exam",
      resourceId: exam.examCode,
    } : null;
  }

  async getGradeAuthorizationTarget(gradeResultId: any): Promise<AuthorizationResource | null> {
    for (const exam of this.#exams) {
      for (const student of exam.students) {
        const attempts = [...(student.attemptHistory ?? []), ...(student.attempt ? [student.attempt] : [])];
        if (attempts.some((attempt: any) => attempt.grades?.some((grade: any) => grade.id === gradeResultId))) {
          return {
            subjectId: exam.subjectId,
            ownerAccountId: exam.ownerAccountId,
            resourceType: "grade_result",
            resourceId: gradeResultId,
          };
        }
      }
    }
    return null;
  }

  async verifyIdentity({ examCode, studentNumber, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) =>
      candidate.examCode === normalizeExamCode(examCode)
      && ["published", "active"].includes(candidate.state),
    );
    if (!exam || exam.terminationCollection) return null;

    const identity = normalizeStudentIdentity({ studentNumber });
    let student = exam.students.find((candidate: any) => candidate.studentNumber === identity.studentNumber);
    if (!student || student.enrollmentStatus !== "eligible") return null;
    openNextAssignmentAttempt(exam, student, now);
    requestNextExamAttempt(exam, student, now);
    if (student.admissionStatus === "not_entered") {
      student.admissionStatus = exam.mode === ASSIGNMENT_MODE ? "admitted" : "waiting_approval";
      student.arrivedAt = now.toISOString();
    }
    return toStudentExam(exam, student);
  }

  async listAttendance(examCode: any, { now = new Date(), offlineAfterSeconds = 45 }: any = {}) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam) return null;
    return exam.students
      .filter((student: any) => student.enrollmentStatus === "eligible")
      .map((student: any) => {
        const attempt = student.attempt ?? student.attemptHistory?.at(-1);
        const attemptCount = Math.max(student.admissionStatus === "not_entered" ? 0 : 1, (student.attemptHistory?.length ?? 0) + (student.attempt ? 1 : student.retakeAuthorizedAt ? 1 : 0));
        let status = student.admissionStatus;
        if (student.retakeAuthorizedAt && !student.attempt) status = student.admissionStatus;
        else if (attempt?.submission) status = attempt.status;
        else if (attempt?.status === "policy_suspended") status = "policy_suspended";
        else if (attempt?.status === "in_progress" && attempt.recoveryAuthorizedAt && !attempt.sessionTokenHash) status = "resume_ready";
        else if (attempt?.status === "in_progress" && attempt.deadlineAt && new Date(attempt.deadlineAt).getTime() <= now.getTime()) status = "expired";
        else if (exam.mode !== ASSIGNMENT_MODE && attempt?.status === "in_progress" && now.getTime() - new Date(attempt.lastSeenAt ?? attempt.startedAt).getTime() > offlineAfterSeconds * 1000) status = "disconnected";
        else if (attempt?.status === "in_progress") status = "in_progress";
        const suspension = currentPolicySuspension(attempt ?? {});
        return { studentNumber: student.studentNumber, name: student.name, status, attemptCount, arrivedAt: student.arrivedAt ?? null, startedAt: attempt?.startedAt ?? null, deadlineAt: attempt?.deadlineAt ?? null, lastSeenAt: attempt?.lastSeenAt ?? null, submittedAt: attempt?.submission?.submittedAt ?? null, remainingSeconds: suspension?.remainingSeconds ?? (attempt?.deadlineAt ? Math.max(0, Math.floor((new Date(attempt.deadlineAt).getTime() - now.getTime()) / 1000)) : null), violationCount: attempt?.proctorEvents?.length ?? 0, suspendedAt: suspension?.suspendedAt ?? null };
      });
  }

  async getRoomMetadata(examCode: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    return exam ? {
      mode: exam.mode ?? EXAM_MODE,
      titleJa: exam.titleJa,
      rosterCount: exam.students.filter((student: any) => student.enrollmentStatus === "eligible").length,
      state: exam.state,
      subjectId: exam.subjectId,
      ...(exam.terminationCollection && exam.terminationCollection.status !== "completed"
        ? { terminationCollecting: true }
        : {}),
    } : null;
  }

  async admitStudent({ examCode, studentNumber }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam || !["published", "active"].includes(exam.state) || exam.terminationCollection) return null;
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    if (!student || student.admissionStatus !== "waiting_approval") return null;
    student.admissionStatus = "admitted";
    return { studentNumber: student.studentNumber, status: student.admissionStatus };
  }

  async admitWaitingStudents({ examCode }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam || !["published", "active"].includes(exam.state) || exam.terminationCollection) return null;
    let admittedCount = 0;
    for (const student of exam.students) if (student.admissionStatus === "waiting_approval") { student.admissionStatus = "admitted"; admittedCount += 1; }
    return { admittedCount };
  }

  async admitStudents({ examCode, studentNumbers }: any) {
    let admittedCount = 0;
    for (const studentNumber of studentNumbers) {
      if (await this.admitStudent({ examCode, studentNumber })) admittedCount += 1;
    }
    return { admittedCount };
  }

  async listExamEvents({ authorization = null, action = "view_room" }: any = {}) {
    return this.#exams
      .filter((exam: any) => !authorization || authorizeTeacherAction({
        actor: authorization,
        action,
        resource: {
          subjectId: exam.subjectId,
          ownerAccountId: exam.ownerAccountId,
          resourceType: "exam",
          resourceId: exam.examCode,
        },
      }).allowed)
      .map((exam: any) => ({
        code: exam.examCode,
        subjectId: exam.subjectId,
        titleJa: exam.titleJa,
        mode: exam.mode ?? "exam",
        state: exam.state,
        termination: exam.termination ? structuredClone(exam.termination) : null,
        durationMinutes: exam.durationMinutes,
        rosterCount: exam.students.length,
        preparationStatus: exam.preparationStatus ?? "pending",
        waitingCount: exam.students.filter((student: any) => student.admissionStatus === "waiting_approval").length,
        inProgressCount: exam.students.filter((student: any) => ["in_progress", "policy_suspended"].includes(student.attempt?.status)).length,
        submittedCount: exam.students.filter((student: any) => student.attempt?.submission).length,
        createdAt: exam.createdAt ?? null,
      }))
      .reverse();
  }

  async listTerminationFailures() {
    return [];
  }

  async retryTerminationAttempt() {
    return null;
  }

  async requestExamTermination({ examCode, requestedByLogin, now = new Date(), collectionSeconds = 8 }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam || !["published", "active"].includes(exam.state)) return null;
    if (exam.terminationCollection) return structuredClone(exam.terminationCollection);
    const boundedSeconds = Math.max(3, Math.min(15, Number(collectionSeconds) || 8));
    exam.terminationCollection = {
      requestedAt: now.toISOString(),
      requestedBy: requestedByLogin,
      collectUntil: new Date(now.getTime() + boundedSeconds * 1000).toISOString(),
      status: "collecting",
    };
    return structuredClone(exam.terminationCollection);
  }

  async terminateExam({ examCode, terminatedByLogin, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam) return null;
    const pendingSubmissionCount = exam.students.filter((student: any) => ["in_progress", "policy_suspended"].includes(student.attempt?.status)).length;
    if (exam.mode !== ASSIGNMENT_MODE && pendingSubmissionCount > 0) {
      if (!exam.terminationCollection) throw attemptError("COLLECTION_NOT_REQUESTED", "Start the room collection window before terminating the exam.");
      if (!roomCollectionBlocksWrites(exam, now)) {
        const error = attemptError("COLLECTION_WINDOW_ACTIVE", "The final answer synchronization window is still active.");
        error.collectUntil = exam.terminationCollection.collectUntil;
        throw error;
      }
      exam.terminationCollection.status = "processing";
    }
    let teacherSubmittedCount = 0;
    let deadlineSubmittedCount = 0;
    if (exam.mode !== ASSIGNMENT_MODE) {
      for (const student of exam.students) {
        if (!["in_progress", "policy_suspended"].includes(student.attempt?.status)) continue;
        const suspension = currentPolicySuspension(student.attempt);
        if (suspension) {
          suspension.status = "collected";
          suspension.collectedAt = now.toISOString();
          suspension.collectedBy = terminatedByLogin;
        }
        const submissionType = collectionSubmissionType({
          status: student.attempt.status,
          deadlineAt: student.attempt.deadlineAt,
        }, now);
        finalizeInMemoryAttempt(student.attempt, { submissionType, now });
        if (submissionType === "teacher") teacherSubmittedCount += 1;
        else deadlineSubmittedCount += 1;
      }
    }
    exam.state = "closed";
    exam.termination ??= { terminatedAt: now.toISOString(), terminatedBy: terminatedByLogin };
    if (exam.terminationCollection) exam.terminationCollection.status = "completed";
    return {
      code: exam.examCode,
      state: exam.state,
      termination: structuredClone(exam.termination),
      autoSubmittedCount: teacherSubmittedCount + deadlineSubmittedCount,
      teacherSubmittedCount,
      failedSubmissionCount: 0,
      pendingSubmissionCount: exam.mode === ASSIGNMENT_MODE ? pendingSubmissionCount : 0,
      completed: true,
    };
  }

  async deleteExam({ examCode }: any) {
    const normalizedCode = normalizeExamCode(examCode);
    const index = this.#exams.findIndex((candidate: any) => candidate.examCode === normalizedCode);
    if (index < 0) return null;
    if (!["draft", "closed", "archived"].includes(this.#exams[index].state)) {
      throw attemptError("EXAM_MUST_BE_TERMINATED", "Terminate the exam before deleting it.");
    }
    if (this.#exams[index].students.some((student: any) => ["in_progress", "policy_suspended"].includes(student.attempt?.status))) {
      throw attemptError("EXAM_HAS_IN_PROGRESS_ATTEMPTS", "Submit all in-progress attempts before deleting the exam.");
    }
    this.#exams.splice(index, 1);
    return { deleted: true, code: normalizedCode };
  }

  async getAdmissionStatus({ examCode, studentNumber }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    return student ? toStudentExam(exam, student) : null;
  }

  async publishExam({ title, mode, durationMinutes, selectedFunctions, plan, publicationAudit = null, roster = [], createdByLogin, createdByAccountId = null, subjectId = DEFAULT_EXCEL_SUBJECT_ID, assessmentTypeKey = "excel_formula" }: any) {
    if (publicationAudit && publicationAudit.status !== "approved") {
      throw attemptError("PUBLICATION_BLOCKED", "Publication audit is not approved.", 422);
    }
    const exam = { id: randomUUID(), examCode: createExamCode(), titleJa: title, titleZh: title, state: "draft", durationMinutes: normalizeExamDuration(mode, durationMinutes), mode, selectedFunctions: structuredClone(selectedFunctions), plan: structuredClone(plan), publicationAudit: structuredClone(publicationAudit), admissionMode: "roster", createdByLogin, subjectId, ownerAccountId: createdByAccountId ?? `legacy:${String(createdByLogin).trim().toLowerCase()}`, assessmentTypeKey, createdAt: new Date().toISOString(), students: roster.map((student: any) => ({ ...student, enrollmentStatus: "eligible", admissionStatus: "not_entered" })) };
    this.#exams.push(exam);
    return {
      code: exam.examCode,
      titleJa: exam.titleJa,
      mode: exam.mode,
      durationMinutes: exam.durationMinutes,
      rosterCount: roster.length,
      rosterValidation: {
        ok: true,
        studentCount: roster.length,
        stages: [{ code: "IN_MEMORY_ROSTER_VERIFIED", count: roster.length }],
      },
      preparationStatus: "pending",
    };
  }

  async getPreparation(examCode: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam) return null;
    const expectedPerPaper = plannedAssessmentQuestionCount(exam.plan, exam.assessmentTypeKey);
    const plannedQuestionCount = exam.mode === ASSIGNMENT_MODE
      ? expectedPerPaper
      : exam.students.length * expectedPerPaper;
    const generatedQuestionCount = exam.mode === ASSIGNMENT_MODE
      ? exam.sharedPreparedPaper?.length ?? 0
      : [...(exam.preparedPapers?.values() ?? [])].reduce((total: any, paper: any) => total + paper.length, 0);
    return preparationView({ status: exam.preparationStatus ?? "pending", rosterCount: exam.students.length, plannedQuestionCount, generatedQuestionCount, errorSummary: exam.preparationErrors ?? {} });
  }

  async prepareNextBatch({ examCode, batchSize = 25 }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam) return null;
    exam.preparedPapers ??= new Map(); exam.preparationStatus = "generating";
    if (exam.publicationAudit) {
      const approvedKeys = new Set((exam.publicationAudit.blueprints ?? []).filter((item: any) => item.reviewStatus === "approved").map((item: any) => item.key));
      const manifestPaper = await prepareAssessmentPaper({ assessmentTypeKey: exam.assessmentTypeKey, examCode: exam.examCode, mode: exam.mode, plan: exam.plan, participantKey: "MANIFEST-CHECK" });
      const missingBlueprint = manifestPaper.ok
        ? manifestPaper.value.questions.find((question: any) => !approvedKeys.has(question.blueprintKey))
        : null;
      if (exam.publicationAudit.status !== "approved" || !manifestPaper.ok || missingBlueprint) {
        exam.preparationStatus = "failed";
        exam.preparationErrors = { code: manifestPaper.ok ? "UNREVIEWED_BLUEPRINT" : "PAPER_PREPARATION_FAILED", blueprintKey: missingBlueprint?.key ?? null };
        return this.getPreparation(exam.examCode);
      }
    }
    if (exam.mode === ASSIGNMENT_MODE) {
      if (!exam.sharedPreparedPaper) {
        const preparedPaper = await prepareAssessmentPaper({ assessmentTypeKey: exam.assessmentTypeKey, examCode: exam.examCode, mode: exam.mode, plan: exam.plan });
        if (!preparedPaper.ok) {
          exam.preparationStatus = "failed";
          exam.preparationErrors = { errors: preparedPaper.errors };
          return this.getPreparation(exam.examCode);
        }
        exam.sharedPreparedPaper = preparedPaper.value.questions;
      }
      exam.preparationStatus = "ready";
      exam.state = "active";
      return this.getPreparation(exam.examCode);
    }
    for (const student of exam.students.filter((item: any) => !exam.preparedPapers.has(item.studentNumber)).slice(0, batchSize)) {
      const preparedPaper = await prepareAssessmentPaper({ assessmentTypeKey: exam.assessmentTypeKey, examCode: exam.examCode, mode: exam.mode, plan: exam.plan, participantKey: student.studentNumber });
      if (!preparedPaper.ok) { exam.preparationStatus = "failed"; exam.preparationErrors = { studentNumber: student.studentNumber, errors: preparedPaper.errors }; break; }
      exam.preparedPapers.set(student.studentNumber, preparedPaper.value.questions);
    }
    if (exam.preparedPapers.size === exam.students.length && exam.preparationStatus !== "failed") { exam.preparationStatus = "ready"; exam.state = "active"; }
    return this.getPreparation(exam.examCode);
  }

  async startAttempt({ examCode, studentNumber, sessionTokenHash, browserPreflight = {}, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam || !["published", "active"].includes(exam.state)) {
      throw attemptError("EXAM_CLOSED", "Exam is not open.", 409);
    }
    if (exam.terminationCollection) throw attemptError("ROOM_COLLECTION_ACTIVE", "This exam is being collected.");
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    const experience = getStudentExperiencePolicy(exam.mode);
    if (!student || (experience.requiresAdmission && student.admissionStatus !== "admitted")) throw attemptError("NOT_ADMITTED", "Student has not been admitted.", 403);
    if (student.attempt && !["waiting", "in_progress"].includes(student.attempt.status)) throw attemptError("ATTEMPT_LOCKED", "Attempt cannot be started.");
    if (student.attempt?.sessionTokenHash && student.attempt.sessionTokenHash !== sessionTokenHash) {
      const lastSeenAt = new Date(student.attempt.lastSeenAt ?? student.attempt.startedAt).getTime();
      if (exam.mode !== ASSIGNMENT_MODE && now.getTime() - lastSeenAt < AUTOMATIC_RECOVERY_AFTER_MS) throw attemptError("DUPLICATE_SESSION", "Another active session already exists.");
      student.attempt.previousSessionTokenHash = student.attempt.sessionTokenHash;
      student.attempt.sessionTokenHash = null;
      student.attempt.automaticRecoveryAt = now.toISOString();
    }
    if (!student.attempt) {
      const startedAt = now.toISOString();
      const fallbackStudentNumber = exam.mode === ASSIGNMENT_MODE ? "SHARED-ASSIGNMENT" : student.studentNumber;
      const preparedQuestions = student.retakePreparedQuestions
        ?? (exam.mode === ASSIGNMENT_MODE ? exam.sharedPreparedPaper : exam.preparedPapers?.get(student.studentNumber))
        ?? [generateSumStarterQuestion({ examCode: exam.examCode, studentNumber: fallbackStudentNumber })];
      student.retakePreparedQuestions = null;
      student.attempt = {
        id: randomUUID(),
        attemptNumber: (student.attemptHistory?.length ?? 0) + 1,
        status: "in_progress",
        startedAt,
        deadlineAt: experience.hasTimeLimit ? new Date(now.getTime() + exam.durationMinutes * 60_000).toISOString() : null,
        sessionTokenHash,
        lastSeenAt: now.toISOString(),
        browserPreflight: structuredClone(browserPreflight),
        assessmentTypeKey: exam.assessmentTypeKey,
        question: preparedQuestions[0],
        questions: preparedQuestions,
        answerPayload: {},
        answerVersion: 0,
        answer: publicAnswer({ questionKey: preparedQuestions[0].key }),
        answers: { values: {}, version: 0, savedAt: null },
        submission: null,
      };
    } else {
      student.attempt.sessionTokenHash = sessionTokenHash;
      student.attempt.lastSeenAt = now.toISOString();
      if (exam.mode === ASSIGNMENT_MODE) {
        student.attempt.answerPayload = {};
        student.attempt.answerVersion = 0;
        student.attempt.answer = publicAnswer({ questionKey: student.attempt.questions[0].key });
        student.attempt.answers = { values: {}, version: 0, savedAt: null };
      }
      if (student.attempt.recoveryAuthorizedAt) student.attempt.recoveryUsedAt = now.toISOString();
    }
    return publicAttempt({ ...student.attempt, examCode: exam.examCode, examMode: exam.mode, titleJa: exam.titleJa, studentNumber: student.studentNumber, studentName: student.name });
  }

  async getAttempt({ examCode, studentNumber, sessionTokenHash }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    if (!student?.attempt || student.attempt.sessionTokenHash !== sessionTokenHash) return null;
    return publicAttempt({ ...student.attempt, examCode: exam.examCode, examMode: exam.mode, titleJa: exam.titleJa, studentNumber: student.studentNumber, studentName: student.name });
  }

  async heartbeat({ examCode, studentNumber, sessionTokenHash, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    const attempt = student?.attempt;
    if (!attempt || !["in_progress", "policy_suspended"].includes(attempt.status) || attempt.sessionTokenHash !== sessionTokenHash) return null;
    attempt.lastSeenAt = now.toISOString();
    if (exam.terminationCollection) {
      return { status: "termination_collecting", collectUntil: exam.terminationCollection.collectUntil, lastSeenAt: attempt.lastSeenAt };
    }
    if (attempt.status === "policy_suspended") {
      const suspension = currentPolicySuspension(attempt);
      return { status: "policy_suspended", suspendedAt: suspension?.suspendedAt ?? null, remainingSeconds: suspension?.remainingSeconds ?? 0, lastSeenAt: attempt.lastSeenAt };
    }
    return { status: "active", lastSeenAt: attempt.lastSeenAt };
  }

  async authorizeResume({ examCode, studentNumber, authorizedByLogin, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (exam?.mode === ASSIGNMENT_MODE || exam?.terminationCollection) return null;
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    const attempt = student?.attempt;
    if (attempt?.status === "policy_suspended" && !attempt.submission) {
      const suspension = currentPolicySuspension(attempt);
      if (!suspension) return null;
      suspension.status = "resumed";
      suspension.resumedAt = now.toISOString();
      suspension.resumedBy = authorizedByLogin;
      attempt.status = "in_progress";
      attempt.deadlineAt = new Date(now.getTime() + suspension.remainingSeconds * 1000).toISOString();
      attempt.lastSeenAt = now.toISOString();
      return { studentNumber: student.studentNumber, status: "in_progress", deadlineAt: attempt.deadlineAt };
    }
    if (!attempt || attempt.status !== "in_progress" || attempt.submission || new Date(attempt.deadlineAt).getTime() <= now.getTime()) return null;
    attempt.previousSessionTokenHash = attempt.sessionTokenHash;
    attempt.sessionTokenHash = null;
    attempt.recoveryAuthorizedAt = now.toISOString();
    attempt.recoveryAuthorizedBy = authorizedByLogin;
    return { studentNumber: student.studentNumber, status: "resume_ready" };
  }

  async authorizeRetake({ examCode, studentNumber, authorizedByLogin, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (exam?.mode === ASSIGNMENT_MODE || exam?.terminationCollection) return null;
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    if (!student) return null;
    const opened = requestNextExamAttempt(exam, student, now);
    if (!opened && !(student.retakeAuthorizedAt && !student.attempt)) return null;
    student.retakeAuthorizedBy = authorizedByLogin;
    student.admissionStatus = "admitted";
    return {
      studentNumber: student.studentNumber,
      status: "admitted",
      attemptCount: (student.attemptHistory?.length ?? 0) + 1,
    };
  }

  async saveAnswer({ examCode, studentNumber, sessionTokenHash, questionKey, formula, answerValue = formula, expectedVersion, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (exam?.mode === ASSIGNMENT_MODE) throw attemptError("AUTOSAVE_DISABLED", "Classroom assignment answers are submitted only at the end.");
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    const attempt = student?.attempt;
    if (!attempt || attempt.sessionTokenHash !== sessionTokenHash) throw attemptError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
    if (attempt.status !== "in_progress") throw attemptError("ATTEMPT_LOCKED", "Attempt is no longer editable.");
    if (roomCollectionBlocksWrites(exam, now)) throw attemptError("ROOM_COLLECTION_ACTIVE", "The room is collecting final answers.");
    if (attempt.deadlineAt && now.getTime() >= new Date(attempt.deadlineAt).getTime()) throw attemptError("DEADLINE_EXPIRED", "The deadline has passed.");
    if (!attempt.questions.some((item: any) => item.key === questionKey)) throw attemptError("QUESTION_NOT_FOUND", "Question not found.", 404);
    if (attempt.answerVersion !== expectedVersion) throw attemptError("VERSION_CONFLICT", "Answer version conflict.");
    attempt.answerPayload[questionKey] = structuredClone(answerValue); attempt.answerVersion += 1;
    attempt.answer = { ...publicAnswer({ questionKey, formula: typeof answerValue === "string" ? answerValue : "", version: attempt.answerVersion, savedAt: now.toISOString() }), value: structuredClone(answerValue) };
    attempt.answers = { values: structuredClone(attempt.answerPayload), version: attempt.answerVersion, savedAt: attempt.answer.savedAt };
    return structuredClone(attempt.answer);
  }

  async submitAttempt({
    examCode,
    studentNumber,
    sessionTokenHash,
    answers = null,
    now = new Date(),
    submissionType = null,
    manualConfirmationVerified = false,
  }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam) throw attemptError("EXAM_EVENT_UNAVAILABLE", "Exam event is no longer available.", 410);
    const experience = getStudentExperiencePolicy(exam?.mode ?? EXAM_MODE);
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    const attempt = student?.attempt;
    if (!attempt || attempt.sessionTokenHash !== sessionTokenHash) throw attemptError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
    if (attempt.submission) return structuredClone(attempt.submission);
    if (attempt.status !== "in_progress") throw attemptError("ATTEMPT_LOCKED", "Attempt cannot be submitted.");
    if (exam.mode !== ASSIGNMENT_MODE && roomCollectionBlocksWrites(exam, now)) throw attemptError("ROOM_COLLECTION_ACTIVE", "The room is collecting final answers.");
    if (exam.mode === ASSIGNMENT_MODE && answers) {
      const questionKeys = new Set(attempt.questions.map((question: any) => question.key));
      if (Object.keys(answers).some((questionKey: any) => !questionKeys.has(questionKey))) {
        throw attemptError("QUESTION_NOT_FOUND", "Submission contains an unknown question.", 422);
      }
      attempt.answerPayload = structuredClone(answers);
    }
    submissionType ??= attempt.deadlineAt && now.getTime() >= new Date(attempt.deadlineAt).getTime() ? "timer" : "manual";
    requireDeliberateFormalSubmission({
      examMode: exam.mode,
      submissionType,
      startedAt: attempt.startedAt,
      answerPayload: attempt.answerPayload,
      manualConfirmationVerified,
      now,
    });
    const submission = finalizeInMemoryAttempt(attempt, { submissionType, now });
    if (exam.mode !== ASSIGNMENT_MODE) return submission;
    const correctCount = attempt.grades.filter((grade: any) => grade.status === "correct").length;
    attempt.submission = {
      ...submission,
      score: attempt.grade.awardedScore,
      maximumScore: attempt.grade.maximumScore,
      correctCount,
      questionCount: attempt.questions.length,
      attemptNumber: attempt.attemptNumber,
      attemptsRemaining: Math.max(0, experience.maximumAttempts! - attempt.attemptNumber),
    };
    return structuredClone(attempt.submission);
  }

  async submitExpiredAttempts({ examCode = null, now = new Date(), limit = 100 }: any = {}) {
    const boundedLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
    const normalizedExamCode = examCode ? normalizeExamCode(examCode) : null;
    const candidates = [];
    for (const exam of this.#exams) {
      if (normalizedExamCode && exam.examCode !== normalizedExamCode) continue;
      for (const student of exam.students) {
        if (student.attempt?.status === "in_progress" && student.attempt.deadlineAt && new Date(student.attempt.deadlineAt).getTime() <= now.getTime()) {
          candidates.push(student.attempt);
          if (candidates.length >= boundedLimit) break;
        }
      }
      if (candidates.length >= boundedLimit) break;
    }
    let submittedCount = 0;
    let failedCount = 0;
    for (const attempt of candidates) {
      try {
        finalizeInMemoryAttempt(attempt, { submissionType: "timer", now });
        submittedCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    return { scannedCount: candidates.length, submittedCount, failedCount };
  }

  async recordProctorEvent({ examCode, studentNumber, sessionTokenHash, eventType, now = new Date() }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (exam?.mode === ASSIGNMENT_MODE) throw attemptError("PROCTORING_DISABLED", "Proctoring is disabled for classroom assignments.");
    if (exam?.terminationCollection) throw attemptError("ROOM_COLLECTION_ACTIVE", "The room is collecting final answers.");
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    const attempt = student?.attempt;
    if (!attempt || attempt.sessionTokenHash !== sessionTokenHash || attempt.status !== "in_progress") throw attemptError("ATTEMPT_NOT_FOUND", "Active attempt not found.", 404);
    attempt.proctorEvents ??= [];
    const signal = normalizeBrowserIntegritySignal({ eventType, observedAt: now.toISOString() });
    if (!signal.ok) throw attemptError("INVALID_PROCTOR_EVENT", "Invalid browser integrity event.", 422);
    const decision = browserThreeStrikeIntegrityPolicy.evaluate({
      mode: exam.mode,
      state: { violationCount: attempt.proctorEvents.length, suspended: false },
      signal: signal.value,
    });
    const triggerEvent = { id: randomUUID(), eventType, occurredAt: now.toISOString(), integrityAuditEvent: decision.auditEvent };
    attempt.proctorEvents.push(triggerEvent);
    const suspension = decision.actions.includes("suspend")
      ? suspendInMemoryAttempt(attempt, { triggerEvent, now })
      : null;
    return {
      violationCount: decision.state.violationCount,
      limit: PROCTOR_VIOLATION_LIMIT,
      occurredAt: triggerEvent.occurredAt,
      suspension: suspension ? structuredClone(suspension) : null,
      auditEvent: decision.auditEvent,
    };
  }

  async listResults(examCode: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    if (!exam) return null;
    return exam.students.map((student: any) => {
      const attempts = [...(student.attemptHistory ?? []), ...(student.attempt ? [student.attempt] : [])];
      const attempt = attempts.findLast((candidate: any) => candidate.submission) ?? attempts.at(-1);
      const latestAttempt = student.attempt ?? student.attemptHistory?.at(-1);
      const retakeWaiting = Boolean(student.retakeAuthorizedAt && !student.attempt);
      const attemptCount = (student.attemptHistory?.length ?? 0) + (student.attempt ? 1 : retakeWaiting ? 1 : 0);
      const grades = attempt?.grades ?? [];
      const scoreAttempt = (candidate: any) => (candidate?.grades ?? []).reduce((total: any, item: any) => total + Number(item.adjustment?.newScore ?? item.awardedScore), 0);
      const gradedAttempts = attempts.filter((candidate: any) => candidate.submission && candidate.grade);
      const countMode = (mode: any) => grades.filter((grade: any) => grade.questionMode === mode).length;
      const correctMode = (mode: any) => grades.filter((grade: any) => grade.questionMode === mode && grade.status === "correct").length;
      const score = scoreAttempt(attempt);
      const warningEvents = attempts.flatMap((candidate: any) => (candidate.proctorEvents ?? []).map((event: any) => ({
        attemptNumber: candidate.attemptNumber ?? 1,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
      })));
      const questionResults = !attempt?.submission
        ? []
        : attempt.questions.map((question: any) => ({
            questionKey: question.key,
            resultStatus: grades.find((grade: any) => grade.questionKey === question.key)?.status ?? "unanswered",
          }));
      const policySuspensions = attempts.flatMap((candidate: any) => (candidate.policySuspensions ?? []).map((suspension: any) => ({
        attemptNumber: candidate.attemptNumber ?? 1,
        suspendedAt: suspension.suspendedAt,
        remainingSeconds: suspension.remainingSeconds,
        resumedAt: suspension.resumedAt,
        resumedBy: suspension.resumedBy,
        collectedAt: suspension.collectedAt ?? null,
        collectedBy: suspension.collectedBy ?? null,
        status: suspension.status,
      })));
      const forcedSubmissionEvents = attempts
        .filter((candidate: any) => ["policy", "teacher"].includes(candidate.submission?.type))
        .map((candidate: any) => ({ attemptNumber: candidate.attemptNumber ?? 1, submissionType: candidate.submission.type, submittedAt: candidate.submission.submittedAt }));
      const highestAttempt = gradedAttempts.reduce((best: any, candidate: any) => !best || scoreAttempt(candidate) > scoreAttempt(best) ? candidate : best, null);
      return {
        studentNumber: student.studentNumber,
        name: student.name,
        attemptStatus: retakeWaiting ? "waiting" : latestAttempt?.status ?? "not_started",
        attemptCount,
        submittedAt: attempt?.submission?.submittedAt ?? null,
        gradingStatus: attempt?.submission ? (attempt.gradingStatus ?? (attempt.grade ? "graded" : "pending")) : null,
        score: attempt?.grade ? score : null,
        maximumScore: attempt?.grade?.maximumScore ?? null,
        highestScore: highestAttempt ? scoreAttempt(highestAttempt) : null,
        highestMaximumScore: highestAttempt?.grade?.maximumScore ?? null,
        adjusted: grades.some((grade: any) => Boolean(grade.adjustment)),
        choiceCorrect: correctMode("choice"),
        choiceTotal: countMode("choice"),
        formulaCorrect: correctMode("formula"),
        formulaTotal: countMode("formula"),
        warningCount: warningEvents.length,
        policySubmissionCount: attempts.filter((candidate: any) => candidate.submission?.type === "policy").length,
        policySuspensionCount: policySuspensions.length,
        forcedSubmissionCount: forcedSubmissionEvents.length,
        warningEvents,
        policySuspensions,
        forcedSubmissionEvents,
        questionResults,
      };
    });
  }

  async getResult({ examCode, studentNumber }: any) {
    const exam = this.#exams.find((candidate: any) => candidate.examCode === normalizeExamCode(examCode));
    const student = exam?.students.find((candidate: any) => candidate.studentNumber === normalizeStudentIdentity({ studentNumber }).studentNumber);
    const attempt = [...(student?.attemptHistory ?? []), ...(student?.attempt ? [student.attempt] : [])]
      .findLast((candidate: any) => candidate.submission && candidate.grades?.length);
    if (!attempt) return null;
    return {
      student: { studentNumber: student.studentNumber, name: student.name },
      attempt: { status: attempt.status, submittedAt: attempt.submission.submittedAt },
      questions: attempt.questions.map((question: any) => {
        const grade = attempt.grades.find((candidate: any) => candidate.questionKey === question.key);
        const answer = attempt.answerPayload[question.key] ?? "";
        return {
          gradeResultId: grade.id,
          questionKey: question.key,
          questionMode: question.questionMode,
          prompt: structuredClone(question.studentPayload ?? {}),
          answer,
          formula: typeof answer === "string" ? answer : "",
          referenceAnswer: grade.explanation?.referenceAnswer ?? null,
          awardedScore: grade.adjustment?.newScore ?? grade.awardedScore,
          automaticScore: grade.awardedScore,
          maximumScore: grade.maximumScore,
          resultStatus: grade.status,
          adjustment: grade.adjustment,
        };
      }),
    };
  }

  async adjustGrade({ gradeResultId, newScore, reason, adjustedByLogin, now = new Date() }: any) {
    for (const exam of this.#exams) {
      for (const student of exam.students) {
        const attempts = [student.attempt, ...(student.attemptHistory ?? [])].filter(Boolean);
        for (const attempt of attempts) {
          const grade = attempt.grades?.find((candidate: any) => candidate.id === gradeResultId);
          if (!grade) continue;
          if (newScore < 0 || newScore > grade.maximumScore) throw attemptError("INVALID_SCORE", "Adjusted score exceeds the allowed range.", 422);
          grade.adjustment = { previousScore: grade.adjustment?.newScore ?? grade.awardedScore, newScore, reason, adjustedBy: adjustedByLogin, adjustedAt: now.toISOString() };
          if (attempt.grades
            .filter((candidate: any) => candidate.status === "review_required")
            .every((candidate: any) => Boolean(candidate.adjustment))) {
            attempt.gradingStatus = "graded";
            attempt.grade.status = "graded";
          }
          return structuredClone(grade.adjustment);
        }
      }
    }
    return null;
  }

  async close() {}
}

async function persistPostgresSubmission(client: any, targetRows: any, { submissionType, now, revealScore = false, attemptNumber = 1 }: any) {
  const row = targetRows[0];
  if (!row) throw attemptError("PAPER_NOT_PREPARED", "Attempt has no prepared questions.", 500);
  const gradedSubmission: any = gradePreparedSubmission({
    assessmentTypeKey: row.assessment_type_key,
    questions: targetRows.map((item: any) => ({
      key: item.question_key,
      questionMode: item.question_mode,
      studentPayload: item.instance_payload,
      answerKey: item.answer_key,
      scoringRule: item.scoring_rule,
    })),
    answers: row.answer_payload ?? {},
    policyViolation: submissionType === "policy",
  });
  const submissionId = randomUUID();
  const answerVersion = await client.query("SELECT version FROM answers WHERE attempt_id = $1", [row.id]);
  await client.query(
    `INSERT INTO answer_revisions (id, attempt_id, version, reason, answer_payload)
     VALUES ($1, $2, $3, 'before_submit', $4::jsonb)
     ON CONFLICT (attempt_id, version) DO NOTHING`,
    [randomUUID(), row.id, answerVersion.rows[0]?.version ?? 0, JSON.stringify(row.answer_payload ?? {})],
  );
  await client.query(
    `INSERT INTO submissions (id, attempt_id, submission_type, final_answer_payload, grading_status, grading_started_at, graded_at, submitted_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::text, $6::timestamptz,
             CASE WHEN $5::text='graded' THEN $6::timestamptz ELSE NULL END,
             $6::timestamptz)`,
    [submissionId, row.id, submissionType, JSON.stringify(row.answer_payload ?? {}), gradedSubmission.gradingStatus, now],
  );
  const gradeParameters: any[] = [];
  const gradeGroups = targetRows.map((item: any, index: any) => {
    const grade = gradedSubmission.results[index];
    const explanation = submissionType === "policy"
      ? { reason: "policy_violation_limit" }
      : grade.explanation ?? { calculatedValue: grade.calculatedValue };
    const values = [randomUUID(), submissionId, item.question_instance_id, grade.awardedScore, grade.maximumScore, grade.status, JSON.stringify(explanation), item.scoring_rule.version ?? "automatic-grading-v1"];
    gradeParameters.push(...values);
    const base = index * values.length;
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7}::jsonb,$${base + 8})`;
  });
  await client.query(
    `INSERT INTO grade_results (id,submission_id,question_instance_id,awarded_score,maximum_score,result_status,explanation,grading_rule_version) VALUES ${gradeGroups.join(",")}`,
    gradeParameters,
  );
  await client.query(
    `UPDATE attempts
     SET status = $2, submitted_at = $3, updated_at = $3
     WHERE id = $1`,
    [row.id, submissionType === "policy" ? "policy_submitted" : submissionType === "timer" ? "auto_submitted" : submissionType === "teacher" ? "teacher_submitted" : "submitted", now],
  );
  const submission = { type: submissionType, submittedAt: now.toISOString(), status: "received" };
  if (!revealScore) return submission;
  return {
    ...submission,
    score: gradedSubmission.totals.awardedScore,
    maximumScore: gradedSubmission.totals.maximumScore,
    correctCount: gradedSubmission.results.filter((result: any) => result.status === "correct").length,
    questionCount: gradedSubmission.results.length,
    attemptNumber,
    attemptsRemaining: Math.max(0, getStudentExperiencePolicy(ASSIGNMENT_MODE).maximumAttempts! - attemptNumber),
  };
}

async function approvePostgresWaitingAttempts(client: any, waitingAttempts: any, teacherId: any) {
  if (!waitingAttempts.length) return;
  const approvalParameters: any[] = [];
  const approvalGroups = waitingAttempts.map((row: any, index: any) => {
    const values = [randomUUID(), row.exam_id, row.student_id, teacherId];
    approvalParameters.push(...values);
    const base = index * values.length;
    return `($${base + 1}::uuid,$${base + 2}::uuid,$${base + 3}::uuid,$${base + 4}::uuid,'approved',CURRENT_TIMESTAMP)`;
  });
  const approvals = await client.query(
    `INSERT INTO admission_approvals (id,exam_id,student_id,approved_by_teacher_id,status,approved_at)
     VALUES ${approvalGroups.join(",")}
     ON CONFLICT (exam_id,student_id) DO UPDATE
     SET approved_by_teacher_id=EXCLUDED.approved_by_teacher_id,status='approved',approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     RETURNING id,exam_id,student_id`,
    approvalParameters,
  );
  const approvalByStudent = new Map(approvals.rows.map((approval: any) => [
    `${approval.exam_id}:${approval.student_id}`,
    approval.id,
  ]));
  const attemptParameters: any[] = [];
  const attemptGroups = waitingAttempts.map((row: any, index: any) => {
    const values = [row.attempt_id, approvalByStudent.get(`${row.exam_id}:${row.student_id}`)];
    attemptParameters.push(...values);
    const base = index * values.length;
    return `($${base + 1}::uuid,$${base + 2}::uuid)`;
  });
  await client.query(
    `WITH input (attempt_id,approval_id) AS (VALUES ${attemptGroups.join(",")})
     UPDATE attempts attempt
     SET admission_approval_id=input.approval_id,updated_at=CURRENT_TIMESTAMP
     FROM input WHERE attempt.id=input.attempt_id`,
    attemptParameters,
  );

  const retakes = waitingAttempts.filter((row: any) => row.attempt_number > 1);
  if (!retakes.length) return;
  const previousParameters: any[] = [];
  const previousGroups = retakes.map((row: any, index: any) => {
    const values = [row.exam_id, row.student_id, row.attempt_number - 1, row.attempt_id];
    previousParameters.push(...values);
    const base = index * values.length;
    return `($${base + 1}::uuid,$${base + 2}::uuid,$${base + 3}::integer,$${base + 4}::uuid)`;
  });
  const previousAttempts = await client.query(
    `WITH input (exam_id,student_id,previous_number,new_attempt_id) AS (VALUES ${previousGroups.join(",")})
     SELECT input.exam_id,input.student_id,input.new_attempt_id,previous.id AS previous_attempt_id
     FROM input INNER JOIN attempts previous
       ON previous.exam_id=input.exam_id
      AND previous.student_id=input.student_id
      AND previous.attempt_number=input.previous_number`,
    previousParameters,
  );
  if (previousAttempts.rowCount !== retakes.length) {
    throw attemptError("PREVIOUS_ATTEMPT_NOT_FOUND", "A previous attempt audit record is missing.", 409);
  }
  const auditParameters: any[] = [];
  const auditGroups = previousAttempts.rows.map((row: any, index: any) => {
    const values = [randomUUID(), row.exam_id, row.student_id, row.previous_attempt_id, row.new_attempt_id, teacherId];
    auditParameters.push(...values);
    const base = index * values.length;
    return `($${base + 1}::uuid,$${base + 2}::uuid,$${base + 3}::uuid,$${base + 4}::uuid,$${base + 5}::uuid,$${base + 6}::uuid)`;
  });
  await client.query(
    `INSERT INTO attempt_retake_authorizations
       (id,exam_id,student_id,previous_attempt_id,new_attempt_id,authorized_by_teacher_id)
     VALUES ${auditGroups.join(",")}
     ON CONFLICT (exam_id,student_id,previous_attempt_id) DO NOTHING`,
    auditParameters,
  );
}

export class PostgresStudentExamRepository implements StudentExamRepository {
  #pool: InstanceType<typeof Pool>;

  constructor({ connectionString, databasePoolMax }: any) {
    const capacityPolicy = normalizeCapacityPolicy({ databasePoolMax });
    this.#pool = new Pool({
      connectionString,
      max: capacityPolicy.databasePoolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.#pool.on("connect", (client: any) => {
      client.on("error", (error: any) => {
        console.error("PostgreSQL active student exam client error:", error.message);
      });
    });
    this.#pool.on("error", (error: any) => {
      console.error("PostgreSQL student exam pool error:", error.message);
    });
  }

  async verifyIdentity({ examCode, studentNumber }: any) {
    const identity = normalizeStudentIdentity({ studentNumber });
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const identityResult = await client.query(
        `SELECT exam.id,exam.exam_code,exam.title_ja,exam.duration_minutes,exam.exam_mode,exam.settings,exam.subject_id,
                student.id AS student_id,student.student_number,
                COALESCE(NULLIF(roster.roster_name,''),NULLIF(student.name_native,''),student.name_ja) AS student_name,
                latest.id AS attempt_id,latest.status AS attempt_status,latest.attempt_number,
                approval.status AS approval_status
         FROM exams exam
         INNER JOIN exam_roster roster ON roster.exam_id=exam.id AND roster.enrollment_status='eligible'
         INNER JOIN students student ON student.id=roster.student_id
         LEFT JOIN LATERAL (
           SELECT item.id,item.status,item.attempt_number FROM attempts item
           WHERE item.exam_id=exam.id AND item.student_id=student.id
           ORDER BY item.attempt_number DESC LIMIT 1
         ) latest ON TRUE
         LEFT JOIN admission_approvals approval ON approval.exam_id=exam.id AND approval.student_id=student.id
         WHERE exam.exam_code=$1 AND exam.state IN ('published','active') AND student.student_number=$2
           AND NOT EXISTS (
             SELECT 1 FROM exam_termination_runs termination
             WHERE termination.exam_id=exam.id AND termination.status IN ('collecting','processing','completed')
           )
         FOR UPDATE OF roster`,
        [normalizeExamCode(examCode), identity.studentNumber],
      );
      const record = identityResult.rows[0];
      if (!record) { await client.query("ROLLBACK"); return null; }
      const exam = {
        id: record.id,
        exam_code: record.exam_code,
        title_ja: record.title_ja,
        duration_minutes: record.duration_minutes,
        exam_mode: record.exam_mode,
        settings: record.settings,
        subject_id: record.subject_id,
      };
      const student = {
        id: record.student_id,
        student_number: record.student_number,
        student_name: record.student_name,
      };
      let latest: any = record.attempt_id ? {
        id: record.attempt_id,
        status: record.attempt_status,
        attempt_number: record.attempt_number,
      } : null;
      let approvalStatus = record.approval_status;
      if (!latest) {
        await client.query("INSERT INTO attempts (id, exam_id, student_id, status, attempt_number) VALUES ($1,$2,$3,'waiting',1)", [randomUUID(), exam.id, student.id]);
        latest = { status: "waiting", attempt_number: 1 };
      } else if (exam.exam_mode === EXAM_MODE
        && ["submitted", "auto_submitted", "teacher_submitted", "policy_submitted", "review_required"].includes(latest.status)) {
        await client.query(
          "INSERT INTO attempts (id, exam_id, student_id, status, attempt_number) VALUES ($1,$2,$3,'waiting',$4)",
          [randomUUID(), exam.id, student.id, latest.attempt_number + 1],
        );
        await client.query(
          "UPDATE admission_approvals SET status='waiting',approved_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE exam_id=$1 AND student_id=$2",
          [exam.id, student.id],
        );
        approvalStatus = "waiting";
        latest = { status: "waiting", attempt_number: latest.attempt_number + 1 };
      } else if (exam.exam_mode === ASSIGNMENT_MODE
        && latest.attempt_number < getStudentExperiencePolicy(ASSIGNMENT_MODE).maximumAttempts!
        && ["submitted", "auto_submitted", "teacher_submitted", "policy_submitted", "review_required"].includes(latest.status)) {
        await client.query(
          "INSERT INTO attempts (id, exam_id, student_id, status, attempt_number) VALUES ($1,$2,$3,'waiting',$4)",
          [randomUUID(), exam.id, student.id, latest.attempt_number + 1],
        );
        latest = { status: "waiting", attempt_number: latest.attempt_number + 1 };
      }
      await client.query("COMMIT");
      const experience = getStudentExperiencePolicy(exam.exam_mode);
      return {
        status: resolveStudentEntryStatus({ attemptStatus: latest.status, approvalStatus: experience.requiresAdmission ? approvalStatus : "approved" }),
        exam: { code: exam.exam_code, titleJa: exam.title_ja, durationMinutes: exam.duration_minutes, mode: exam.exam_mode, subjectId: exam.subject_id },
        student: { studentNumber: identity.studentNumber, name: student.student_name },
        experience,
      };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async listAttendance(examCode: any, { now = new Date(), offlineAfterSeconds = 45 }: any = {}) {
    const result = await this.#pool.query(
      `
        SELECT e.exam_mode, s.student_number, COALESCE(NULLIF(roster.roster_name, ''), NULLIF(s.name_native, ''), s.name_ja) AS student_name,
          approval.status AS approval_status,attempt.status AS attempt_status,attempts.arrived_at,
          attempts.attempt_count,
          attempt.started_at,attempt.deadline_at,attempt.submitted_at,session.last_seen_at,
          recovery.status AS recovery_status,COALESCE(events.violation_count,0)::integer AS violation_count,
          suspension.suspended_at,suspension.remaining_seconds AS suspended_remaining_seconds
        FROM exams e
        INNER JOIN exam_roster roster ON roster.exam_id = e.id AND roster.enrollment_status = 'eligible'
        INNER JOIN students s ON s.id = roster.student_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::integer AS attempt_count, MIN(item.created_at) AS arrived_at
          FROM attempts item WHERE item.exam_id=e.id AND item.student_id=s.id
        ) attempts ON TRUE
        LEFT JOIN LATERAL (
          SELECT item.* FROM attempts item WHERE item.exam_id=e.id AND item.student_id=s.id
          ORDER BY item.attempt_number DESC LIMIT 1
        ) attempt ON TRUE
        LEFT JOIN admission_approvals approval ON approval.exam_id = e.id AND approval.student_id = s.id
        LEFT JOIN active_sessions session ON session.id=attempt.active_session_id
          AND session.status='active' AND session.expires_at>CURRENT_TIMESTAMP
        LEFT JOIN LATERAL (
          SELECT item.status FROM attempt_resume_authorizations item
          WHERE item.attempt_id=attempt.id ORDER BY item.authorized_at DESC LIMIT 1
        ) recovery ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS violation_count FROM proctor_events event WHERE event.attempt_id=attempt.id
        ) events ON TRUE
        LEFT JOIN LATERAL (
          SELECT item.suspended_at,item.remaining_seconds
          FROM attempt_policy_suspensions item
          WHERE item.attempt_id=attempt.id AND item.status='suspended'
          ORDER BY item.suspended_at DESC LIMIT 1
        ) suspension ON TRUE
        WHERE e.exam_code = $1
        ORDER BY s.student_number ASC
      `,
      [normalizeExamCode(examCode)],
    );
    if (result.rows.length === 0) {
      const exists = await this.#pool.query("SELECT 1 FROM exams WHERE exam_code=$1", [normalizeExamCode(examCode)]);
      if (!exists.rows[0]) return null;
    }
    return result.rows.map((row: any) => {
      let status = "not_entered";
      if (row.attempt_status === "waiting") status = row.exam_mode === ASSIGNMENT_MODE || row.approval_status === "approved" ? "admitted" : "waiting_approval";
      else if (["submitted", "auto_submitted", "teacher_submitted", "policy_submitted", "review_required"].includes(row.attempt_status)) status = row.attempt_status;
      else if (row.attempt_status === "policy_suspended") status = "policy_suspended";
      else if (row.attempt_status === "in_progress" && row.recovery_status === "granted") status = "resume_ready";
      else if (row.attempt_status === "in_progress" && row.deadline_at?.getTime() <= now.getTime()) status = "expired";
      else if (row.exam_mode !== ASSIGNMENT_MODE && row.attempt_status === "in_progress" && (!row.last_seen_at || now.getTime() - row.last_seen_at.getTime() > offlineAfterSeconds * 1000)) status = "disconnected";
      else if (row.attempt_status === "in_progress") status = "in_progress";
      return { studentNumber: row.student_number, name: normalizeStudentIdentity({ name: row.student_name }).name, status, attemptCount: row.attempt_count ?? 0, arrivedAt: row.arrived_at?.toISOString() ?? null, startedAt: row.started_at?.toISOString() ?? null, deadlineAt: row.deadline_at?.toISOString() ?? null, lastSeenAt: row.last_seen_at?.toISOString() ?? null, submittedAt: row.submitted_at?.toISOString() ?? null, remainingSeconds: row.suspended_remaining_seconds ?? (row.deadline_at ? Math.max(0, Math.floor((row.deadline_at.getTime() - now.getTime()) / 1000)) : null), violationCount: row.violation_count, suspendedAt: row.suspended_at?.toISOString() ?? null };
    });
  }

  async getRoomMetadata(examCode: any) {
    const result = await this.#pool.query(
      `SELECT exam.exam_mode,exam.title_ja,exam.state,exam.subject_id,
              EXISTS (
                SELECT 1 FROM exam_termination_runs termination
                WHERE termination.exam_id=exam.id AND termination.status IN ('collecting','processing')
              ) AS termination_collecting,
              COUNT(roster.student_id) FILTER (WHERE roster.enrollment_status='eligible')::integer AS roster_count
       FROM exams exam
       LEFT JOIN exam_roster roster ON roster.exam_id=exam.id
       WHERE exam.exam_code=$1
       GROUP BY exam.id`,
      [normalizeExamCode(examCode)],
    );
    const row = result.rows[0];
    return row ? {
      mode: row.exam_mode,
      titleJa: row.title_ja,
      rosterCount: row.roster_count,
      state: row.state,
      subjectId: row.subject_id,
      ...(row.termination_collecting ? { terminationCollecting: true } : {}),
    } : null;
  }

  async getExamAuthorizationTarget(examCode: any): Promise<AuthorizationResource | null> {
    const result = await this.#pool.query(
      `SELECT subject_id,owner_account_id,exam_code
       FROM exams
       WHERE exam_code=$1`,
      [normalizeExamCode(examCode)],
    );
    const row = result.rows[0];
    return row ? {
      subjectId: row.subject_id,
      ownerAccountId: row.owner_account_id,
      resourceType: "exam",
      resourceId: row.exam_code,
    } : null;
  }

  async getGradeAuthorizationTarget(gradeResultId: any): Promise<AuthorizationResource | null> {
    const result = await this.#pool.query(
      `SELECT exam.subject_id,exam.owner_account_id
       FROM grade_results grade
       INNER JOIN question_instances question ON question.id=grade.question_instance_id
       INNER JOIN attempts attempt ON attempt.id=question.attempt_id
       INNER JOIN exams exam ON exam.id=attempt.exam_id
       WHERE grade.id=$1`,
      [gradeResultId],
    );
    const row = result.rows[0];
    return row ? {
      subjectId: row.subject_id,
      ownerAccountId: row.owner_account_id,
      resourceType: "grade_result",
      resourceId: gradeResultId,
    } : null;
  }

  async heartbeat({ examCode, studentNumber, sessionTokenHash }: any) {
    const result = await this.#pool.query(
      `UPDATE active_sessions session SET last_seen_at=CURRENT_TIMESTAMP
       FROM attempts attempt INNER JOIN exams exam ON exam.id=attempt.exam_id INNER JOIN students student ON student.id=attempt.student_id
       LEFT JOIN exam_termination_runs termination ON termination.exam_id=exam.id
         AND termination.status IN ('collecting','processing')
       WHERE session.id=attempt.active_session_id AND session.session_token_hash=$1
         AND session.status='active' AND session.expires_at>CURRENT_TIMESTAMP
          AND attempt.status IN ('in_progress','policy_suspended') AND exam.exam_code=$2 AND student.student_number=$3
       RETURNING session.last_seen_at,attempt.id AS attempt_id,attempt.status,attempt.deadline_at,
                  termination.status AS termination_status,termination.collect_until`,
      [sessionTokenHash, normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (["collecting", "processing"].includes(row.termination_status)) {
      return { status: "termination_collecting", collectUntil: row.collect_until.toISOString(), lastSeenAt: row.last_seen_at.toISOString() };
    }
    if (row.status === "policy_suspended") {
      const suspended = await this.#pool.query(
        "SELECT suspended_at,remaining_seconds FROM attempt_policy_suspensions WHERE attempt_id=$1 AND status='suspended' ORDER BY suspended_at DESC LIMIT 1",
        [row.attempt_id],
      );
      return {
        status: "policy_suspended",
        suspendedAt: suspended.rows[0]?.suspended_at?.toISOString() ?? null,
        remainingSeconds: suspended.rows[0]?.remaining_seconds ?? 0,
        lastSeenAt: row.last_seen_at.toISOString(),
      };
    }
    return { status: "active", deadlineAt: row.deadline_at?.toISOString() ?? null, lastSeenAt: row.last_seen_at.toISOString() };
  }

  async authorizeResume({ examCode, studentNumber, authorizedByLogin }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const rosterLock = await client.query(
        `SELECT roster.exam_id,roster.student_id
         FROM exam_roster roster
         INNER JOIN exams exam ON exam.id=roster.exam_id
         INNER JOIN students student ON student.id=roster.student_id
         WHERE exam.exam_code=$1 AND student.student_number=$2
         FOR UPDATE OF roster`,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
      );
      if (!rosterLock.rows[0]) { await client.query("ROLLBACK"); return null; }
      const target = await client.query(
        `SELECT attempt.id AS attempt_id,attempt.active_session_id,attempt.status,
                suspension.id AS suspension_id,suspension.remaining_seconds
         FROM attempts attempt INNER JOIN exams exam ON exam.id=attempt.exam_id INNER JOIN students student ON student.id=attempt.student_id
         LEFT JOIN submissions submission ON submission.attempt_id=attempt.id
         LEFT JOIN LATERAL (
           SELECT item.id,item.remaining_seconds FROM attempt_policy_suspensions item
           WHERE item.attempt_id=attempt.id AND item.status='suspended'
           ORDER BY item.suspended_at DESC LIMIT 1
         ) suspension ON TRUE
         WHERE exam.exam_code=$1 AND student.student_number=$2
           AND exam.exam_mode='exam' AND exam.state IN ('published','active') AND submission.id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM exam_termination_runs termination
             WHERE termination.exam_id=exam.id AND termination.status IN ('collecting','processing','completed')
           )
           AND (
             (attempt.status='in_progress' AND attempt.deadline_at>CURRENT_TIMESTAMP)
             OR (attempt.status='policy_suspended' AND suspension.id IS NOT NULL)
           )
         ORDER BY (attempt.status='policy_suspended') DESC,attempt.attempt_number DESC
         LIMIT 1 FOR UPDATE OF attempt`,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
      );
      if (!target.rows[0]) { await client.query("ROLLBACK"); return null; }
      const teacher = await client.query("INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$2) ON CONFLICT (login_name) DO UPDATE SET login_name=EXCLUDED.login_name RETURNING id", [randomUUID(), authorizedByLogin]);
      const row = target.rows[0];
      if (row.status === "policy_suspended") {
        const resumed = await client.query(
          `UPDATE attempts
           SET status='in_progress',deadline_at=CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 second'),updated_at=CURRENT_TIMESTAMP
           WHERE id=$1 RETURNING deadline_at`,
          [row.attempt_id, row.remaining_seconds],
        );
        await client.query(
          "UPDATE attempt_policy_suspensions SET status='resumed',resumed_at=CURRENT_TIMESTAMP,resumed_by_teacher_id=$2 WHERE id=$1 AND status='suspended'",
          [row.suspension_id, teacher.rows[0].id],
        );
        await client.query("COMMIT");
        return { studentNumber: normalizeStudentIdentity({ studentNumber }).studentNumber, status: "in_progress", deadlineAt: resumed.rows[0].deadline_at.toISOString() };
      }
      await client.query("UPDATE attempt_resume_authorizations SET status='superseded' WHERE attempt_id=$1 AND status='granted'", [row.attempt_id]);
      if (row.active_session_id) await client.query("UPDATE active_sessions SET status='revoked' WHERE id=$1 AND status='active'", [row.active_session_id]);
      await client.query("UPDATE attempts SET active_session_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.attempt_id]);
      await client.query(
        "INSERT INTO attempt_resume_authorizations (id,attempt_id,authorized_by_teacher_id,previous_session_id,status) VALUES ($1,$2,$3,$4,'granted')",
        [randomUUID(), row.attempt_id, teacher.rows[0].id, row.active_session_id],
      );
      await client.query("COMMIT");
      return { studentNumber: normalizeStudentIdentity({ studentNumber }).studentNumber, status: "resume_ready" };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async authorizeRetake({ examCode, studentNumber, authorizedByLogin }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `SELECT attempt.id AS attempt_id,attempt.exam_id,attempt.student_id,attempt.attempt_number,attempt.status,
                student.student_number
         FROM attempts attempt
         INNER JOIN exams exam ON exam.id=attempt.exam_id
         INNER JOIN students student ON student.id=attempt.student_id
         WHERE exam.exam_code=$1 AND student.student_number=$2
            AND exam.exam_mode='exam' AND exam.state IN ('published','active')
            AND NOT EXISTS (
              SELECT 1 FROM exam_termination_runs termination
              WHERE termination.exam_id=exam.id AND termination.status IN ('collecting','processing','completed')
            )
           AND attempt.attempt_number=(SELECT MAX(item.attempt_number) FROM attempts item WHERE item.exam_id=attempt.exam_id AND item.student_id=attempt.student_id)
         FOR UPDATE OF attempt`,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
      );
      if (!target.rows[0]) { await client.query("ROLLBACK"); return null; }
      const teacher = await client.query("INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$2) ON CONFLICT (login_name) DO UPDATE SET login_name=EXCLUDED.login_name RETURNING id", [randomUUID(), authorizedByLogin]);
      const row = target.rows[0];
      let waitingAttempt = row;
      if (["submitted", "auto_submitted", "teacher_submitted", "policy_submitted", "review_required"].includes(row.status)) {
        waitingAttempt = {
          attempt_id: randomUUID(),
          exam_id: row.exam_id,
          student_id: row.student_id,
          attempt_number: row.attempt_number + 1,
        };
        await client.query("UPDATE active_sessions SET status='revoked' WHERE exam_id=$1 AND student_id=$2 AND status='active'", [row.exam_id, row.student_id]);
        await client.query(
          "INSERT INTO attempts (id,exam_id,student_id,status,attempt_number) VALUES ($1,$2,$3,'waiting',$4)",
          [waitingAttempt.attempt_id, row.exam_id, row.student_id, waitingAttempt.attempt_number],
        );
      } else if (row.status !== "waiting" || row.attempt_number <= 1) {
        await client.query("ROLLBACK");
        return null;
      }
      await approvePostgresWaitingAttempts(client, [waitingAttempt], teacher.rows[0].id);
      await client.query("COMMIT");
      return { studentNumber: row.student_number, status: "admitted", attemptCount: waitingAttempt.attempt_number };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async admitStudent({ examCode, studentNumber, approvedByLogin }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `
          SELECT e.id AS exam_id, s.id AS student_id
          FROM exams e
          INNER JOIN exam_roster roster ON roster.exam_id = e.id AND roster.enrollment_status = 'eligible'
          INNER JOIN students s ON s.id = roster.student_id
          WHERE e.exam_code = $1 AND s.student_number = $2
            AND e.state IN ('published','active')
            AND NOT EXISTS (
              SELECT 1 FROM exam_termination_runs termination
              WHERE termination.exam_id=e.id AND termination.status IN ('collecting','processing','completed')
            )
          FOR UPDATE
        `,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
      );
      if (!target.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      const teacher = await client.query(
        `
          INSERT INTO teachers (id, login_name, display_name)
          VALUES ($1, $2, $2)
          ON CONFLICT (login_name) DO UPDATE SET login_name = EXCLUDED.login_name
          RETURNING id
        `,
        [randomUUID(), approvedByLogin],
      );
      const { exam_id: examId, student_id: studentId } = target.rows[0];
      const waiting = await client.query(
        "SELECT id AS attempt_id,exam_id,student_id,attempt_number FROM attempts WHERE exam_id = $1 AND student_id = $2 AND status = 'waiting' ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE",
        [examId, studentId],
      );
      if (!waiting.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      await approvePostgresWaitingAttempts(client, waiting.rows, teacher.rows[0].id);
      await client.query("COMMIT");
      return { studentNumber: normalizeStudentIdentity({ studentNumber }).studentNumber, status: "admitted" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async admitWaitingStudents({ examCode, approvedByLogin }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const teacher = await client.query("INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$2) ON CONFLICT (login_name) DO UPDATE SET login_name=EXCLUDED.login_name RETURNING id", [randomUUID(), approvedByLogin]);
      const waiting = await client.query("SELECT exam.id AS exam_id,attempt.id AS attempt_id,attempt.student_id,attempt.attempt_number FROM exams exam INNER JOIN attempts attempt ON attempt.exam_id=exam.id WHERE exam.exam_code=$1 AND exam.state IN ('published','active') AND attempt.status='waiting' AND NOT EXISTS (SELECT 1 FROM exam_termination_runs termination WHERE termination.exam_id=exam.id AND termination.status IN ('collecting','processing','completed')) FOR UPDATE OF attempt", [normalizeExamCode(examCode)]);
      await approvePostgresWaitingAttempts(client, waiting.rows, teacher.rows[0].id);
      await client.query("COMMIT");
      return { admittedCount: waiting.rowCount };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async admitStudents({ examCode, studentNumbers, approvedByLogin }: any) {
    const uniqueNumbers = [...new Set(studentNumbers.map((value: any) => normalizeStudentIdentity({ studentNumber: value }).studentNumber))];
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const teacher = await client.query("INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$2) ON CONFLICT (login_name) DO UPDATE SET login_name=EXCLUDED.login_name RETURNING id", [randomUUID(), approvedByLogin]);
      const waiting = await client.query(
        `SELECT exam.id AS exam_id,attempt.id AS attempt_id,attempt.student_id,attempt.attempt_number
         FROM exams exam INNER JOIN attempts attempt ON attempt.exam_id=exam.id
         INNER JOIN students student ON student.id=attempt.student_id
         WHERE exam.exam_code=$1 AND exam.state IN ('published','active') AND attempt.status='waiting' AND student.student_number=ANY($2::text[])
           AND NOT EXISTS (
             SELECT 1 FROM exam_termination_runs termination
             WHERE termination.exam_id=exam.id AND termination.status IN ('collecting','processing','completed')
           )
         FOR UPDATE OF attempt`,
        [normalizeExamCode(examCode), uniqueNumbers],
      );
      await approvePostgresWaitingAttempts(client, waiting.rows, teacher.rows[0].id);
      await client.query("COMMIT");
      return { admittedCount: waiting.rowCount };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async listExamEvents({ authorization = null, action = "view_room" }: any = {}) {
    const scope = authorization ? getAuthorizationQueryScope(authorization, action) : null;
    if (scope && !scope.unrestricted && scope.allResourceSubjectIds.length === 0 && scope.ownedResourceSubjectIds.length === 0) return [];
    const scopeWhere = scope && !scope.unrestricted
      ? `WHERE (exam.subject_id=ANY($1::uuid[])
          OR (exam.subject_id=ANY($2::uuid[]) AND exam.owner_account_id=$3::uuid))`
      : "";
    const scopeValues = scope && !scope.unrestricted
      ? [scope.allResourceSubjectIds, scope.ownedResourceSubjectIds, scope.accountId]
      : [];
    const result = await this.#pool.query(
      `SELECT exam.exam_code,exam.subject_id,exam.owner_account_id,exam.title_ja,exam.state,exam.duration_minutes,exam.settings->>'mode' AS mode,
              exam.settings->'termination' AS termination,
              exam.created_at,preparation.status AS preparation_status,
              COUNT(DISTINCT roster.student_id)::integer AS roster_count,
              COUNT(DISTINCT attempt.student_id) FILTER (WHERE attempt.status='waiting' AND COALESCE(approval.status,'waiting')<>'approved')::integer AS waiting_count,
              COUNT(DISTINCT attempt.student_id) FILTER (WHERE attempt.status IN ('in_progress','policy_suspended'))::integer AS in_progress_count,
              COUNT(DISTINCT attempt.student_id) FILTER (WHERE attempt.status IN ('submitted','auto_submitted','teacher_submitted','policy_submitted','review_required'))::integer AS submitted_count
       FROM exams exam
       LEFT JOIN exam_roster roster ON roster.exam_id=exam.id AND roster.enrollment_status='eligible'
       LEFT JOIN LATERAL (
         SELECT item.* FROM attempts item WHERE item.exam_id=exam.id AND item.student_id=roster.student_id
         ORDER BY item.attempt_number DESC LIMIT 1
       ) attempt ON TRUE
       LEFT JOIN admission_approvals approval ON approval.exam_id=exam.id AND approval.student_id=roster.student_id
       LEFT JOIN LATERAL (SELECT item.status FROM exam_preparation_runs item WHERE item.exam_id=exam.id ORDER BY item.created_at DESC LIMIT 1) preparation ON TRUE
       ${scopeWhere}
       GROUP BY exam.id,preparation.status ORDER BY exam.created_at DESC`,
      scopeValues,
    );
    return result.rows
      .filter((row: any) => !authorization || authorizeTeacherAction({
        actor: authorization,
        action,
        resource: { subjectId: row.subject_id, ownerAccountId: row.owner_account_id, resourceType: "exam", resourceId: row.exam_code },
      }).allowed)
      .map((row: any) => ({ code: row.exam_code, subjectId: row.subject_id, titleJa: row.title_ja, mode: row.mode ?? "exam", state: row.state, termination: row.termination ?? null, durationMinutes: row.duration_minutes, rosterCount: row.roster_count, preparationStatus: row.preparation_status ?? "pending", waitingCount: row.waiting_count, inProgressCount: row.in_progress_count, submittedCount: row.submitted_count, createdAt: row.created_at.toISOString() }));
  }

  async listTerminationFailures(examCode: any) {
    const result = await this.#pool.query(
      `SELECT failure.attempt_id,student.student_number,
              COALESCE(NULLIF(roster.roster_name,''),NULLIF(student.name_native,''),student.name_ja) AS student_name,
              attempt.attempt_number,failure.error_code,failure.error_message,
              failure.occurrence_count,failure.first_failed_at,failure.last_failed_at,
              failure.last_retried_at,teacher.login_name AS last_retried_by
       FROM exams exam
       INNER JOIN exam_termination_runs run ON run.exam_id=exam.id
       INNER JOIN exam_termination_failures failure ON failure.termination_run_id=run.id AND failure.resolved_at IS NULL
       INNER JOIN attempts attempt ON attempt.id=failure.attempt_id AND attempt.exam_id=exam.id
       INNER JOIN students student ON student.id=attempt.student_id
       INNER JOIN exam_roster roster ON roster.exam_id=exam.id AND roster.student_id=student.id
       LEFT JOIN teachers teacher ON teacher.id=failure.last_retried_by_teacher_id
       WHERE exam.exam_code=$1
       ORDER BY failure.last_failed_at DESC,student.student_number`,
      [normalizeExamCode(examCode)],
    );
    return result.rows.map((row: any) => ({
      attemptId: row.attempt_id,
      studentNumber: row.student_number,
      name: row.student_name ?? "",
      attemptNumber: row.attempt_number,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      occurrenceCount: row.occurrence_count,
      firstFailedAt: row.first_failed_at.toISOString(),
      lastFailedAt: row.last_failed_at.toISOString(),
      lastRetriedAt: row.last_retried_at?.toISOString() ?? null,
      lastRetriedBy: row.last_retried_by ?? null,
    }));
  }

  async retryTerminationAttempt({ examCode, attemptId, retriedByLogin, now = new Date() }: any) {
    const failure = await this.#pool.query(
      `SELECT 1
       FROM exams exam
       INNER JOIN exam_termination_runs run ON run.exam_id=exam.id AND run.status IN ('collecting','processing')
       INNER JOIN exam_termination_failures failure ON failure.termination_run_id=run.id
       WHERE exam.exam_code=$1 AND failure.attempt_id=$2 AND failure.resolved_at IS NULL`,
      [normalizeExamCode(examCode), attemptId],
    );
    if (!failure.rows[0]) return null;
    return this.terminateExam({
      examCode,
      terminatedByLogin: retriedByLogin,
      now,
      targetAttemptId: attemptId,
    });
  }

  async requestExamTermination({ examCode, requestedByLogin, now = new Date(), collectionSeconds = 8 }: any) {
    const boundedSeconds = Math.max(3, Math.min(15, Number(collectionSeconds) || 8));
    const normalizedCode = normalizeExamCode(examCode);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        "SELECT id,state,exam_mode FROM exams WHERE exam_code=$1 FOR UPDATE",
        [normalizedCode],
      );
      if (!target.rows[0] || !["published", "active"].includes(target.rows[0].state)
        || target.rows[0].exam_mode === ASSIGNMENT_MODE) {
        await client.query("ROLLBACK");
        return null;
      }
      const existing = await client.query(
        `SELECT run.status,run.collect_until,run.requested_at,teacher.login_name AS requested_by
         FROM exam_termination_runs run
         INNER JOIN teachers teacher ON teacher.id=run.requested_by_teacher_id
         WHERE run.exam_id=$1`,
        [target.rows[0].id],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return {
          requestedAt: existing.rows[0].requested_at.toISOString(),
          requestedBy: existing.rows[0].requested_by,
          collectUntil: existing.rows[0].collect_until.toISOString(),
          status: existing.rows[0].status,
        };
      }
      const teacher = await client.query(
        "INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$2) ON CONFLICT (login_name) DO UPDATE SET login_name=EXCLUDED.login_name RETURNING id",
        [randomUUID(), requestedByLogin],
      );
      const collectUntil = new Date(now.getTime() + boundedSeconds * 1000);
      const pending = await client.query(
        "SELECT COUNT(*)::integer AS count FROM attempts WHERE exam_id=$1 AND status IN ('in_progress','policy_suspended')",
        [target.rows[0].id],
      );
      const collection = {
        requestedAt: now.toISOString(),
        requestedBy: requestedByLogin,
        collectUntil: collectUntil.toISOString(),
        status: "collecting",
      };
      await client.query(
        `INSERT INTO exam_termination_runs (
           id,exam_id,requested_by_teacher_id,status,collect_until,requested_at,target_attempt_count
         ) VALUES ($1,$2,$3,'collecting',$4,$5,$6)`,
        [randomUUID(), target.rows[0].id, teacher.rows[0].id, collectUntil, now, pending.rows[0].count],
      );
      await client.query(
        "UPDATE exams SET settings=jsonb_set(settings,'{terminationCollection}',$2::jsonb),updated_at=$3 WHERE id=$1",
        [target.rows[0].id, JSON.stringify(collection), now],
      );
      await client.query("COMMIT");
      return collection;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async terminateExam({ examCode, terminatedByLogin, now = new Date(), targetAttemptId = null }: any) {
    const normalizedCode = normalizeExamCode(examCode);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        "SELECT id,state,exam_mode,settings->'termination' AS termination FROM exams WHERE exam_code=$1 FOR UPDATE",
        [normalizedCode],
      );
      if (!target.rows[0]) { await client.query("ROLLBACK"); return null; }
      const exam = target.rows[0];
      const readTeacherSubmittedCount = async () => {
        const count = await client.query(
          `SELECT COUNT(*)::integer AS count
           FROM submissions submission
           INNER JOIN attempts attempt ON attempt.id=submission.attempt_id
           WHERE attempt.exam_id=$1 AND submission.submission_type='teacher'`,
          [exam.id],
        );
        return count.rows[0].count as number;
      };
      const termination = exam.termination ?? {
        terminatedAt: now.toISOString(),
        terminatedBy: terminatedByLogin,
      };
      const pending = await client.query(
        "SELECT COUNT(*)::integer AS count FROM attempts WHERE exam_id=$1 AND status IN ('in_progress','policy_suspended')",
        [exam.id],
      );
      if (exam.exam_mode === ASSIGNMENT_MODE) {
        await client.query(
          "UPDATE exams SET state='closed',settings=jsonb_set(settings,'{termination}',$2::jsonb),updated_at=$3 WHERE id=$1",
          [exam.id, JSON.stringify(termination), now],
        );
        await client.query("COMMIT");
        return {
          code: normalizedCode,
          state: "closed",
          termination,
          autoSubmittedCount: 0,
          teacherSubmittedCount: 0,
          failedSubmissionCount: 0,
          pendingSubmissionCount: pending.rows[0].count,
          processedThisBatch: 0,
          completed: true,
        };
      }

      const runResult = await client.query(
        "SELECT * FROM exam_termination_runs WHERE exam_id=$1 FOR UPDATE",
        [exam.id],
      );
      const run = runResult.rows[0];
      if (run?.status === "completed") {
        const teacherSubmittedCount = await readTeacherSubmittedCount();
        await client.query("COMMIT");
        return {
          code: normalizedCode,
          state: "closed",
          termination,
          autoSubmittedCount: run.submitted_count,
          teacherSubmittedCount,
          failedSubmissionCount: run.failed_count,
          pendingSubmissionCount: 0,
          processedThisBatch: 0,
          completed: true,
        };
      }
      if (pending.rows[0].count > 0 && !run) {
        throw attemptError("COLLECTION_NOT_REQUESTED", "Start the room collection window before terminating the exam.");
      }
      if (run && run.collect_until.getTime() > now.getTime()) {
        const error = attemptError("COLLECTION_WINDOW_ACTIVE", "The final answer synchronization window is still active.");
        error.collectUntil = run.collect_until.toISOString();
        throw error;
      }

      const teacher = await client.query(
        "INSERT INTO teachers (id,login_name,display_name) VALUES ($1,$2,$2) ON CONFLICT (login_name) DO UPDATE SET login_name=EXCLUDED.login_name RETURNING id",
        [randomUUID(), terminatedByLogin],
      );
      if (run) {
        await client.query(
          `UPDATE exam_termination_runs
           SET status='processing',processing_started_at=COALESCE(processing_started_at,$2),updated_at=$2
           WHERE id=$1`,
          [run.id, now],
        );
      }
      const candidates = await client.query(
        `SELECT id FROM attempts
         WHERE exam_id=$1 AND status IN ('in_progress','policy_suspended')
           AND ($3::uuid IS NULL OR id=$3::uuid)
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        [exam.id, ROOM_COLLECTION_BATCH_SIZE, targetAttemptId],
      );
      let processedThisBatch = 0;
      let failedThisBatch = 0;
      for (const [index, attempt] of candidates.rows.entries()) {
        const savepoint = `teacher_collection_${index}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const questionRows = await client.query(
          `SELECT attempt.id,attempt.status,attempt.deadline_at,answer.answer_payload,exam.assessment_type_key,
                  qi.id AS question_instance_id,qi.question_key,qi.question_mode,qi.instance_payload,qi.answer_key,qi.scoring_rule
           FROM attempts attempt
           INNER JOIN exams exam ON exam.id=attempt.exam_id
           INNER JOIN question_instances qi ON qi.attempt_id=attempt.id
           INNER JOIN answers answer ON answer.attempt_id=attempt.id
           WHERE attempt.id=$1 AND attempt.status IN ('in_progress','policy_suspended')
           ORDER BY qi.display_order FOR UPDATE OF attempt,answer`,
            [attempt.id],
          );
          if (!questionRows.rows.length) throw attemptError("PAPER_NOT_PREPARED", "Attempt has no prepared questions.", 500);
          if (questionRows.rows[0].status === "policy_suspended") {
            await client.query(
              `UPDATE attempt_policy_suspensions
               SET status='collected',collected_at=$2,collected_by_teacher_id=$3
               WHERE attempt_id=$1 AND status='suspended'`,
              [attempt.id, now, teacher.rows[0].id],
            );
          }
          const submissionType = collectionSubmissionType({
            status: questionRows.rows[0].status,
            deadlineAt: questionRows.rows[0].deadline_at,
          }, now);
          await persistPostgresSubmission(client, questionRows.rows, { submissionType, now });
          if (run) {
            await client.query(
              `UPDATE exam_termination_failures
               SET resolved_at=$3,last_retried_at=$3,last_retried_by_teacher_id=$4
               WHERE termination_run_id=$1 AND attempt_id=$2 AND resolved_at IS NULL`,
              [run.id, attempt.id, now, teacher.rows[0].id],
            );
          }
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          processedThisBatch += 1;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          failedThisBatch += 1;
          if (run) {
            const failure = classifyTerminationFailure(error);
            await client.query(
              `INSERT INTO exam_termination_failures (
                 id,termination_run_id,attempt_id,error_code,error_message,first_failed_at,last_failed_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$6)
               ON CONFLICT (termination_run_id,attempt_id) DO UPDATE
               SET error_code=EXCLUDED.error_code,error_message=EXCLUDED.error_message,
                   occurrence_count=exam_termination_failures.occurrence_count+1,
                   last_failed_at=EXCLUDED.last_failed_at,resolved_at=NULL,
                   last_retried_at=EXCLUDED.last_failed_at,last_retried_by_teacher_id=$7`,
              [randomUUID(), run.id, attempt.id, failure.code, failure.message, now, teacher.rows[0].id],
            );
          }
          const failureCode = error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN";
          console.error("Teacher collection submission failed", { attemptId: attempt.id, code: failureCode });
        }
      }
      const remaining = await client.query(
        "SELECT COUNT(*)::integer AS count FROM attempts WHERE exam_id=$1 AND status IN ('in_progress','policy_suspended')",
        [exam.id],
      );
      const completed = remaining.rows[0].count === 0;
      let submittedCount = processedThisBatch;
      let failedCount = failedThisBatch;
      if (run) {
        const unresolvedFailures = await client.query(
          "SELECT COUNT(*)::integer AS count FROM exam_termination_failures WHERE termination_run_id=$1 AND resolved_at IS NULL",
          [run.id],
        );
        failedCount = unresolvedFailures.rows[0].count;
        const updatedRun = await client.query(
          `UPDATE exam_termination_runs
           SET submitted_count=submitted_count+$2,failed_count=$3,
               status=CASE WHEN $4 THEN 'completed' ELSE 'processing' END,
               completed_at=CASE WHEN $4 THEN $5::timestamptz ELSE NULL::timestamptz END,
               updated_at=$5::timestamptz
           WHERE id=$1 RETURNING submitted_count,failed_count`,
          [run.id, processedThisBatch, failedCount, completed, now],
        );
        submittedCount = updatedRun.rows[0].submitted_count;
        failedCount = updatedRun.rows[0].failed_count;
      }
      if (completed) {
        await client.query(
          `UPDATE exams
           SET state='closed',settings=jsonb_set(settings - 'terminationCollection','{termination}',$2::jsonb),updated_at=$3
           WHERE id=$1`,
          [exam.id, JSON.stringify(termination), now],
        );
      }
      const teacherSubmittedCount = await readTeacherSubmittedCount();
      await client.query("COMMIT");
      return {
        code: normalizedCode,
        state: completed ? "closed" : exam.state,
        termination: completed ? termination : null,
        autoSubmittedCount: submittedCount,
        teacherSubmittedCount,
        failedSubmissionCount: failedCount,
        pendingSubmissionCount: remaining.rows[0].count,
        processedThisBatch,
        completed,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteExam({ examCode }: any) {
    const normalizedCode = normalizeExamCode(examCode);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query("SELECT id,state FROM exams WHERE exam_code=$1 FOR UPDATE", [normalizedCode]);
      if (!target.rows[0]) { await client.query("ROLLBACK"); return null; }
      if (!["draft", "closed", "archived"].includes(target.rows[0].state)) {
        throw attemptError("EXAM_MUST_BE_TERMINATED", "Terminate the exam before deleting it.");
      }
      const attempts = await client.query("SELECT id,status FROM attempts WHERE exam_id=$1 FOR UPDATE", [target.rows[0].id]);
      if (attempts.rows.some((attempt: any) => ["in_progress", "policy_suspended"].includes(attempt.status))) {
        throw attemptError("EXAM_HAS_IN_PROGRESS_ATTEMPTS", "Submit all in-progress attempts before deleting the exam.");
      }
      await client.query(
        `DELETE FROM exam_termination_failures failure
         USING attempts attempt
         WHERE failure.attempt_id=attempt.id AND attempt.exam_id=$1`,
        [target.rows[0].id],
      );
      await client.query("DELETE FROM attempt_retake_authorizations WHERE exam_id=$1", [target.rows[0].id]);
      await client.query(
        `DELETE FROM grade_results grade
         USING submissions submission, attempts attempt
         WHERE grade.submission_id=submission.id
           AND submission.attempt_id=attempt.id
           AND attempt.exam_id=$1`,
        [target.rows[0].id],
      );
      await client.query("UPDATE attempts SET active_session_id=NULL WHERE exam_id=$1", [target.rows[0].id]);
      await client.query("DELETE FROM active_sessions WHERE exam_id=$1", [target.rows[0].id]);
      await client.query("DELETE FROM attempts WHERE exam_id=$1", [target.rows[0].id]);
      await client.query("DELETE FROM admission_approvals WHERE exam_id=$1", [target.rows[0].id]);
      await client.query("DELETE FROM exams WHERE id=$1", [target.rows[0].id]);
      await client.query("COMMIT");
      return { deleted: true, code: normalizedCode };
    } catch (error) {
      await client.query("ROLLBACK");
      const failure = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
      if (failure.code === "55000" && failure.message === "EXAM_HAS_IN_PROGRESS_ATTEMPTS") {
        throw attemptError("EXAM_HAS_IN_PROGRESS_ATTEMPTS", "Submit all in-progress attempts before deleting the exam.");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getAdmissionStatus({ examCode, studentNumber }: any) {
    const result = await this.#pool.query(
      `SELECT exam.exam_code, exam.title_ja, exam.duration_minutes, exam.exam_mode, student.student_number,
              COALESCE(NULLIF(roster.roster_name,''),NULLIF(student.name_native,''),student.name_ja) AS student_name, approval.status,
              attempt.status AS attempt_status, attempt.attempt_number
       FROM exams exam INNER JOIN exam_roster roster ON roster.exam_id=exam.id
       INNER JOIN students student ON student.id=roster.student_id
       LEFT JOIN admission_approvals approval ON approval.exam_id=exam.id AND approval.student_id=student.id
       LEFT JOIN LATERAL (
         SELECT item.status,item.attempt_number FROM attempts item
         WHERE item.exam_id=exam.id AND item.student_id=student.id
         ORDER BY item.attempt_number DESC LIMIT 1
       ) attempt ON TRUE
       WHERE exam.exam_code=$1 AND student.student_number=$2`,
      [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
    );
    const row = result.rows[0];
    if (!row) return null;
    const experience = getStudentExperiencePolicy(row.exam_mode);
    return {
      status: resolveStudentEntryStatus({ attemptStatus: row.attempt_status, approvalStatus: experience.requiresAdmission ? row.status : "approved" }),
      exam: { code: row.exam_code, titleJa: row.title_ja, durationMinutes: row.duration_minutes, mode: row.exam_mode },
      student: { studentNumber: row.student_number, name: row.student_name },
      experience,
    };
  }

  async publishExam({ title, mode, durationMinutes, selectedFunctions, plan, publicationAudit = null, roster = [], createdByLogin, createdByAccountId = null, subjectId = DEFAULT_EXCEL_SUBJECT_ID, assessmentTypeKey = "excel_formula" }: any) {
    if (!publicationAudit?.ok || publicationAudit.status !== "approved") {
      throw attemptError("PUBLICATION_BLOCKED", "Publication audit is not approved.", 422);
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const teacher = await client.query(
        `SELECT teacher.id
         FROM teacher_accounts account
         INNER JOIN teachers teacher ON teacher.id=account.id
         WHERE account.account_status='active'
           AND (($1::uuid IS NOT NULL AND account.id=$1::uuid)
             OR ($1::uuid IS NULL AND lower(btrim(teacher.login_name))=lower(btrim($2))))
         LIMIT 1`,
        [createdByAccountId, createdByLogin],
      );
      if (!teacher.rows[0]) throw attemptError("TEACHER_ACCOUNT_REQUIRED", "An active teacher account is required.", 403);
      const id = randomUUID(); const code = createExamCode(); const duration = normalizeExamDuration(mode, durationMinutes);
      await client.query(
        `INSERT INTO exams (
           id,exam_code,title_ja,title_zh,created_by_teacher_id,state,duration_minutes,exam_mode,
           function_choice_count,formula_question_count,formula_group_count,formula_questions_per_group,settings,
           subject_id,owner_account_id,assessment_type_key
         ) VALUES ($1,$2,$3,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$4,$13)`,
        [id, code, title, teacher.rows[0].id, duration, mode, plan.questionCounts.choice, plan.questionCounts.formula, plan.questionCounts.formulaGroups, FORMULA_QUESTIONS_PER_GROUP, JSON.stringify({ mode, plan, publicationAudit, admissionMode: "roster", paperPreparation: "pending" }), subjectId, assessmentTypeKey],
      );
      const publicationHash = createHash("sha256").update(JSON.stringify(publicationAudit)).digest("hex");
      await client.query(
        `INSERT INTO exam_publication_reviews (
           id,exam_id,audit_version,status,audit_report,content_hash,reviewed_by_teacher_id,reviewed_at
         ) VALUES ($1,$2,$3,'approved',$4::jsonb,$5,$6,$7)`,
        [randomUUID(), id, publicationAudit.version, JSON.stringify(publicationAudit), publicationHash, teacher.rows[0].id, new Date(publicationAudit.auditedAt)],
      );
      if (selectedFunctions.length) {
        const functionParameters: any[] = [];
        const functionGroups = selectedFunctions.map((name: any, index: any) => { functionParameters.push(id, name); return `($${index * 2 + 1},$${index * 2 + 2})`; });
        await client.query(`INSERT INTO exam_function_selections (exam_id,function_name) VALUES ${functionGroups.join(",")}`, functionParameters);
      }
      let rosterValidation: any = { ok: true, studentCount: 0, stages: [] };
      if (roster.length) {
        rosterValidation = await persistExamRoster(client, {
          examId: id,
          roster,
          createId: randomUUID,
        });
      }
      const questionsPerPaper = plannedAssessmentQuestionCount(plan, assessmentTypeKey);
      const plannedQuestionCount = mode === ASSIGNMENT_MODE
        ? questionsPerPaper
        : roster.length * questionsPerPaper;
      await client.query("INSERT INTO exam_preparation_runs (id,exam_id,status,roster_count,planned_question_count,generator_version) VALUES ($1,$2,'pending',$3,$4,'deterministic-v3-bilingual')", [randomUUID(), id, roster.length, plannedQuestionCount]);
      await client.query("COMMIT");
      return {
        code,
        titleJa: title,
        mode,
        durationMinutes: duration,
        rosterCount: roster.length,
        rosterValidation,
        preparationStatus: "pending",
      };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async startAttempt({ examCode, studentNumber, sessionTokenHash, browserPreflight = {} }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE active_sessions SET status='expired' WHERE status='active' AND expires_at<=CURRENT_TIMESTAMP",
      );
      await client.query(
        "SELECT id FROM exams WHERE exam_code=$1 FOR KEY SHARE",
        [normalizeExamCode(examCode)],
      );
      const target = await client.query(
        `
          SELECT a.id AS attempt_id, a.status, a.attempt_number, a.started_at, a.deadline_at,
                 e.id AS exam_id, e.exam_code, e.title_ja, e.duration_minutes, e.exam_mode,
                 s.id AS student_id, s.student_number,
                 COALESCE(NULLIF(roster.roster_name,''),NULLIF(s.name_native,''),s.name_ja) AS student_name
          FROM attempts a
          INNER JOIN exams e ON e.id = a.exam_id
          INNER JOIN students s ON s.id = a.student_id
          INNER JOIN exam_roster roster ON roster.exam_id=e.id AND roster.student_id=s.id
          LEFT JOIN admission_approvals approval ON approval.exam_id = e.id AND approval.student_id = s.id
          WHERE e.exam_code = $1 AND s.student_number = $2
            AND (e.exam_mode = 'assignment' OR approval.status = 'approved')
            AND e.state IN ('published','active')
            AND NOT EXISTS (
              SELECT 1 FROM exam_termination_runs termination
              WHERE termination.exam_id=e.id AND termination.status IN ('collecting','processing','completed')
            )
          ORDER BY a.attempt_number DESC
          LIMIT 1
          FOR UPDATE OF a
        `,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
      );
      const row = target.rows[0];
      if (!row) throw attemptError("NOT_ADMITTED", "Student has not been admitted.", 403);
      if (!["waiting", "in_progress"].includes(row.status)) throw attemptError("ATTEMPT_LOCKED", "Attempt cannot be started.");

      const active = await client.query(
        "SELECT id, attempt_id, session_token_hash, last_seen_at FROM active_sessions WHERE exam_id = $1 AND student_id = $2 AND status = 'active' AND expires_at>CURRENT_TIMESTAMP FOR UPDATE",
        [row.exam_id, row.student_id],
      );
      let automaticRecovery = false;
      const activeBelongsToAnotherAttempt = active.rows[0] && active.rows[0].attempt_id !== row.attempt_id;
      if (active.rows[0] && (activeBelongsToAnotherAttempt || active.rows[0].session_token_hash !== sessionTokenHash)) {
        if (!activeBelongsToAnotherAttempt && row.exam_mode !== ASSIGNMENT_MODE && Date.now() - active.rows[0].last_seen_at.getTime() < AUTOMATIC_RECOVERY_AFTER_MS) throw attemptError("DUPLICATE_SESSION", "Another active session already exists.");
        await client.query("UPDATE active_sessions SET status='revoked' WHERE id=$1", [active.rows[0].id]);
        await client.query("UPDATE attempts SET active_session_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.attempt_id]);
        automaticRecovery = true;
      }

      let activeSessionId = automaticRecovery ? null : active.rows[0]?.id;
      if (!activeSessionId) {
        let recoveryAuthorizationId = null;
        if (row.status === "in_progress" && !automaticRecovery && row.exam_mode !== ASSIGNMENT_MODE) {
          const recovery = await client.query(
            "SELECT id FROM attempt_resume_authorizations WHERE attempt_id=$1 AND status='granted' ORDER BY authorized_at DESC LIMIT 1 FOR UPDATE",
            [row.attempt_id],
          );
          if (!recovery.rows[0]) throw attemptError("RESUME_NOT_AUTHORIZED", "Teacher authorization is required to resume this attempt.", 403);
          recoveryAuthorizationId = recovery.rows[0].id;
        }
        activeSessionId = randomUUID();
        await client.query(
          `INSERT INTO active_sessions (
             id, exam_id, student_id, attempt_id, session_token_hash, status, expires_at
           ) VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP
             + CASE WHEN $6::text = 'exam' THEN INTERVAL '2 hours' ELSE INTERVAL '24 hours' END)`,
          [activeSessionId, row.exam_id, row.student_id, row.attempt_id, sessionTokenHash, row.exam_mode],
        );
        if (row.status === "in_progress") {
          await client.query("UPDATE attempts SET active_session_id=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.attempt_id, activeSessionId]);
          if (recoveryAuthorizationId) await client.query("UPDATE attempt_resume_authorizations SET status='used',used_at=CURRENT_TIMESTAMP WHERE id=$1", [recoveryAuthorizationId]);
        }
      } else {
        await client.query("UPDATE active_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=$1", [activeSessionId]);
      }

      if (row.status === "waiting") {
        const updated = await client.query(
          `UPDATE attempts
           SET status = 'in_progress', started_at = CURRENT_TIMESTAMP,
               deadline_at = CASE WHEN $5::text = 'exam'
                 THEN CURRENT_TIMESTAMP + ($2::integer * INTERVAL '1 minute') ELSE NULL END,
               browser_preflight = $3::jsonb, active_session_id = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING started_at, deadline_at`,
          [row.attempt_id, row.duration_minutes, JSON.stringify(browserPreflight), activeSessionId, row.exam_mode],
        );
        row.status = "in_progress";
        row.started_at = updated.rows[0].started_at;
        row.deadline_at = updated.rows[0].deadline_at;
      }

      await client.query(
        `INSERT INTO question_instances (
           id,attempt_id,question_key,blueprint_version_id,question_mode,display_order,instance_payload,answer_key,scoring_rule
          )
          SELECT gen_random_uuid(),$3,prepared.question_key,prepared.blueprint_version_id,prepared.question_mode,
                 prepared.display_order,prepared.instance_payload,prepared.answer_key,prepared.scoring_rule
          FROM (
            SELECT item.question_key,item.blueprint_version_id,item.question_mode,item.display_order,
                   item.instance_payload,item.answer_key,item.scoring_rule
            FROM prepared_question_instances item
            WHERE item.exam_id=$1 AND item.student_id=$2
              AND ($4::text<>'assignment' OR NOT EXISTS (
                SELECT 1 FROM assignment_shared_question_instances shared WHERE shared.exam_id=$1
              ))
            UNION ALL
            SELECT item.question_key,item.blueprint_version_id,item.question_mode,item.display_order,
                   item.instance_payload,item.answer_key,item.scoring_rule
            FROM assignment_shared_question_instances item
            WHERE $4::text='assignment' AND item.exam_id=$1
          ) prepared
          ORDER BY prepared.display_order
          ON CONFLICT (attempt_id,question_key) DO NOTHING`,
        [row.exam_id, row.student_id, row.attempt_id, row.exam_mode],
      );
      const instances = await client.query("SELECT question_key,question_mode,instance_payload FROM question_instances WHERE attempt_id=$1 ORDER BY display_order", [row.attempt_id]);
      if (!instances.rows.length) throw attemptError("PAPER_NOT_PREPARED", "The student's paper has not been prepared.", 409);
      await client.query(
        "INSERT INTO answers (attempt_id, answer_payload, version) VALUES ($1, '{}'::jsonb, 0) ON CONFLICT (attempt_id) DO NOTHING",
        [row.attempt_id],
      );
      if (row.exam_mode === ASSIGNMENT_MODE) {
        await client.query(
          "UPDATE answers SET answer_payload='{}'::jsonb,version=0,client_saved_at=NULL,server_saved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE attempt_id=$1",
          [row.attempt_id],
        );
      }
      const savedAnswer = await client.query(
        "SELECT answer_payload, version, server_saved_at FROM answers WHERE attempt_id = $1",
        [row.attempt_id],
      );
      await client.query("COMMIT");
      return publicAttempt({
        id: row.attempt_id,
        attemptNumber: row.attempt_number,
        status: row.status,
        startedAt: row.started_at?.toISOString() ?? null,
        deadlineAt: row.deadline_at?.toISOString() ?? null,
        examCode: row.exam_code,
        examMode: row.exam_mode,
        titleJa: row.title_ja,
        studentNumber: row.student_number,
        studentName: row.student_name,
        questions: instances.rows.map((item: any) => ({ key: item.question_key, functionName: item.instance_payload.functionName ?? "SUM", questionMode: item.question_mode, studentPayload: item.instance_payload })),
        answer: publicAnswer({
          questionKey: instances.rows[0].question_key,
          formula: savedAnswer.rows[0].answer_payload[instances.rows[0].question_key] ?? "",
          version: savedAnswer.rows[0].version,
          savedAt: savedAnswer.rows[0].version > 0 ? savedAnswer.rows[0].server_saved_at.toISOString() : null,
        }),
        answers: { values: savedAnswer.rows[0].answer_payload, version: savedAnswer.rows[0].version, savedAt: savedAnswer.rows[0].version > 0 ? savedAnswer.rows[0].server_saved_at.toISOString() : null },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPreparation(examCode: any) {
    const result = await this.#pool.query(
      `SELECT run.status,run.roster_count,run.planned_question_count,run.generated_question_count,run.error_summary
       FROM exam_preparation_runs run INNER JOIN exams exam ON exam.id=run.exam_id WHERE exam.exam_code=$1`,
      [normalizeExamCode(examCode)],
    );
    const row = result.rows[0];
    return row ? preparationView({ status: row.status, rosterCount: row.roster_count, plannedQuestionCount: row.planned_question_count, generatedQuestionCount: row.generated_question_count, errorSummary: row.error_summary }) : null;
  }

  async prepareNextBatch({ examCode, batchSize = 25 }: any) {
    const client = await this.#pool.connect();
    const readView = async (runId: any) => {
      const current = await client.query("SELECT status,roster_count,planned_question_count,generated_question_count,error_summary FROM exam_preparation_runs WHERE id=$1", [runId]);
      const item = current.rows[0];
      return preparationView({ status: item.status, rosterCount: item.roster_count, plannedQuestionCount: item.planned_question_count, generatedQuestionCount: item.generated_question_count, errorSummary: item.error_summary });
    };
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `SELECT exam.id AS exam_id,exam.exam_code,exam.exam_mode,exam.assessment_type_key,exam.settings,run.id AS run_id,run.status,run.roster_count,run.planned_question_count
         FROM exams exam INNER JOIN exam_preparation_runs run ON run.exam_id=exam.id
         WHERE exam.exam_code=$1 FOR UPDATE OF exam,run`,
        [normalizeExamCode(examCode)],
      );
      const row = target.rows[0];
      if (!row) { await client.query("ROLLBACK"); return null; }
      if (["ready", "failed"].includes(row.status)) { const view = await readView(row.run_id); await client.query("COMMIT"); return view; }
      await client.query("UPDATE exam_preparation_runs SET status='generating',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.run_id]);
      let preparationTargets;
      if (row.exam_mode === ASSIGNMENT_MODE) {
        const sharedPaper = await client.query(
          "SELECT 1 FROM assignment_shared_question_instances WHERE exam_id=$1 LIMIT 1",
          [row.exam_id],
        );
        preparationTargets = sharedPaper.rows.length
          ? []
          : [{ id: null, student_number: "SHARED-ASSIGNMENT" }];
      } else {
        const students = await client.query(
          `SELECT student.id,student.student_number FROM exam_roster roster
           INNER JOIN students student ON student.id=roster.student_id
           WHERE roster.exam_id=$1 AND NOT EXISTS (
             SELECT 1 FROM prepared_question_instances prepared WHERE prepared.exam_id=roster.exam_id AND prepared.student_id=roster.student_id
           ) ORDER BY student.student_number LIMIT $2`,
          [row.exam_id, Math.max(1, Math.min(25, batchSize))],
        );
        preparationTargets = students.rows;
      }
      const plan = row.settings.plan;
      const questionsPerPaper = plannedAssessmentQuestionCount(plan, row.assessment_type_key);
      const publicationAudit = row.settings.publicationAudit;
      if (publicationAudit?.status !== "approved" || !Array.isArray(publicationAudit.blueprints)) {
        await client.query(
          "UPDATE exam_preparation_runs SET status='failed',error_summary=$2::jsonb,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1",
          [row.run_id, JSON.stringify({ code: "PUBLICATION_AUDIT_MISSING" })],
        );
        const view = await readView(row.run_id); await client.query("COMMIT"); return view;
      }
      const manifestByKey = new Map<string, any>(publicationAudit.blueprints.map((item: any) => [item.key, item]));
      const generated: any[] = [];
      for (const student of preparationTargets) {
        const preparedPaper = await prepareAssessmentPaper({ assessmentTypeKey: row.assessment_type_key, examCode: row.exam_code, mode: row.exam_mode, plan, participantKey: student.student_number });
        if (!preparedPaper.ok) {
          await client.query("UPDATE exam_preparation_runs SET status='failed',error_summary=$2::jsonb,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.run_id, JSON.stringify({ studentNumber: student.student_number, errors: preparedPaper.errors })]);
          const view = await readView(row.run_id); await client.query("COMMIT"); return view;
        }
        const instances = preparedPaper.value.questions;
        instances.forEach((instance: any, index: any) => generated.push({ ...instance, studentId: student.id, displayOrder: index + 1 }));
      }

      // Every room publishes from the same blueprint catalog. A stable order is
      // required so concurrent upserts and advisory locks cannot form a cycle.
      const uniqueBlueprints = uniqueBlueprintsInLockOrder(generated);
      const versionIds = new Map<string, any>();
      if (uniqueBlueprints.length) {
        const missingManifest: any = uniqueBlueprints.find((instance: any) => {
          const manifest = manifestByKey.get(instance.blueprintKey);
          return !manifest || manifest.reviewStatus !== "approved" || !/^[0-9a-f]{64}$/.test(manifest.contentHash ?? "");
        });
        if (missingManifest) {
          await client.query(
            "UPDATE exam_preparation_runs SET status='failed',error_summary=$2::jsonb,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1",
            [row.run_id, JSON.stringify({ code: "UNREVIEWED_BLUEPRINT", blueprintKey: missingManifest.blueprintKey })],
          );
          const view = await readView(row.run_id); await client.query("COMMIT"); return view;
        }
        const blueprintParameters: any[] = [];
        const blueprintGroups = uniqueBlueprints.map((instance: any, index: any) => {
          const manifest = manifestByKey.get(instance.blueprintKey);
          const values = [randomUUID(), instance.blueprintKey, row.assessment_type_key === MANUAL_ASSESSMENT_TYPE_KEY ? "Teacher-authored question" : `${instance.functionName} generic`, instance.questionMode, publicationAudit.auditedAt, JSON.stringify({ auditVersion: publicationAudit.version, contentHash: manifest.contentHash })];
          blueprintParameters.push(...values); const base = index * values.length;
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 3},$${base + 4},'generated','active','approved',$${base + 5},$${base + 6}::jsonb)`;
        });
        await client.query(
          `INSERT INTO question_blueprints (id,blueprint_key,title_ja,title_zh,question_mode,scenario_key,status,review_status,reviewed_at,review_metadata)
           VALUES ${blueprintGroups.join(",")} ON CONFLICT (blueprint_key) DO NOTHING`,
          blueprintParameters,
        );
        await client.query(
          `UPDATE question_blueprints
           SET status='active',review_status='approved',updated_at=CURRENT_TIMESTAMP
           WHERE blueprint_key=ANY($1::text[]) AND (status<>'active' OR review_status<>'approved')`,
          [uniqueBlueprints.map((instance: any) => instance.blueprintKey)],
        );
        const blueprints = await client.query(
          "SELECT id,blueprint_key FROM question_blueprints WHERE blueprint_key=ANY($1::text[])",
          [uniqueBlueprints.map((instance: any) => instance.blueprintKey)],
        );
        const blueprintByKey = new Map<string, any>(blueprints.rows.map((item: any) => [item.blueprint_key, item.id]));
        const versionParameters: any[] = [];
        const versionGroups = uniqueBlueprints.map((instance: any, index: any) => {
          const manifest = manifestByKey.get(instance.blueprintKey);
          const values = [
            randomUUID(),
            blueprintByKey.get(instance.blueprintKey),
            JSON.stringify({ generator: row.assessment_type_key === MANUAL_ASSESSMENT_TYPE_KEY ? "teacher-authored-v1" : "business-v4-bilingual", scenario: instance.studentPayload.scenario?.key ?? null }),
            JSON.stringify(instance.scoringRule),
            JSON.stringify(row.assessment_type_key === MANUAL_ASSESSMENT_TYPE_KEY ? { format: "markdown" } : { languages: ["ja", "en"], tableLanguage: "en" }),
            JSON.stringify(instance.scoringRule.requiredFunctions ?? [instance.functionName]),
            manifest.contentHash,
            publicationAudit.auditedAt,
          ];
          versionParameters.push(...values);
          const base = index * values.length;
          return `($${base + 1}::uuid,$${base + 2}::uuid,$${base + 3}::jsonb,$${base + 4}::jsonb,$${base + 5}::jsonb,$${base + 6}::jsonb,$${base + 7}::text,$${base + 8}::timestamptz)`;
        });
        await client.query(
          `WITH input (id,blueprint_id,generation_rule,scoring_rule,student_copy,supported_functions,content_hash,reviewed_at) AS (
             VALUES ${versionGroups.join(",")}
           )
           INSERT INTO blueprint_versions (
             id,blueprint_id,version_number,generation_rule,scoring_rule,student_copy,supported_functions,content_hash,review_status,reviewed_at
           )
           SELECT input.id,input.blueprint_id,
                  COALESCE((SELECT MAX(existing.version_number) FROM blueprint_versions existing WHERE existing.blueprint_id=input.blueprint_id),0)+1,
                  input.generation_rule,input.scoring_rule,input.student_copy,input.supported_functions,input.content_hash,'approved',input.reviewed_at
           FROM input
           ON CONFLICT DO NOTHING`,
          versionParameters,
        );
        const versions = await client.query(
          `SELECT version.id,version.blueprint_id,version.content_hash
           FROM blueprint_versions version
           WHERE version.blueprint_id=ANY($1::uuid[]) AND version.content_hash=ANY($2::text[])`,
          [
            [...blueprintByKey.values()],
            uniqueBlueprints.map((instance: any) => manifestByKey.get(instance.blueprintKey).contentHash),
          ],
        );
        const versionByPair = new Map<string, any>(versions.rows.map((version: any) => [`${version.blueprint_id}:${version.content_hash}`, version.id]));
        for (const instance of uniqueBlueprints) {
          const blueprintId = blueprintByKey.get(instance.blueprintKey);
          const contentHash = manifestByKey.get(instance.blueprintKey).contentHash;
          const versionId = versionByPair.get(`${blueprintId}:${contentHash}`);
          if (!versionId) throw new Error(`BLUEPRINT_VERSION_NOT_AVAILABLE:${instance.blueprintKey}`);
          versionIds.set(instance.blueprintKey, versionId);
        }
      }

      if (generated.length && row.exam_mode === ASSIGNMENT_MODE) {
        for (const generatedChunk of chunkRowsForPostgres(generated, { parametersPerRow: 10 })) {
          const parameters: any[] = []; const groups = generatedChunk.map((instance: any, index: any) => {
            const payload = { ...instance.studentPayload, functionName: instance.functionName };
            const hash = createHash("sha256").update(JSON.stringify([payload, instance.answerKey, instance.scoringRule])).digest("hex");
            const values = [randomUUID(), row.exam_id, instance.key, versionIds.get(instance.blueprintKey), instance.questionMode, instance.displayOrder, JSON.stringify(payload), JSON.stringify(instance.answerKey), JSON.stringify(instance.scoringRule), hash];
            parameters.push(...values); const base = index * values.length; return `(${values.map((_: any, offset: any) => `$${base + offset + 1}`).join(",")})`;
          });
          await client.query(
            `INSERT INTO assignment_shared_question_instances (id,exam_id,question_key,blueprint_version_id,question_mode,display_order,instance_payload,answer_key,scoring_rule,content_hash)
             VALUES ${groups.join(",")} ON CONFLICT (exam_id,question_key) DO NOTHING`,
            parameters,
          );
        }
      } else if (generated.length) {
        for (const generatedChunk of chunkRowsForPostgres(generated, { parametersPerRow: 11 })) {
          const parameters: any[] = []; const groups = generatedChunk.map((instance: any, index: any) => {
            const payload = { ...instance.studentPayload, functionName: instance.functionName };
            const hash = createHash("sha256").update(JSON.stringify([payload, instance.answerKey, instance.scoringRule])).digest("hex");
            const values = [randomUUID(), row.exam_id, instance.studentId, instance.key, versionIds.get(instance.blueprintKey), instance.questionMode, instance.displayOrder, JSON.stringify(payload), JSON.stringify(instance.answerKey), JSON.stringify(instance.scoringRule), hash];
            parameters.push(...values); const base = index * values.length; return `(${values.map((_: any, offset: any) => `$${base + offset + 1}`).join(",")})`;
          });
          await client.query(
            `INSERT INTO prepared_question_instances (id,exam_id,student_id,question_key,blueprint_version_id,question_mode,display_order,instance_payload,answer_key,scoring_rule,content_hash)
             VALUES ${groups.join(",")} ON CONFLICT (exam_id,student_id,question_key) DO NOTHING`,
            parameters,
          );
        }
      }

      const count = await client.query(
        row.exam_mode === ASSIGNMENT_MODE
          ? "SELECT COUNT(*)::integer AS generated FROM assignment_shared_question_instances WHERE exam_id=$1"
          : "SELECT COUNT(*)::integer AS generated FROM prepared_question_instances WHERE exam_id=$1",
        [row.exam_id],
      );
      const generatedCount = count.rows[0].generated;
      if (generatedCount === row.planned_question_count) {
        const invalid = row.exam_mode === ASSIGNMENT_MODE
          ? await client.query(
              `SELECT CASE WHEN COUNT(*)=$2 AND COUNT(DISTINCT display_order)=$2 THEN 0 ELSE 1 END::integer AS count
               FROM assignment_shared_question_instances WHERE exam_id=$1`,
              [row.exam_id, questionsPerPaper],
            )
          : await client.query(
              `SELECT COUNT(*)::integer AS count FROM (
                 SELECT student_id,COUNT(*) AS questions,COUNT(DISTINCT display_order) AS positions
                 FROM prepared_question_instances WHERE exam_id=$1 GROUP BY student_id
                 HAVING COUNT(*)<>$2 OR COUNT(DISTINCT display_order)<>$2
               ) broken`,
              [row.exam_id, questionsPerPaper],
            );
        if (invalid.rows[0].count === 0) {
          await client.query("UPDATE exam_preparation_runs SET status='ready',generated_question_count=$2,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.run_id, generatedCount]);
          await client.query("UPDATE exams SET state='active',published_at=CURRENT_TIMESTAMP,settings=jsonb_set(settings,'{paperPreparation}','\"ready\"'::jsonb),updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.exam_id]);
        }
      } else {
        await client.query("UPDATE exam_preparation_runs SET generated_question_count=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.run_id, generatedCount]);
      }
      const view = await readView(row.run_id); await client.query("COMMIT"); return view;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async getAttempt({ examCode, studentNumber, sessionTokenHash }: any) {
    const result = await this.#pool.query(
      `SELECT a.id, a.status, a.attempt_number, a.started_at, a.deadline_at, e.exam_code, e.title_ja, e.exam_mode,
              s.student_number,COALESCE(NULLIF(roster.roster_name,''),NULLIF(s.name_native,''),s.name_ja) AS student_name,
              qi.question_key, qi.question_mode, qi.instance_payload,
              answer.answer_payload, answer.version, answer.server_saved_at,
              submission.submission_type, submission.submitted_at, submission.grading_status,
              grade.awarded_score, grade.maximum_score
       FROM active_sessions session
       INNER JOIN attempts a ON a.id = session.attempt_id
       INNER JOIN exams e ON e.id = a.exam_id
       INNER JOIN students s ON s.id = a.student_id
       INNER JOIN exam_roster roster ON roster.exam_id=e.id AND roster.student_id=s.id
       INNER JOIN question_instances qi ON qi.attempt_id = a.id
       LEFT JOIN answers answer ON answer.attempt_id = a.id
       LEFT JOIN submissions submission ON submission.attempt_id = a.id
       LEFT JOIN grade_results grade ON grade.submission_id = submission.id AND grade.question_instance_id = qi.id
        WHERE session.session_token_hash = $1 AND session.status = 'active' AND session.expires_at>CURRENT_TIMESTAMP
         AND e.exam_code = $2 AND s.student_number = $3
       ORDER BY qi.display_order`,
      [sessionTokenHash, normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
    );
    const row = result.rows[0];
    if (!row) return null;
    return publicAttempt({
      id: row.id,
      attemptNumber: row.attempt_number,
      status: row.status,
      startedAt: row.started_at?.toISOString() ?? null,
      deadlineAt: row.deadline_at?.toISOString() ?? null,
      examCode: row.exam_code,
      examMode: row.exam_mode,
      titleJa: row.title_ja,
      studentNumber: row.student_number,
      studentName: row.student_name,
      questions: result.rows.map((item: any) => ({ key: item.question_key, functionName: item.instance_payload.functionName ?? "SUM", questionMode: item.question_mode, studentPayload: item.instance_payload })),
      answer: publicAnswer({
        questionKey: row.question_key,
        formula: typeof row.answer_payload?.[row.question_key] === "string" ? row.answer_payload[row.question_key] : "",
        version: row.version ?? 0,
        savedAt: row.version > 0 ? row.server_saved_at.toISOString() : null,
      }),
      answers: { values: row.answer_payload ?? {}, version: row.version ?? 0, savedAt: row.version > 0 ? row.server_saved_at.toISOString() : null },
      submission: row.submission_type ? {
        type: row.submission_type,
        submittedAt: row.submitted_at.toISOString(),
        status: "received",
      } : null,
    });
  }

  async saveAnswer({ examCode, studentNumber, sessionTokenHash, questionKey, formula, answerValue = formula, expectedVersion, clientSavedAt = null }: any) {
    const result = await this.#pool.query(
      `UPDATE answers answer
       SET answer_payload = answer.answer_payload || jsonb_build_object($5::text, $6::jsonb), version = version + 1,
           client_saved_at = $7::timestamptz, server_saved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       FROM attempts attempt
       INNER JOIN exams exam ON exam.id = attempt.exam_id
       INNER JOIN students student ON student.id = attempt.student_id
       INNER JOIN active_sessions session ON session.id = attempt.active_session_id
       WHERE answer.attempt_id = attempt.id AND exam.exam_code = $1 AND student.student_number = $2
          AND session.session_token_hash = $3 AND session.status = 'active' AND session.expires_at>CURRENT_TIMESTAMP
          AND exam.exam_mode = 'exam'
          AND attempt.status = 'in_progress' AND attempt.deadline_at > CURRENT_TIMESTAMP
          AND NOT EXISTS (
            SELECT 1 FROM exam_termination_runs termination
            WHERE termination.exam_id=exam.id
              AND termination.status IN ('collecting','processing')
              AND termination.collect_until<=CURRENT_TIMESTAMP
          )
         AND answer.version = $4
         AND EXISTS (SELECT 1 FROM question_instances qi WHERE qi.attempt_id = attempt.id AND qi.question_key = $5)
       RETURNING answer.version, answer.server_saved_at`,
      [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber,
        sessionTokenHash, expectedVersion, questionKey, JSON.stringify(answerValue), clientSavedAt],
    );
    if (!result.rows[0]) {
      const state = await this.#pool.query(
         `SELECT attempt.status, attempt.deadline_at, answer.version, exam.exam_mode,
                 termination.status AS termination_status,termination.collect_until
          FROM attempts attempt
         INNER JOIN exams exam ON exam.id = attempt.exam_id
         INNER JOIN students student ON student.id = attempt.student_id
          INNER JOIN active_sessions session ON session.id = attempt.active_session_id
          LEFT JOIN exam_termination_runs termination ON termination.exam_id=exam.id
            AND termination.status IN ('collecting','processing')
          LEFT JOIN answers answer ON answer.attempt_id = attempt.id
          WHERE exam.exam_code = $1 AND student.student_number = $2 AND session.session_token_hash = $3
            AND session.status = 'active' AND session.expires_at>CURRENT_TIMESTAMP`,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber, sessionTokenHash],
      );
      const row = state.rows[0];
      if (!row) throw attemptError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
      if (row.exam_mode === ASSIGNMENT_MODE) throw attemptError("AUTOSAVE_DISABLED", "Classroom assignment answers are submitted only at the end.");
      if (["collecting", "processing"].includes(row.termination_status)
        && row.collect_until?.getTime() <= Date.now()) {
        throw attemptError("ROOM_COLLECTION_ACTIVE", "The room is collecting final answers.");
      }
      if (row.status !== "in_progress") throw attemptError("ATTEMPT_LOCKED", "Attempt is no longer editable.");
      if (row.deadline_at && row.deadline_at.getTime() <= Date.now()) throw attemptError("DEADLINE_EXPIRED", "The deadline has passed.");
      if (row.version !== expectedVersion) throw attemptError("VERSION_CONFLICT", "Answer version conflict.");
      throw attemptError("QUESTION_NOT_FOUND", "Question not found.", 404);
    }
    return {
      ...publicAnswer({ questionKey, formula: typeof answerValue === "string" ? answerValue : "", version: result.rows[0].version, savedAt: result.rows[0].server_saved_at.toISOString() }),
      value: structuredClone(answerValue),
    };
  }

  async submitAttempt({
    examCode,
    studentNumber,
    sessionTokenHash,
    answers = null,
    submissionType = null,
    now = new Date(),
    manualConfirmationVerified = false,
  }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `SELECT attempt.id, attempt.status, attempt.attempt_number, attempt.started_at, attempt.deadline_at, answer.answer_payload,
                 exam.exam_mode,exam.assessment_type_key, session.status AS session_status,session.expires_at AS session_expires_at,
                 termination.status AS termination_status,termination.collect_until,
                qi.id AS question_instance_id, qi.question_key, qi.question_mode, qi.instance_payload, qi.answer_key, qi.scoring_rule
         FROM attempts attempt
         INNER JOIN exams exam ON exam.id = attempt.exam_id
         INNER JOIN students student ON student.id = attempt.student_id
          INNER JOIN active_sessions session ON session.id = attempt.active_session_id
          LEFT JOIN exam_termination_runs termination ON termination.exam_id=exam.id
            AND termination.status IN ('collecting','processing')
         INNER JOIN question_instances qi ON qi.attempt_id = attempt.id
         LEFT JOIN answers answer ON answer.attempt_id = attempt.id
         WHERE exam.exam_code = $1 AND student.student_number = $2
           AND session.session_token_hash = $3
         ORDER BY qi.display_order FOR UPDATE OF attempt`,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber, sessionTokenHash],
      );
      const targetRows = selectLatestSessionAttemptRows(target.rows);
      const row = targetRows[0];
      if (!row) {
        const event = await client.query("SELECT id FROM exams WHERE exam_code=$1", [normalizeExamCode(examCode)]);
        if (!event.rows[0]) throw attemptError("EXAM_EVENT_UNAVAILABLE", "Exam event is no longer available.", 410);
        const attempt = await client.query(
          `SELECT attempt.id
           FROM attempts attempt
           INNER JOIN exams exam ON exam.id=attempt.exam_id
           INNER JOIN students student ON student.id=attempt.student_id
           INNER JOIN active_sessions session ON session.id=attempt.active_session_id
           WHERE exam.exam_code=$1 AND student.student_number=$2 AND session.session_token_hash=$3`,
          [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber, sessionTokenHash],
        );
        if (attempt.rows[0]) throw attemptError("PAPER_NOT_PREPARED", "Attempt has no prepared questions.", 409);
        throw attemptError("ATTEMPT_SESSION_EXPIRED", "Answer session is no longer active.", 409);
      }
      const existing = await client.query(
        `SELECT submission_type, submitted_at, grading_status,
                COALESCE(SUM(grade.awarded_score), 0) AS total_score,
                COALESCE(SUM(grade.maximum_score), 0) AS maximum_score,
                COUNT(*) FILTER (WHERE grade.result_status = 'correct')::integer AS correct_count,
                COUNT(grade.id)::integer AS question_count
         FROM submissions submission LEFT JOIN grade_results grade ON grade.submission_id = submission.id
         WHERE submission.attempt_id = $1
         GROUP BY submission.id`,
        [row.id],
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        const saved = existing.rows[0];
        const submission = { type: saved.submission_type, submittedAt: saved.submitted_at.toISOString(), status: "received" };
        if (row.exam_mode !== ASSIGNMENT_MODE) return submission;
        return {
          ...submission,
          score: Number(saved.total_score),
          maximumScore: Number(saved.maximum_score),
          correctCount: saved.correct_count,
          questionCount: saved.question_count,
          attemptNumber: row.attempt_number,
          attemptsRemaining: Math.max(0, getStudentExperiencePolicy(ASSIGNMENT_MODE).maximumAttempts! - row.attempt_number),
        };
      }
      if (row.session_status !== "active" || row.session_expires_at.getTime() <= now.getTime()) throw attemptError("ATTEMPT_SESSION_EXPIRED", "Answer session is no longer active.", 409);
      if (row.status !== "in_progress") throw attemptError("ATTEMPT_LOCKED", "Attempt cannot be submitted.");
      if (row.exam_mode !== ASSIGNMENT_MODE
        && ["collecting", "processing"].includes(row.termination_status)
        && row.collect_until?.getTime() <= now.getTime()) {
        throw attemptError("ROOM_COLLECTION_ACTIVE", "The room is collecting final answers.");
      }
      if (row.exam_mode === ASSIGNMENT_MODE && answers) {
        const questionKeys = new Set(targetRows.map((item: any) => item.question_key));
        if (Object.keys(answers).some((questionKey: any) => !questionKeys.has(questionKey))) {
          throw attemptError("QUESTION_NOT_FOUND", "Submission contains an unknown question.", 422);
        }
        await client.query(
          "UPDATE answers SET answer_payload=$2::jsonb,version=version+1,client_saved_at=NULL,server_saved_at=$3,updated_at=$3 WHERE attempt_id=$1",
          [row.id, JSON.stringify(answers), now],
        );
        for (const item of targetRows) item.answer_payload = answers;
      }
      const type = submissionType ?? (row.deadline_at && row.deadline_at.getTime() <= now.getTime() ? "timer" : "manual");
      requireDeliberateFormalSubmission({
        examMode: row.exam_mode,
        submissionType: type,
        startedAt: row.started_at,
        answerPayload: row.answer_payload,
        manualConfirmationVerified,
        now,
      });
      const submission = await persistPostgresSubmission(client, targetRows, {
        submissionType: type,
        now,
        revealScore: row.exam_mode === ASSIGNMENT_MODE,
        attemptNumber: row.attempt_number,
      });
      await client.query("COMMIT");
      return submission;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async submitExpiredAttempts({ examCode = null, now = new Date(), limit = 100 }: any = {}) {
    const boundedLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
    const normalizedExamCode = examCode ? normalizeExamCode(examCode) : null;
    const client = await this.#pool.connect();
    let submittedCount = 0;
    let failedCount = 0;
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE active_sessions SET status='expired' WHERE status='active' AND expires_at<=$1",
        [now],
      );
      const candidates = await client.query(
        `SELECT attempt.id
         FROM attempts attempt
         INNER JOIN exams exam ON exam.id = attempt.exam_id
         WHERE attempt.status = 'in_progress' AND attempt.deadline_at <= $1
           AND ($3::text IS NULL OR exam.exam_code = $3)
         ORDER BY attempt.deadline_at, attempt.id
         FOR UPDATE SKIP LOCKED
         LIMIT $2`,
        [now, boundedLimit, normalizedExamCode],
      );
      for (const [index, candidate] of candidates.rows.entries()) {
        const savepoint = `expired_attempt_${index}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const target = await client.query(
            `SELECT attempt.id, attempt.status, attempt.deadline_at, answer.answer_payload,exam.assessment_type_key,
                    qi.id AS question_instance_id, qi.question_key, qi.question_mode, qi.instance_payload, qi.answer_key, qi.scoring_rule
             FROM attempts attempt
             INNER JOIN exams exam ON exam.id=attempt.exam_id
             INNER JOIN question_instances qi ON qi.attempt_id = attempt.id
             LEFT JOIN answers answer ON answer.attempt_id = attempt.id
             WHERE attempt.id = $1 AND attempt.status = 'in_progress'
             ORDER BY qi.display_order`,
            [candidate.id],
          );
          await persistPostgresSubmission(client, target.rows, { submissionType: "timer", now });
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          submittedCount += 1;
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          failedCount += 1;
          const failureCode = error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN";
          console.error("Expired attempt submission failed", { attemptId: candidate.id, code: failureCode });
        }
      }
      await client.query("COMMIT");
      return { scannedCount: candidates.rows.length, submittedCount, failedCount };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordProctorEvent({ examCode, studentNumber, sessionTokenHash, eventType, now = new Date() }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `SELECT attempt.id,attempt.deadline_at,exam.exam_mode
         FROM attempts attempt
         INNER JOIN exams exam ON exam.id=attempt.exam_id
         INNER JOIN students student ON student.id=attempt.student_id
         INNER JOIN active_sessions session ON session.id=attempt.active_session_id
         WHERE exam.exam_code=$1 AND student.student_number=$2 AND session.session_token_hash=$3
           AND session.status='active' AND session.expires_at>CURRENT_TIMESTAMP AND attempt.status='in_progress'
           AND NOT EXISTS (
             SELECT 1 FROM exam_termination_runs termination
             WHERE termination.exam_id=exam.id AND termination.status IN ('collecting','processing')
           )
         FOR UPDATE OF attempt`,
        [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber, sessionTokenHash],
      );
      const row = target.rows[0];
      if (!row) {
        const mode = await client.query("SELECT exam_mode FROM exams WHERE exam_code=$1", [normalizeExamCode(examCode)]);
        if (mode.rows[0]?.exam_mode === ASSIGNMENT_MODE) throw attemptError("PROCTORING_DISABLED", "Proctoring is disabled for classroom assignments.");
        throw attemptError("ATTEMPT_NOT_FOUND", "Active attempt not found.", 404);
      }
      if (row.exam_mode === ASSIGNMENT_MODE) throw attemptError("PROCTORING_DISABLED", "Proctoring is disabled for classroom assignments.");
      const eventId = randomUUID();
      const recorded = await client.query(
        "INSERT INTO proctor_events (id,attempt_id,event_type,occurred_at) VALUES ($1,$2,$3,$4) RETURNING occurred_at",
        [eventId, row.id, eventType, now],
      );
      const count = await client.query("SELECT COUNT(*)::integer AS count FROM proctor_events WHERE attempt_id=$1", [row.id]);
      const signal = normalizeBrowserIntegritySignal({ eventType, observedAt: recorded.rows[0].occurred_at.toISOString() });
      if (!signal.ok) throw attemptError("INVALID_PROCTOR_EVENT", "Invalid browser integrity event.", 422);
      const decision = browserThreeStrikeIntegrityPolicy.evaluate({
        mode: row.exam_mode,
        state: { violationCount: Math.max(0, count.rows[0].count - 1), suspended: false },
        signal: signal.value,
      });
      let suspension = null;
      if (decision.actions.includes("suspend")) {
        const remainingSeconds = row.deadline_at
          ? Math.max(0, Math.floor((row.deadline_at.getTime() - now.getTime()) / 1000))
          : 0;
        const suspensionId = randomUUID();
        await client.query("UPDATE attempts SET status='policy_suspended',updated_at=$2 WHERE id=$1", [row.id, now]);
        await client.query(
          `INSERT INTO attempt_policy_suspensions (id,attempt_id,trigger_event_id,remaining_seconds,suspended_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [suspensionId, row.id, eventId, remainingSeconds, now],
        );
        suspension = { id: suspensionId, suspendedAt: now.toISOString(), remainingSeconds, status: "suspended" };
      }
      await client.query("COMMIT");
      return { violationCount: decision.state.violationCount, limit: PROCTOR_VIOLATION_LIMIT, occurredAt: recorded.rows[0].occurred_at.toISOString(), suspension, auditEvent: decision.auditEvent };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listResults(examCode: any) {
    const exam = await this.#pool.query("SELECT id FROM exams WHERE exam_code = $1", [normalizeExamCode(examCode)]);
    if (!exam.rows[0]) return null;
    const result = await this.#pool.query(
       `SELECT student.student_number,
               COALESCE(NULLIF(roster.roster_name, ''), NULLIF(student.name_native, ''), student.name_ja) AS student_name,
               COALESCE(latest_attempt.status, 'not_started') AS attempt_status, submission.submitted_at,submission.grading_status,
               COALESCE(attempts.attempt_count,0)::integer AS attempt_count,
                grade_totals.score, grade_totals.maximum_score, COALESCE(grade_totals.adjusted, FALSE) AS adjusted,
                highest_grade.score AS highest_score,highest_grade.maximum_score AS highest_maximum_score,
                question_totals.choice_correct,question_totals.choice_total,question_totals.formula_correct,question_totals.formula_total,
                question_totals.question_results,COALESCE(warnings.warning_count,0)::integer AS warning_count,
                COALESCE(forced.policy_submission_count,0)::integer AS policy_submission_count,
                COALESCE(suspensions.policy_suspension_count,0)::integer AS policy_suspension_count,
                COALESCE(forced.forced_submission_count,0)::integer AS forced_submission_count,
                COALESCE(warnings.warning_events,'[]'::jsonb) AS warning_events,
                COALESCE(suspensions.policy_suspensions,'[]'::jsonb) AS policy_suspensions,
                COALESCE(forced.forced_submission_events,'[]'::jsonb) AS forced_submission_events
       FROM exam_roster roster
       INNER JOIN students student ON student.id = roster.student_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::integer AS attempt_count FROM attempts item
         WHERE item.exam_id=roster.exam_id AND item.student_id=roster.student_id
       ) attempts ON TRUE
       LEFT JOIN LATERAL (
         SELECT item.* FROM attempts item WHERE item.exam_id=roster.exam_id AND item.student_id=roster.student_id
         ORDER BY item.attempt_number DESC LIMIT 1
       ) latest_attempt ON TRUE
       LEFT JOIN LATERAL (
         SELECT item.* FROM attempts item
         WHERE item.exam_id=roster.exam_id AND item.student_id=roster.student_id
           AND EXISTS (SELECT 1 FROM submissions saved WHERE saved.attempt_id=item.id)
         ORDER BY item.attempt_number DESC LIMIT 1
       ) attempt ON TRUE
        LEFT JOIN submissions submission ON submission.attempt_id = attempt.id
        LEFT JOIN LATERAL (
          SELECT COUNT(event.id)::integer AS warning_count,
                 COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                   'attemptNumber',item.attempt_number,
                   'eventType',event.event_type,
                  'occurredAt',event.occurred_at
                 ) ORDER BY item.attempt_number,event.occurred_at) FILTER (WHERE event.id IS NOT NULL),'[]'::jsonb) AS warning_events
          FROM attempts item
          LEFT JOIN proctor_events event ON event.attempt_id=item.id
          WHERE item.exam_id=roster.exam_id AND item.student_id=roster.student_id
        ) warnings ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(suspension.id)::integer AS policy_suspension_count,
                 COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                   'attemptNumber',item.attempt_number,
                   'suspendedAt',suspension.suspended_at,
                    'remainingSeconds',suspension.remaining_seconds,
                    'resumedAt',suspension.resumed_at,
                    'resumedBy',resumed_teacher.login_name,
                    'collectedAt',suspension.collected_at,
                    'collectedBy',collected_teacher.login_name,
                    'status',suspension.status
                 ) ORDER BY item.attempt_number,suspension.suspended_at) FILTER (WHERE suspension.id IS NOT NULL),'[]'::jsonb) AS policy_suspensions
          FROM attempts item
          LEFT JOIN attempt_policy_suspensions suspension ON suspension.attempt_id=item.id
          LEFT JOIN teachers resumed_teacher ON resumed_teacher.id=suspension.resumed_by_teacher_id
          LEFT JOIN teachers collected_teacher ON collected_teacher.id=suspension.collected_by_teacher_id
          WHERE item.exam_id=roster.exam_id AND item.student_id=roster.student_id
        ) suspensions ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(saved.id)::integer AS forced_submission_count,
                 COUNT(saved.id) FILTER (WHERE saved.submission_type='policy')::integer AS policy_submission_count,
                 COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                   'attemptNumber',item.attempt_number,
                   'submissionType',saved.submission_type,
                   'submittedAt',saved.submitted_at
                 ) ORDER BY item.attempt_number,saved.submitted_at) FILTER (WHERE saved.id IS NOT NULL),'[]'::jsonb) AS forced_submission_events
          FROM attempts item
          LEFT JOIN submissions saved ON saved.attempt_id=item.id AND saved.submission_type IN ('policy','teacher')
          WHERE item.exam_id=roster.exam_id AND item.student_id=roster.student_id
        ) forced ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(COALESCE(latest.new_score, grade.awarded_score)) AS score,
                SUM(grade.maximum_score) AS maximum_score,
                BOOL_OR(latest.id IS NOT NULL) AS adjusted
         FROM grade_results grade
         LEFT JOIN LATERAL (
           SELECT item.id, item.new_score FROM teacher_adjustments item
           WHERE item.grade_result_id = grade.id ORDER BY item.created_at DESC LIMIT 1
         ) latest ON TRUE
         WHERE grade.submission_id = submission.id
        ) grade_totals ON TRUE
        LEFT JOIN LATERAL (
          SELECT scored.score,scored.maximum_score
          FROM (
            SELECT saved.id,saved.submitted_at,
                   SUM(COALESCE(adjustment.new_score,grade.awarded_score)) AS score,
                   SUM(grade.maximum_score) AS maximum_score
            FROM attempts history
            INNER JOIN submissions saved ON saved.attempt_id=history.id
            INNER JOIN grade_results grade ON grade.submission_id=saved.id
            LEFT JOIN LATERAL (
              SELECT item.new_score FROM teacher_adjustments item
              WHERE item.grade_result_id=grade.id ORDER BY item.created_at DESC LIMIT 1
            ) adjustment ON TRUE
            WHERE history.exam_id=roster.exam_id AND history.student_id=roster.student_id
            GROUP BY saved.id,saved.submitted_at
          ) scored
          ORDER BY scored.score DESC,scored.submitted_at DESC LIMIT 1
        ) highest_grade ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE question.question_mode='choice' AND grade.result_status='correct')::integer AS choice_correct,
                COUNT(*) FILTER (WHERE question.question_mode='choice' AND grade.id IS NOT NULL)::integer AS choice_total,
                COUNT(*) FILTER (WHERE question.question_mode='formula' AND grade.result_status='correct')::integer AS formula_correct,
                COUNT(*) FILTER (WHERE question.question_mode='formula' AND grade.id IS NOT NULL)::integer AS formula_total,
                COALESCE(
                  JSONB_AGG(
                    JSONB_BUILD_OBJECT(
                      'questionKey', question.question_key,
                      'resultStatus', COALESCE(grade.result_status, 'unanswered')
                    ) ORDER BY question.display_order
                  ) FILTER (WHERE question.id IS NOT NULL),
                  '[]'::jsonb
                ) AS question_results
         FROM question_instances question
         LEFT JOIN grade_results grade ON grade.question_instance_id=question.id AND grade.submission_id=submission.id
         WHERE question.attempt_id=attempt.id
       ) question_totals ON TRUE
       WHERE roster.exam_id = $1 AND roster.enrollment_status = 'eligible'
       ORDER BY student.student_number`,
      [exam.rows[0].id],
    );
    return result.rows.map((row: any) => ({
      studentNumber: row.student_number,
      name: row.student_name,
      attemptStatus: row.attempt_status,
      attemptCount: row.attempt_count,
      submittedAt: row.submitted_at?.toISOString() ?? null,
      gradingStatus: row.grading_status ?? null,
      score: row.score === null ? null : Number(row.score),
      maximumScore: row.maximum_score === null ? null : Number(row.maximum_score),
      highestScore: row.highest_score === null ? null : Number(row.highest_score),
      highestMaximumScore: row.highest_maximum_score === null ? null : Number(row.highest_maximum_score),
      adjusted: row.adjusted,
      choiceCorrect: row.choice_correct, choiceTotal: row.choice_total,
      formulaCorrect: row.formula_correct, formulaTotal: row.formula_total,
      warningCount: row.warning_count,
      policySubmissionCount: row.policy_submission_count,
      policySuspensionCount: row.policy_suspension_count,
      forcedSubmissionCount: row.forced_submission_count,
      warningEvents: row.warning_events ?? [],
      policySuspensions: row.policy_suspensions ?? [],
      forcedSubmissionEvents: row.forced_submission_events ?? [],
      questionResults: row.question_results ?? [],
    }));
  }

  async getResult({ examCode, studentNumber }: any) {
    const result = await this.#pool.query(
      `SELECT student.student_number,
              COALESCE(NULLIF(roster.roster_name, ''), NULLIF(student.name_native, ''), student.name_ja) AS student_name,
              attempt.status, submission.submitted_at, question.question_key,
              question.question_mode, question.instance_payload, submission.final_answer_payload -> question.question_key AS answer,
              grade.id AS grade_result_id, grade.awarded_score AS automatic_score, grade.maximum_score,
              grade.result_status, grade.explanation, adjustment.new_score, adjustment.previous_score, adjustment.reason,
              adjustment.created_at AS adjusted_at, teacher.login_name AS adjusted_by
       FROM exams exam
       INNER JOIN attempts attempt ON attempt.exam_id = exam.id
       INNER JOIN students student ON student.id = attempt.student_id
       INNER JOIN exam_roster roster ON roster.exam_id=exam.id AND roster.student_id=student.id
       INNER JOIN submissions submission ON submission.attempt_id = attempt.id
       INNER JOIN question_instances question ON question.attempt_id = attempt.id
       INNER JOIN grade_results grade ON grade.submission_id = submission.id AND grade.question_instance_id = question.id
       LEFT JOIN LATERAL (
         SELECT item.* FROM teacher_adjustments item WHERE item.grade_result_id = grade.id
         ORDER BY item.created_at DESC LIMIT 1
       ) adjustment ON TRUE
       LEFT JOIN teachers teacher ON teacher.id = adjustment.adjusted_by_teacher_id
       WHERE exam.exam_code = $1 AND student.student_number = $2
          AND attempt.attempt_number=(
            SELECT MAX(item.attempt_number) FROM attempts item
            WHERE item.exam_id=attempt.exam_id AND item.student_id=attempt.student_id
              AND EXISTS (SELECT 1 FROM submissions saved WHERE saved.attempt_id=item.id)
          )
       ORDER BY question.display_order`,
      [normalizeExamCode(examCode), normalizeStudentIdentity({ studentNumber }).studentNumber],
    );
    if (!result.rows[0]) return null;
    const first = result.rows[0];
    return {
      student: { studentNumber: first.student_number, name: first.student_name },
      attempt: { status: first.status, submittedAt: first.submitted_at.toISOString() },
      questions: result.rows.map((row: any) => {
        const answer = row.answer ?? "";
        return {
          gradeResultId: row.grade_result_id,
          questionKey: row.question_key,
          questionMode: row.question_mode,
          prompt: row.instance_payload ?? {},
          answer,
          formula: typeof answer === "string" ? answer : "",
          referenceAnswer: row.explanation?.referenceAnswer ?? null,
          awardedScore: Number(row.new_score ?? row.automatic_score),
          automaticScore: Number(row.automatic_score),
          maximumScore: Number(row.maximum_score),
          resultStatus: row.result_status,
          adjustment: row.new_score === null ? null : { previousScore: Number(row.previous_score), newScore: Number(row.new_score), reason: row.reason, adjustedBy: row.adjusted_by, adjustedAt: row.adjusted_at.toISOString() },
        };
      }),
    };
  }

  async adjustGrade({ gradeResultId, newScore, reason, adjustedByLogin }: any) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO teacher_adjustments (
           id, grade_result_id, adjusted_by_teacher_id, previous_score, new_score, reason
         )
         SELECT $1, grade.id, teacher.id, COALESCE(latest.new_score, grade.awarded_score), $2::numeric, $3
         FROM grade_results grade
         INNER JOIN teachers teacher ON teacher.login_name = $4
         LEFT JOIN LATERAL (
           SELECT adjustment.new_score FROM teacher_adjustments adjustment
           WHERE adjustment.grade_result_id = grade.id ORDER BY adjustment.created_at DESC LIMIT 1
         ) latest ON TRUE
         WHERE grade.id = $5 AND $2::numeric >= 0 AND $2::numeric <= grade.maximum_score
         RETURNING grade_result_id, previous_score, new_score, reason, created_at`,
        [randomUUID(), newScore, reason, adjustedByLogin, gradeResultId],
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE submissions submission
         SET grading_status = 'graded', graded_at = CURRENT_TIMESTAMP
         WHERE submission.id = (
           SELECT grade.submission_id FROM grade_results grade WHERE grade.id = $1
         )
           AND submission.grading_status = 'review_required'
           AND NOT EXISTS (
             SELECT 1
             FROM grade_results review_grade
             WHERE review_grade.submission_id = submission.id
               AND review_grade.result_status = 'review_required'
               AND NOT EXISTS (
                 SELECT 1 FROM teacher_adjustments adjustment
                 WHERE adjustment.grade_result_id = review_grade.id
               )
           )`,
        [result.rows[0].grade_result_id],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return { previousScore: Number(row.previous_score), newScore: Number(row.new_score), reason: row.reason, adjustedBy: adjustedByLogin, adjustedAt: row.created_at.toISOString() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.#pool.end();
  }
}

export function createStudentExamRepository({ connectionString, capacityPolicy }: any = {}): StudentExamRepository {
  if (!connectionString) return new InMemoryStudentExamRepository();
  const normalizedCapacityPolicy = normalizeCapacityPolicy(capacityPolicy);
  return new PostgresStudentExamRepository({
    connectionString,
    databasePoolMax: normalizedCapacityPolicy.databasePoolMax,
  });
}
