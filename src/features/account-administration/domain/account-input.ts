import {
  accountMembershipBatchBodySchema,
  accountMembershipBodySchema,
  accountPasswordBodySchema,
  accountRoleBodySchema,
  accountStatusBodySchema,
  createAccountBodySchema,
  createSubjectBodySchema,
  subjectStatusBodySchema,
  subjectSettingsBodySchema,
  type AccountMembershipBatchBody,
  type AccountMembershipBody,
  type AccountPasswordBody,
  type AccountRoleBody,
  type AccountStatusBody,
  type CreateAccountBody,
  type CreateSubjectBody,
  type ManagedPlatformRole,
  type ManagedSubjectRole,
  type SubjectSettingsBody,
  type SubjectStatusBody,
} from "../../../types/contracts/account-administration.ts";

export type ManagedAccountStatus = AccountStatusBody["status"];
export type { ManagedPlatformRole, ManagedSubjectRole };

export interface AccountPageInput {
  readonly page: number;
  readonly pageSize: number;
}

export type AccountCreationInput = CreateAccountBody;

export function validateAccountPage(requestUrl: URL): AccountPageInput | null {
  const pageInput = requestUrl.searchParams.get("page") ?? "1";
  const pageSizeInput = requestUrl.searchParams.get("pageSize") ?? "20";
  if (!/^\d{1,9}$/.test(pageInput) || !/^\d{1,3}$/.test(pageSizeInput)) return null;
  const page = Number.parseInt(pageInput, 10);
  const pageSize = Number.parseInt(pageSizeInput, 10);
  return Number.isInteger(page) && page >= 1 && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50
    ? { page, pageSize }
    : null;
}

export function decodeManagedAccountId(encodedId: string | undefined): string | null {
  try {
    const accountId = decodeURIComponent(encodedId ?? "");
    return accountId.length >= 1
      && accountId.length <= 100
      && !/[\\/\u0000-\u001f\u007f]/.test(accountId)
      ? accountId
      : null;
  } catch {
    return null;
  }
}

export const decodeManagedSubjectId = decodeManagedAccountId;

function parsedOrNull<Value>(result: { success: true; data: Value } | { success: false }): Value | null {
  return result.success ? result.data : null;
}

// 共享 Zod 契约负责白名单字段、归一化与长度检查；接口仍以 null 表示 422。
export function validateAccountCreation(value: unknown): AccountCreationInput | null {
  return parsedOrNull(createAccountBodySchema.safeParse(value));
}

export function validateAccountStatusMutation(value: unknown): Readonly<AccountStatusBody> | null {
  return parsedOrNull(accountStatusBodySchema.safeParse(value));
}

export function validateAccountRoleMutation(value: unknown): Readonly<AccountRoleBody> | null {
  return parsedOrNull(accountRoleBodySchema.safeParse(value));
}

export function validateAccountPasswordMutation(value: unknown): Readonly<AccountPasswordBody> | null {
  return parsedOrNull(accountPasswordBodySchema.safeParse(value));
}

export function validateAccountMembershipMutation(value: unknown): Readonly<AccountMembershipBody> | null {
  return parsedOrNull(accountMembershipBodySchema.safeParse(value));
}

export function validateAccountMembershipBatchMutation(value: unknown): Readonly<AccountMembershipBatchBody> | null {
  return parsedOrNull(accountMembershipBatchBodySchema.safeParse(value));
}

export function validateSubjectSettingsMutation(value: unknown): Readonly<SubjectSettingsBody> | null {
  return parsedOrNull(subjectSettingsBodySchema.safeParse(value));
}

export function validateSubjectCreation(value: unknown): Readonly<CreateSubjectBody> | null {
  return parsedOrNull(createSubjectBodySchema.safeParse(value));
}

export function validateSubjectStatusMutation(value: unknown): Readonly<SubjectStatusBody> | null {
  return parsedOrNull(subjectStatusBodySchema.safeParse(value));
}
