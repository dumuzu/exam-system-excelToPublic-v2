import { studentIdentitySchema, studentVerificationResponseSchema } from "../../../types/contracts/student-entry.ts";
import type { StudentIdentity, StudentVerificationResponse } from "../../../types/contracts/student-entry.ts";
import { requestJson } from "../../shared/api/httpClient.ts";

export async function verifyStudentIdentity(identity: StudentIdentity): Promise<StudentVerificationResponse> {
  const payload = studentIdentitySchema.parse(identity);
  return requestJson(
    "/api/student/verify",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    studentVerificationResponseSchema,
  );
}
