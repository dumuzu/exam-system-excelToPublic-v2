import type { ManagedSubject } from "../../../types/contracts/account-administration.ts";
import type { AdminLocale } from "./adminLocale.ts";

type SubjectNameSource = Pick<ManagedSubject, "nameEn" | "nameJa" | "nameZh" | "studentLocale">;

// 科目名称优先跟随学生端语言；旧版双语科目仍跟随管理界面语言。
export function getLocalizedSubjectName(subject: SubjectNameSource, locale: AdminLocale): string {
  if (subject.studentLocale === "ja") return subject.nameJa;
  if (subject.studentLocale === "zh") return subject.nameZh;
  if (subject.studentLocale === "en") return subject.nameEn ?? subject.nameJa;
  if (locale === "en") return subject.nameEn ?? subject.nameJa;
  return locale === "zh" ? subject.nameZh : subject.nameJa;
}
