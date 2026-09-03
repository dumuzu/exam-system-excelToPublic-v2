import assert from "node:assert/strict";
import test from "node:test";

import type { ManagedSubject } from "../src/types/contracts/account-administration.ts";
import { getLocalizedSubjectName } from "../src/client/shared/i18n/subjectNames.ts";

const subject = {
  id: "manual-test",
  code: "manual-test",
  nameJa: "システム開発入門",
  nameZh: "测试",
  nameEn: "Test",
  assessmentTypeKeys: ["manual_questions"],
  status: "active",
  membershipCount: 1,
} satisfies Omit<ManagedSubject, "studentLocale">;

test("a subject configured for Japanese displays its Japanese name in a Chinese administration session", () => {
  assert.equal(getLocalizedSubjectName({ ...subject, studentLocale: "ja" }, "zh"), "システム開発入門");
});

test("legacy bilingual subjects continue to follow the administration language", () => {
  assert.equal(getLocalizedSubjectName({ ...subject, studentLocale: "legacy_bilingual" }, "zh"), "测试");
  assert.equal(getLocalizedSubjectName({ ...subject, studentLocale: "legacy_bilingual" }, "ja"), "システム開発入門");
});
