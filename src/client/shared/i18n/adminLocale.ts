export const adminLocaleOptions = [
  { value: "ja", label: "日本語", documentLanguage: "ja", productName: "試験管理システム" },
  { value: "zh", label: "简体中文", documentLanguage: "zh-CN", productName: "考试管理系统" },
  { value: "en", label: "English", documentLanguage: "en", productName: "Exam Management System" },
] as const;

export type AdminLocale = typeof adminLocaleOptions[number]["value"];

export function isAdminLocale(value: string): value is AdminLocale {
  return adminLocaleOptions.some((option) => option.value === value);
}
