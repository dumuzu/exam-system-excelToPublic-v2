import type {
  AssessmentEventMode,
  ContractError,
  PaperPreparationScope,
  Result,
  StudentWorkspaceCapabilities,
} from "../platform/assessment-contracts.ts";

export interface AssessmentWorkspaceCapabilities extends StudentWorkspaceCapabilities {
  readonly mode: AssessmentEventMode;
  readonly requiresAdmission: boolean;
  readonly requiresFullscreen: boolean;
  readonly hasTimeLimit: boolean;
  readonly proctoringEnabled: boolean;
  readonly autosaveEnabled: boolean;
  readonly sharedPaper: boolean;
  readonly randomizeQuestionOrder: boolean;
  readonly revealScoreAfterSubmission: boolean;
  readonly maximumAttempts: number | null;
}

export interface AssessmentAdapterDescriptor {
  readonly key: string;
  readonly version: number;
  readonly supportedModes: readonly AssessmentEventMode[];
  readonly compatibleIntegrityPolicyIds: readonly string[];
}

export interface AssessmentAuthoringInput {
  readonly mode: AssessmentEventMode;
  readonly input: unknown;
}

export interface AssessmentPaperPreparationInput<Configuration> {
  readonly eventId: string;
  readonly mode: AssessmentEventMode;
  readonly seed: string;
  readonly scope: PaperPreparationScope;
  readonly configuration: Configuration;
}

export interface AssessmentStudentViewInput<Paper> {
  readonly mode: AssessmentEventMode;
  readonly paper: Paper;
}

export interface AssessmentResponseValidationInput<Paper> {
  readonly mode: AssessmentEventMode;
  readonly paper: Paper;
  readonly input: unknown;
}

export interface AssessmentGradingInput<Paper, Response> {
  readonly mode: AssessmentEventMode;
  readonly paper: Paper;
  readonly response: Response;
}

export interface AssessmentTypeAdapter<Configuration, Paper, StudentView, Response, Grade> {
  readonly descriptor: AssessmentAdapterDescriptor;
  getStudentWorkspaceCapabilities(mode: AssessmentEventMode): AssessmentWorkspaceCapabilities;
  validateAuthoring(input: AssessmentAuthoringInput): Result<Configuration>;
  preparePaper(input: AssessmentPaperPreparationInput<Configuration>): Promise<Result<Paper>>;
  createStudentView(input: AssessmentStudentViewInput<Paper>): StudentView;
  validateResponse(input: AssessmentResponseValidationInput<Paper>): Result<Response>;
  gradeResponse(input: AssessmentGradingInput<Paper, Response>): Promise<Grade> | Grade;
}

export interface PreparedAssessmentRun<StudentView, Response, Grade> {
  readonly assessmentTypeKey: string;
  readonly mode: AssessmentEventMode;
  readonly studentView: StudentView;
  readonly workspace: AssessmentWorkspaceCapabilities;
  evaluate(input: unknown): Promise<Result<{ response: Response; grade: Grade }>>;
}

export interface AssessmentKernelPreparationInput {
  readonly assessmentTypeKey: string;
  readonly eventId: string;
  readonly mode: AssessmentEventMode;
  readonly seed: string;
  readonly scope: PaperPreparationScope;
  readonly authoring: unknown;
}

// 注册表只暴露 unknown；各科目适配器必须先校验，才能使用自己的试卷与答案类型。
type UnknownAssessmentAdapter = AssessmentTypeAdapter<any, any, any, any, any>;

function failure(code: string, message: string, details?: Readonly<Record<string, unknown>>): Result<never> {
  const error: ContractError = details === undefined ? { code, message } : { code, message, details };
  return { ok: false, errors: [error] };
}

function validDescriptor(descriptor: AssessmentAdapterDescriptor): boolean {
  return /^[a-z][a-z0-9_]{1,63}$/.test(descriptor.key)
    && Number.isInteger(descriptor.version)
    && descriptor.version > 0
    && descriptor.supportedModes.length > 0
    && descriptor.supportedModes.every((mode) => mode === "exam" || mode === "assignment")
    && descriptor.compatibleIntegrityPolicyIds.every((id) => /^[a-z][a-z0-9_]{1,63}$/.test(id));
}

export function createAssessmentKernel(adapters: readonly UnknownAssessmentAdapter[]) {
  const adaptersByKey = new Map<string, UnknownAssessmentAdapter>();
  for (const adapter of adapters) {
    if (!validDescriptor(adapter.descriptor)) throw new TypeError("INVALID_ASSESSMENT_ADAPTER_DESCRIPTOR");
    if (adaptersByKey.has(adapter.descriptor.key)) throw new TypeError("DUPLICATE_ASSESSMENT_TYPE");
    adaptersByKey.set(adapter.descriptor.key, adapter);
  }

  return Object.freeze({
    descriptors(): AssessmentAdapterDescriptor[] {
      return [...adaptersByKey.values()].map((adapter) => ({
        ...adapter.descriptor,
        supportedModes: [...adapter.descriptor.supportedModes],
        compatibleIntegrityPolicyIds: [...adapter.descriptor.compatibleIntegrityPolicyIds],
      }));
    },

    async prepare(input: AssessmentKernelPreparationInput): Promise<Result<PreparedAssessmentRun<unknown, unknown, unknown>>> {
      const adapter = adaptersByKey.get(input.assessmentTypeKey);
      if (!adapter) {
        return failure("UNKNOWN_ASSESSMENT_TYPE", "The requested assessment type is not registered.", {
          assessmentTypeKey: input.assessmentTypeKey,
        });
      }
      if (!adapter.descriptor.supportedModes.includes(input.mode)) {
        return failure("UNSUPPORTED_ASSESSMENT_MODE", "The assessment type does not support this event mode.", {
          assessmentTypeKey: input.assessmentTypeKey,
          mode: input.mode,
        });
      }

      const configuration = adapter.validateAuthoring({ mode: input.mode, input: input.authoring });
      if (!configuration.ok) return configuration;
      const preparedPaper = await adapter.preparePaper({
        eventId: input.eventId,
        mode: input.mode,
        seed: input.seed,
        scope: input.scope,
        configuration: configuration.value,
      });
      if (!preparedPaper.ok) return preparedPaper;

      const paper = preparedPaper.value;
      const studentView = adapter.createStudentView({ mode: input.mode, paper });
      const workspace = adapter.getStudentWorkspaceCapabilities(input.mode);
      return {
        ok: true,
        value: {
          assessmentTypeKey: adapter.descriptor.key,
          mode: input.mode,
          studentView,
          workspace,
          async evaluate(responseInput: unknown) {
            const response = adapter.validateResponse({ mode: input.mode, paper, input: responseInput });
            if (!response.ok) return response;
            const grade = await adapter.gradeResponse({ mode: input.mode, paper, response: response.value });
            return { ok: true, value: { response: response.value, grade } };
          },
        },
      };
    },
  });
}
