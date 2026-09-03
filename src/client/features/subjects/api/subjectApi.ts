import {
  createSubjectBodySchema,
  managedSubjectListResponseSchema,
  managedSubjectResponseSchema,
  subjectSettingsBodySchema,
  subjectStatusBodySchema,
  type CreateSubjectBody,
  type ManagedSubject,
  type SubjectSettingsBody,
  type SubjectStatusBody,
} from "../../../../types/contracts/account-administration.ts";
import { requestJson } from "../../../shared/api/httpClient.ts";

export async function fetchSubjectCatalog(): Promise<ManagedSubject[]> {
  const response = await requestJson("/api/admin/subjects/catalog", {}, managedSubjectListResponseSchema);
  return response.subjects;
}

export async function createSubject(input: CreateSubjectBody & { csrfToken: string }): Promise<ManagedSubject> {
  const { csrfToken, ...candidate } = input;
  const body = createSubjectBodySchema.parse(candidate);
  const response = await requestJson("/api/admin/subjects", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  }, managedSubjectResponseSchema);
  return response.subject;
}

export async function updateSubject(input: SubjectSettingsBody & { csrfToken: string; subjectId: string }): Promise<ManagedSubject> {
  const { csrfToken, subjectId, ...candidate } = input;
  const body = subjectSettingsBodySchema.parse(candidate);
  const response = await requestJson(`/api/admin/subjects/${encodeURIComponent(subjectId)}/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  }, managedSubjectResponseSchema);
  return response.subject;
}

export async function updateSubjectStatus(input: SubjectStatusBody & { csrfToken: string; subjectId: string }): Promise<ManagedSubject> {
  const { csrfToken, subjectId, ...candidate } = input;
  const body = subjectStatusBodySchema.parse(candidate);
  const response = await requestJson(`/api/admin/subjects/${encodeURIComponent(subjectId)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  }, managedSubjectResponseSchema);
  return response.subject;
}
