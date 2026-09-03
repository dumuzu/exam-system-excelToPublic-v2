import {
  adminSessionSchema,
  loginCredentialsSchema,
  loginResponseSchema,
  type AdminSession,
  type LoginCredentials,
  type LoginResponse,
} from "../../../../types/contracts/admin-auth.ts";
import { requestJson, requestNoContent } from "../../../shared/api/httpClient.ts";

export function fetchAdminSession(): Promise<AdminSession> {
  return requestJson("/api/admin/session", {}, adminSessionSchema);
}

export function loginAdmin(credentials: LoginCredentials): Promise<LoginResponse> {
  const body = loginCredentialsSchema.parse(credentials);
  return requestJson("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, loginResponseSchema);
}

export function logoutAdmin(csrfToken: string): Promise<void> {
  return requestNoContent("/api/admin/logout", {
    method: "POST",
    headers: { "x-csrf-token": csrfToken },
  });
}
