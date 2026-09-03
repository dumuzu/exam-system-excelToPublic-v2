export const adminExamQueryKeys = {
  platform: ["admin", "system", "exams"] as const,
  subject: (subjectId: string) => ["admin", "subjects", subjectId, "exams"] as const,
  room: (examCode: string) => ["admin", "exams", examCode, "room"] as const,
  roomFailures: (examCode: string) => ["admin", "exams", examCode, "termination-failures"] as const,
};
