import { z } from "zod";
import { studentDisplayLocaleSchema } from "../models/locale.ts";
import { registeredAssessmentTypeKeySchema } from "../models/assessment.ts";

export const adminRoleSchema = z.enum(["super_admin", "teacher", "test_admin", "assistant_teacher"]);
export const subjectRoleSchema = z.enum(["subject_admin", "teacher", "proctor"]);
export const subjectAccessScopeSchema = z.enum(["personal", "subject", "platform"]);
export const adminWorkspaceKindSchema = z.enum(["system", "teaching"]);
export const adminNavigationKeySchema = z.enum(["system", "subjects", "dashboard", "compose", "rooms", "results", "accounts"]);
export const adminPermissionSchema = z.enum([
  "view_dashboard",
  "compose_exam",
  "view_room",
  "manage_admission",
  "authorize_resume",
  "authorize_retake",
  "view_results",
  "export_results",
  "adjust_grades",
  "terminate_exam",
  "delete_exam",
  "manage_accounts",
]);

export const subjectMembershipSchema = z.object({
  subjectId: z.string().min(1).max(100),
  subjectCode: z.string().min(1).max(100),
  subjectName: z.string().min(1).max(200),
  subjectRole: subjectRoleSchema,
});

const adminPathSchema = z.string().refine((path) => path.startsWith("/admin/"), {
  message: "Path must stay inside the administration workspace.",
});

export const adminNavigationItemSchema = z.object({
  key: adminNavigationKeySchema,
  path: adminPathSchema,
  permission: adminPermissionSchema.nullable(),
  workspace: adminWorkspaceKindSchema,
});

export const workspaceSubjectSchema = z.object({
  id: z.string().min(1).max(100),
  code: z.string().min(1).max(100),
  nameJa: z.string().min(1).max(200),
  nameZh: z.string().min(1).max(200),
  nameEn: z.string().min(1).max(200).nullable(),
  studentLocale: studentDisplayLocaleSchema,
  assessmentTypeKeys: z.array(registeredAssessmentTypeKeySchema).min(1),
  subjectRole: subjectRoleSchema,
  accessScope: subjectAccessScopeSchema,
  permissions: z.array(adminPermissionSchema),
});

export const adminSessionSchema = z.object({
  user: z.string().min(1).max(100),
  role: adminRoleSchema,
  permissions: z.array(adminPermissionSchema),
  csrfToken: z.string().min(1),
  storageMode: z.enum(["memory", "postgres"]),
  subjects: z.array(subjectMembershipSchema),
  workspaceSubjects: z.array(workspaceSubjectSchema),
  landingPath: adminPathSchema,
  workspaceKind: adminWorkspaceKindSchema,
  navigation: z.array(adminNavigationItemSchema),
});

export const loginCredentialsSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
}).strict();

export const loginResponseSchema = z.object({
  user: z.string().min(1).max(100),
  role: adminRoleSchema,
  permissions: z.array(adminPermissionSchema),
  csrfToken: z.string().min(1),
  landingPath: adminPathSchema,
});

export type AdminRole = z.infer<typeof adminRoleSchema>;
export type AdminPermission = z.infer<typeof adminPermissionSchema>;
export type SubjectRole = z.infer<typeof subjectRoleSchema>;
export type SubjectMembership = z.infer<typeof subjectMembershipSchema>;
export type SubjectAccessScope = z.infer<typeof subjectAccessScopeSchema>;
export type AdminWorkspaceKind = z.infer<typeof adminWorkspaceKindSchema>;
export type AdminNavigationItem = z.infer<typeof adminNavigationItemSchema>;
export type WorkspaceSubject = z.infer<typeof workspaceSubjectSchema>;
export type AdminSession = z.infer<typeof adminSessionSchema>;
export type LoginCredentials = z.infer<typeof loginCredentialsSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
