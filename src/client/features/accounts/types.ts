import type {
  AccountMembershipBatchBody,
  AccountPasswordBody,
  AccountRoleBody,
  AccountStatusBody,
  CreateAccountBody,
} from "../../../types/contracts/account-administration.ts";

// CSRF 与目标标识属于客户端命令上下文，不混入共享 HTTP body 契约。
export type CreateAccountInput = CreateAccountBody & { csrfToken: string };
export type AccountActionInput =
  | ({ action: "status"; accountId: string; csrfToken: string } & AccountStatusBody)
  | ({ action: "role"; accountId: string; csrfToken: string } & AccountRoleBody)
  | ({ action: "password"; accountId: string; csrfToken: string } & AccountPasswordBody)
  | ({ action: "membership"; accountId: string; csrfToken: string } & AccountMembershipBatchBody);
export type AccountActionKind = AccountActionInput["action"];
