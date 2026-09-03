import { z } from "zod";

import { subjectRoleSchema } from "./admin-auth.ts";
import { studentDisplayLocaleSchema } from "../models/locale.ts";
import { registeredAssessmentTypeKeySchema } from "../models/assessment.ts";

export const managedPlatformRoleSchema = z.enum(["teacher", "super_admin"]);
export const managedAccountStatusSchema = z.enum(["active", "disabled", "migration_pending"]);
export const managedSubjectStatusSchema = z.enum(["active", "archived"]);
export const managedAssessmentTypeKeySchema = registeredAssessmentTypeKeySchema;
export const managedAssessmentTypeKeysSchema = z.array(managedAssessmentTypeKeySchema)
  .min(1)
  .max(managedAssessmentTypeKeySchema.options.length)
  .refine((keys) => new Set(keys).size === keys.length, "Authoring capabilities must be unique.");

export const accountMembershipSchema = z.object({
  subjectId: z.string().min(1).max(100),
  subjectCode: z.string().min(1).max(100),
  subjectName: z.string().min(1).max(200),
  subjectRole: subjectRoleSchema,
});

export const managedAccountSchema = z.object({
  id: z.string().min(1).max(200),
  username: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  platformRole: managedPlatformRoleSchema,
  status: managedAccountStatusSchema,
  memberships: z.array(accountMembershipSchema),
});

export const managedSubjectSchema = z.object({
  id: z.string().min(1).max(100),
  code: z.string().min(1).max(100),
  nameJa: z.string().min(1).max(200),
  nameZh: z.string().min(1).max(200),
  nameEn: z.string().min(1).max(200).nullable(),
  studentLocale: studentDisplayLocaleSchema,
  assessmentTypeKeys: managedAssessmentTypeKeysSchema,
  status: managedSubjectStatusSchema.default("active"),
  membershipCount: z.number().int().nonnegative().default(0),
});

export const paginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(50),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const accountPageSchema = z.object({
  accounts: z.array(managedAccountSchema),
  pagination: paginationSchema,
});

export const accountResponseSchema = z.object({ account: managedAccountSchema });
export const managedSubjectListResponseSchema = z.object({ subjects: z.array(managedSubjectSchema) });

// 管理端弹窗的明确确认意图；账户身份仍由会话、权限和 CSRF 在服务端校验。
const explicitConfirmationSchema = z.literal(true);

export const createAccountBodySchema = z.object({
  username: z.string()
    .transform((value) => value.normalize("NFKC").trim().toLowerCase())
    .pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/)),
  displayName: z.string()
    .transform((value) => value.normalize("NFKC").trim())
    .pipe(z.string().min(1).max(100)),
  password: z.string().min(12).max(200).refine((value) => value.trim().length > 0),
  platformRole: managedPlatformRoleSchema.default("teacher"),
  confirmed: explicitConfirmationSchema,
}).strict();

export const accountStatusBodySchema = z.object({
  confirmed: explicitConfirmationSchema,
  status: z.enum(["active", "disabled"]),
}).strict();

export const accountRoleBodySchema = z.object({
  confirmed: explicitConfirmationSchema,
  platformRole: managedPlatformRoleSchema,
}).strict();

export const accountPasswordBodySchema = z.object({
  confirmed: explicitConfirmationSchema,
  password: z.string().min(12).max(200).refine((value) => value.trim().length > 0),
}).strict();

export const accountMembershipBodySchema = z.object({
  confirmed: explicitConfirmationSchema,
  subjectId: z.string().regex(/^[A-Za-z0-9:-]{1,100}$/),
  subjectRole: subjectRoleSchema,
}).strict();

export const accountMembershipItemSchema = z.object({
  subjectId: z.string().regex(/^[A-Za-z0-9:-]{1,100}$/),
  subjectRole: subjectRoleSchema,
}).strict();

export const accountMembershipBatchBodySchema = z.object({
  confirmed: explicitConfirmationSchema,
  memberships: z.array(accountMembershipItemSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.memberships.forEach((membership, index) => {
    if (seen.has(membership.subjectId)) {
      context.addIssue({ code: "custom", path: ["memberships", index, "subjectId"], message: "Subject memberships must be unique." });
    }
    seen.add(membership.subjectId);
  });
});

export const subjectSettingsBodySchema = z.object({
  nameJa: z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().min(1).max(100)),
  nameZh: z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().min(1).max(100)),
  nameEn: z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().min(1).max(100)),
  studentLocale: studentDisplayLocaleSchema,
  assessmentTypeKeys: managedAssessmentTypeKeysSchema,
}).strict();

export const createSubjectBodySchema = z.object({
  code: z.string()
    .transform((value) => value.normalize("NFKC").trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)),
  nameJa: z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().min(1).max(100)),
  nameZh: z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().min(1).max(100)),
  nameEn: z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().min(1).max(100)),
  studentLocale: studentDisplayLocaleSchema,
  assessmentTypeKeys: managedAssessmentTypeKeysSchema,
}).strict();

export const subjectStatusBodySchema = z.object({
  status: managedSubjectStatusSchema,
}).strict();

export const managedSubjectResponseSchema = z.object({ subject: managedSubjectSchema });

export type ManagedPlatformRole = z.infer<typeof managedPlatformRoleSchema>;
export type ManagedAccountStatus = z.infer<typeof managedAccountStatusSchema>;
export type ManagedSubjectRole = z.infer<typeof subjectRoleSchema>;
export type AccountMembership = z.infer<typeof accountMembershipSchema>;
export type ManagedAccount = z.infer<typeof managedAccountSchema>;
export type ManagedSubject = z.infer<typeof managedSubjectSchema>;
export type ManagedSubjectStatus = z.infer<typeof managedSubjectStatusSchema>;
export type ManagedAssessmentTypeKey = z.infer<typeof managedAssessmentTypeKeySchema>;
export type AccountPage = z.infer<typeof accountPageSchema>;
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;
export type AccountStatusBody = z.infer<typeof accountStatusBodySchema>;
export type AccountRoleBody = z.infer<typeof accountRoleBodySchema>;
export type AccountPasswordBody = z.infer<typeof accountPasswordBodySchema>;
export type AccountMembershipBody = z.infer<typeof accountMembershipBodySchema>;
export type AccountMembershipItem = z.infer<typeof accountMembershipItemSchema>;
export type AccountMembershipBatchBody = z.infer<typeof accountMembershipBatchBodySchema>;
export type SubjectSettingsBody = z.infer<typeof subjectSettingsBodySchema>;
export type CreateSubjectBody = z.infer<typeof createSubjectBodySchema>;
export type SubjectStatusBody = z.infer<typeof subjectStatusBodySchema>;
