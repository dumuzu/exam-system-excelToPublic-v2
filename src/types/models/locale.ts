import { z } from "zod";

export const interfaceLocaleSchema = z.enum(["ja", "zh", "en"]);
export const studentDisplayLocaleSchema = z.enum(["legacy_bilingual", "ja", "zh", "en"]);

export type InterfaceLocale = z.infer<typeof interfaceLocaleSchema>;
export type StudentDisplayLocale = z.infer<typeof studentDisplayLocaleSchema>;
