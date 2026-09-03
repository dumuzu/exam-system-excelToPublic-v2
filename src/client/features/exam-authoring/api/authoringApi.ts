import {
  authoringConfigurationBodySchema,
  authoringConfigurationListResponseSchema,
  authoringConfigurationResponseSchema,
  authoringFunctionListResponseSchema,
  authoringModeListResponseSchema,
  authoringPreviewBodySchema,
  authoringPreviewResponseSchema,
  preparationResponseSchema,
  preparationStepBodySchema,
  publishAssessmentBodySchema,
  publishAssessmentResponseSchema,
  type AuthoringConfiguration,
  type AuthoringConfigurationBody,
  type AuthoringFunction,
  type AuthoringModeDefinition,
  type AuthoringPreviewBody,
  type AuthoringPreviewResponse,
  type Preparation,
  type PublishedAssessment,
  type PublishAssessmentBody,
} from "../../../../types/contracts/exam-authoring.ts";
import type { ManagedAssessmentTypeKey } from "../../../../types/contracts/account-administration.ts";
import { requestJson } from "../../../shared/api/httpClient.ts";

interface SubjectRequest {
  subjectId: string;
}

interface AssessmentSubjectRequest extends SubjectRequest {
  assessmentTypeKey: ManagedAssessmentTypeKey;
}

interface ProtectedSubjectRequest extends AssessmentSubjectRequest {
  csrfToken: string;
}

export interface PreviewAssessmentInput extends AssessmentSubjectRequest {
  body: AuthoringPreviewBody;
}

export interface SaveConfigurationInput extends ProtectedSubjectRequest {
  body: AuthoringConfigurationBody;
}

export interface UseConfigurationInput extends ProtectedSubjectRequest {
  configurationId: string;
}

export interface PublishAssessmentInput extends ProtectedSubjectRequest {
  body: PublishAssessmentBody;
}

export interface PreparationRequest extends SubjectRequest {
  csrfToken: string;
  examCode: string;
}

function subjectHeaders(subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey, csrfToken?: string): HeadersInit {
  return {
    "x-subject-id": subjectId,
    "x-assessment-type-key": assessmentTypeKey,
    ...(csrfToken === undefined ? {} : { "x-csrf-token": csrfToken }),
  };
}

export async function fetchAuthoringFunctions(subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey): Promise<AuthoringFunction[]> {
  const response = await requestJson("/api/admin/functions", {
    headers: subjectHeaders(subjectId, assessmentTypeKey),
  }, authoringFunctionListResponseSchema);
  return response.functions;
}

export async function fetchAuthoringModes(subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey): Promise<AuthoringModeDefinition[]> {
  const response = await requestJson("/api/admin/exam-modes", {
    headers: subjectHeaders(subjectId, assessmentTypeKey),
  }, authoringModeListResponseSchema);
  return response.modes;
}

export async function fetchAuthoringConfigurations(subjectId: string, assessmentTypeKey: ManagedAssessmentTypeKey): Promise<AuthoringConfiguration[]> {
  const response = await requestJson("/api/admin/exam-configurations", {
    headers: subjectHeaders(subjectId, assessmentTypeKey),
  }, authoringConfigurationListResponseSchema);
  return response.configurations;
}

export function previewAssessment({ assessmentTypeKey, body, subjectId }: PreviewAssessmentInput): Promise<AuthoringPreviewResponse> {
  const payload = authoringPreviewBodySchema.parse(body);
  return requestJson("/api/admin/exam-preview", {
    method: "POST",
    headers: { "content-type": "application/json", ...subjectHeaders(subjectId, assessmentTypeKey) },
    body: JSON.stringify(payload),
  }, authoringPreviewResponseSchema);
}

export async function saveAuthoringConfiguration({
  body,
  assessmentTypeKey,
  csrfToken,
  subjectId,
}: SaveConfigurationInput): Promise<AuthoringConfiguration> {
  const payload = authoringConfigurationBodySchema.parse(body);
  const response = await requestJson("/api/admin/exam-configurations", {
    method: "POST",
    headers: { "content-type": "application/json", ...subjectHeaders(subjectId, assessmentTypeKey, csrfToken) },
    body: JSON.stringify(payload),
  }, authoringConfigurationResponseSchema);
  return response.configuration;
}

export async function useAuthoringConfiguration({
  configurationId,
  assessmentTypeKey,
  csrfToken,
  subjectId,
}: UseConfigurationInput): Promise<AuthoringConfiguration> {
  const response = await requestJson(
    `/api/admin/exam-configurations/${encodeURIComponent(configurationId)}/use`,
    {
      method: "POST",
      headers: subjectHeaders(subjectId, assessmentTypeKey, csrfToken),
    },
    authoringConfigurationResponseSchema,
  );
  return response.configuration;
}

export async function publishAssessment({
  body,
  assessmentTypeKey,
  csrfToken,
  subjectId,
}: PublishAssessmentInput): Promise<PublishedAssessment> {
  const payload = publishAssessmentBodySchema.parse(body);
  const response = await requestJson("/api/admin/exams", {
    method: "POST",
    headers: { "content-type": "application/json", ...subjectHeaders(subjectId, assessmentTypeKey, csrfToken) },
    body: JSON.stringify(payload),
  }, publishAssessmentResponseSchema);
  return response.exam;
}

export async function fetchAssessmentPreparation(subjectId: string, examCode: string): Promise<Preparation> {
  const response = await requestJson(
    `/api/admin/exams/${encodeURIComponent(examCode)}/preparation`,
    { headers: { "x-subject-id": subjectId } },
    preparationResponseSchema,
  );
  return response.preparation;
}

export async function prepareAssessmentBatch({
  csrfToken,
  examCode,
  subjectId,
}: PreparationRequest): Promise<Preparation> {
  const payload = preparationStepBodySchema.parse({ batchSize: 25 });
  const response = await requestJson(
    `/api/admin/exams/${encodeURIComponent(examCode)}/preparation/step`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-subject-id": subjectId, "x-csrf-token": csrfToken },
      body: JSON.stringify(payload),
    },
    preparationResponseSchema,
  );
  return response.preparation;
}
