import type { ZodType } from "zod";

import { apiErrorResponseSchema } from "../../../types/contracts/http.ts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly payload: unknown;

  constructor(message: string, status: number, code: string | null, payload: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  return response.headers.get("content-type")?.includes("application/json")
    ? response.json()
    : null;
}

function requestError(body: unknown, status: number): ApiRequestError {
  const parsed = apiErrorResponseSchema.safeParse(body);
  const payload = parsed.success ? parsed.data : {};
  const firstIssue = payload.errors?.[0];
  return new ApiRequestError(
    payload.error ?? firstIssue?.message ?? "Request failed.",
    status,
    payload.code ?? firstIssue?.code ?? null,
    body,
  );
}

// 所有 React 功能切片通过这一接口消费 HTTP，统一凭据、错误与运行时解码。
export async function requestJson<ResponseBody>(
  path: string,
  init: RequestInit,
  schema: ZodType<ResponseBody>,
): Promise<ResponseBody> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = await readResponseBody(response);
  if (!response.ok) throw requestError(body, response.status);
  return schema.parse(body);
}

export async function requestNoContent(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.ok) return;
  throw requestError(await readResponseBody(response), response.status);
}
