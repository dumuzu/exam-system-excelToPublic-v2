import { z } from "zod";

export const apiErrorResponseSchema = z.object({
  error: z.string().optional(),
  code: z.string().nullable().optional(),
  errors: z.array(z.object({
    code: z.string().optional(),
    message: z.string().optional(),
  }).passthrough()).optional(),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
