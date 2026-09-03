import type { AssessmentTypeAdapter } from "../src/core/assessment-kernel.ts";
import { BROWSER_THREE_STRIKE_POLICY_ID } from "../src/core/integrity-policy.ts";

interface TextConfiguration {
  readonly prompt: string;
  readonly expected: string;
}

interface TextPaper extends TextConfiguration {
  readonly id: string;
}

interface TextStudentView {
  readonly id: string;
  readonly prompt: string;
}

interface TextGrade {
  readonly awardedScore: number;
  readonly maximumScore: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const textAssessmentAdapter: AssessmentTypeAdapter<
  TextConfiguration,
  TextPaper,
  TextStudentView,
  string,
  TextGrade
> = {
  descriptor: {
    key: "short_text",
    version: 1,
    supportedModes: ["exam", "assignment"],
    compatibleIntegrityPolicyIds: [BROWSER_THREE_STRIKE_POLICY_ID],
  },

  getStudentWorkspaceCapabilities(mode) {
    const formal = mode === "exam";
    return {
      mode,
      responseKind: "short_text",
      automaticGrading: true,
      requiresAdmission: formal,
      requiresFullscreen: formal,
      hasTimeLimit: formal,
      proctoringEnabled: formal,
      autosaveEnabled: formal,
      sharedPaper: !formal,
      randomizeQuestionOrder: false,
      revealScoreAfterSubmission: !formal,
      maximumAttempts: formal ? null : 2,
    };
  },

  validateAuthoring({ input }) {
    return isRecord(input)
      && typeof input["prompt"] === "string"
      && typeof input["expected"] === "string"
      ? { ok: true, value: { prompt: input["prompt"], expected: input["expected"] } }
      : { ok: false, errors: [{ code: "INVALID_TEXT_CONFIGURATION", message: "Prompt and expected answer are required." }] };
  },

  async preparePaper({ eventId, configuration }) {
    return { ok: true, value: { id: `${eventId}-question`, ...configuration } };
  },

  createStudentView({ paper }) {
    return { id: paper.id, prompt: paper.prompt };
  },

  validateResponse({ input }) {
    return typeof input === "string" && input.length <= 200
      ? { ok: true, value: input.normalize("NFKC").trim() }
      : { ok: false, errors: [{ code: "INVALID_TEXT_RESPONSE", message: "A short text response is required." }] };
  },

  gradeResponse({ paper, response }) {
    return {
      awardedScore: response.toLocaleLowerCase("en-US") === paper.expected.toLocaleLowerCase("en-US") ? 1 : 0,
      maximumScore: 1,
    };
  },
};
