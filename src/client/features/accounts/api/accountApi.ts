import {
  accountMembershipBatchBodySchema,
  accountPageSchema,
  accountPasswordBodySchema,
  accountResponseSchema,
  accountRoleBodySchema,
  accountStatusBodySchema,
  createAccountBodySchema,
  managedSubjectListResponseSchema,
  type AccountPage,
  type ManagedAccount,
  type ManagedSubject,
} from "../../../../types/contracts/account-administration.ts";
import { requestJson } from "../../../shared/api/httpClient.ts";
import type { AccountActionInput, CreateAccountInput } from "../types.ts";

export function fetchAccountPage(page: number, pageSize: number): Promise<AccountPage> {
  const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return requestJson(`/api/admin/accounts?${search}`, {}, accountPageSchema);
}

export async function fetchManagedSubjects(): Promise<ManagedSubject[]> {
  const response = await requestJson("/api/admin/subjects", {}, managedSubjectListResponseSchema);
  return response.subjects;
}

export async function createManagedAccount(input: CreateAccountInput): Promise<ManagedAccount> {
  const { csrfToken, ...candidate } = input;
  const body = createAccountBodySchema.parse(candidate);
  const response = await requestJson("/api/admin/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  }, accountResponseSchema);
  return response.account;
}

export async function mutateManagedAccount(input: AccountActionInput): Promise<ManagedAccount> {
  const { accountId, action, csrfToken, ...candidate } = input;
  const suffix = action === "membership" ? "memberships/batch" : action === "password" ? "reset-password" : action;
  const body = action === "membership"
    ? accountMembershipBatchBodySchema.parse(candidate)
    : action === "password"
      ? accountPasswordBodySchema.parse(candidate)
      : action === "role"
        ? accountRoleBodySchema.parse(candidate)
        : accountStatusBodySchema.parse(candidate);
  const response = await requestJson(`/api/admin/accounts/${encodeURIComponent(accountId)}/${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
  }, accountResponseSchema);
  return response.account;
}
