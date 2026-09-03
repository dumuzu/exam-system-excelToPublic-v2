const MAX_STUDENT_NUMBER_LENGTH = 32;
const MAX_STUDENT_NAME_LENGTH = 100;

function normaliseText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * Student numbers stay strings so that leading zeroes remain meaningful.
 * Unicode normalisation makes full-width digits and spaces match the roster
 * without making identity matching fuzzy or language-dependent.
 */
export interface StudentIdentityInput {
  readonly studentNumber?: unknown;
  readonly name?: unknown;
}

export interface NormalizedStudentIdentity {
  readonly studentNumber: string;
  readonly name: string;
}

export function normalizeStudentIdentity({ studentNumber, name }: StudentIdentityInput = {}): NormalizedStudentIdentity {
  return {
    studentNumber: normaliseText(studentNumber),
    name: normaliseText(name),
  };
}

export function validateStudentIdentity(candidate: StudentIdentityInput) {
  const value = normalizeStudentIdentity(candidate);
  const valid = value.studentNumber.length > 0
    && value.studentNumber.length <= MAX_STUDENT_NUMBER_LENGTH
    && value.name.length > 0
    && value.name.length <= MAX_STUDENT_NAME_LENGTH;

  return valid ? { valid: true, value } : { valid: false };
}

export function validateStudentNumber(candidate: StudentIdentityInput) {
  const studentNumber = normalizeStudentIdentity(candidate).studentNumber;
  return studentNumber.length > 0 && studentNumber.length <= MAX_STUDENT_NUMBER_LENGTH
    ? { valid: true, value: { studentNumber } }
    : { valid: false };
}

export function normalizeExamCode(value: unknown): string {
  return normaliseText(value).toUpperCase();
}

export function validateExamCode(value: unknown) {
  const examCode = normalizeExamCode(value);
  return examCode.length > 0 && examCode.length <= 50
    ? { valid: true, value: examCode }
    : { valid: false };
}
