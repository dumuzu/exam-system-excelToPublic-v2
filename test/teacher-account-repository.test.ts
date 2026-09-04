import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ADMIN_ROLES, hashAdminPassword } from "../src/server/admin-auth.ts";
import {
  InMemoryTeacherAccountRepository,
  PostgresTeacherAccountRepository,
  createTeacherAccountRepository,
} from "../src/server/teacher-account-repository.ts";

const migrationUrl: any = new URL("../db/migrations/024_teacher_login_rate_limits.sql", import.meta.url);

test("legacy environment accounts have a documented in-memory compatibility path", async () => {
  const legacyAccounts: any = [{
    username: "LegacyTeacher",
    passwordHash: hashAdminPassword("legacy-password", { salt: "88888888888888888888888888888888" }),
    role: ADMIN_ROLES.ASSISTANT_TEACHER,
  }];
  const repository: any = createTeacherAccountRepository({ legacyAccounts });

  assert.equal(repository.storageMode, "memory-legacy-auth");
  assert.deepEqual(
    await repository.findAuthenticationAccount("  legacyteacher "),
    {
      id: "legacy:legacyteacher",
      username: "LegacyTeacher",
      displayName: "LegacyTeacher",
      passwordHash: legacyAccounts[0].passwordHash,
      role: ADMIN_ROLES.ASSISTANT_TEACHER,
      status: "active",
      credentialVersion: 1,
      sessionVersion: 1,
    },
  );

  const imported: any = await repository.migrateLegacyAccounts([{
    username: "SecondTeacher",
    passwordHash: hashAdminPassword("second-password", { salt: "99999999999999999999999999999999" }),
    role: ADMIN_ROLES.TEACHER,
  }]);
  assert.deepEqual(imported, { imported: 1 });
  assert.equal((await repository.findAuthenticationAccount("secondteacher")).status, "active");
});

test("per-IP and per-account login limits remain atomic under concurrent attempts", async () => {
  const repository: any = new InMemoryTeacherAccountRepository();
  const policy: any = { limit: 5, windowMilliseconds: 60_000, maxTrackedKeys: 100 };
  const attempts: any = await Promise.all(
    Array.from({ length: 6 }, () => repository.consumeLoginRateLimit({
      ipKey: "ip-hash",
      accountKey: "account-hash",
      ...policy,
    })),
  );

  assert.deepEqual(attempts.map((attempt: any) => attempt.allowed), [true, true, true, true, true, false]);
  assert.ok(attempts[5].retryAfterSeconds > 0);

  await repository.resetLoginRateLimit({ ipKey: "ip-hash", accountKey: "account-hash" });
  assert.equal((await repository.consumeLoginRateLimit({ ipKey: "ip-hash", accountKey: "account-hash", ...policy })).allowed, true);
});

test("one shared IP and one targeted account are limited independently", async () => {
  const repository: any = new InMemoryTeacherAccountRepository();
  const policy: any = { limit: 2, windowMilliseconds: 60_000, maxTrackedKeys: 100 };

  assert.equal((await repository.consumeLoginRateLimit({ ipKey: "shared-ip", accountKey: "account-a", ...policy })).allowed, true);
  assert.equal((await repository.consumeLoginRateLimit({ ipKey: "shared-ip", accountKey: "account-b", ...policy })).allowed, true);
  assert.equal((await repository.consumeLoginRateLimit({ ipKey: "shared-ip", accountKey: "account-c", ...policy })).allowed, false);

  await repository.resetLoginRateLimit({ ipKey: "shared-ip", accountKey: "account-a" });
  assert.equal((await repository.consumeLoginRateLimit({ ipKey: "another-ip", accountKey: "target", ...policy })).allowed, true);
  assert.equal((await repository.consumeLoginRateLimit({ ipKey: "third-ip", accountKey: "target", ...policy })).allowed, true);
  assert.equal((await repository.consumeLoginRateLimit({ ipKey: "fourth-ip", accountKey: "target", ...policy })).allowed, false);
});

test("migration 024 provides a bounded cross-instance login limit store", async () => {
  const sql: any = await readFile(migrationUrl, "utf8");

  assert.match(sql, /(?:^|\n)BEGIN;/i);
  assert.match(sql, /CREATE TABLE teacher_login_rate_limits/i);
  assert.match(sql, /PRIMARY KEY \(scope_type, scope_hash\)/i);
  assert.match(sql, /scope_type IN \('ip', 'account'\)/i);
  assert.match(sql, /teacher_login_rate_limits_expiry_idx[\s\S]*expires_at/i);
  assert.match(sql, /VALUES \(24, '024_teacher_login_rate_limits[.]sql'/i);
  assert.doesNotMatch(sql, /password|login_name|ip_address/i);
  assert.match(sql, /COMMIT;\s*$/i);
});

test("legacy database import maps old roles and commits one atomic batch", async () => {
  const calls: any = [];
  const client: any = {
    query: async (sql: any, values = []) => {
      calls.push({ sql, values });
      return { rows: sql.includes("SELECT id") ? [] : [] };
    },
    release() {},
  };
  const repository: any = new PostgresTeacherAccountRepository({
    pool: { connect: async () => client, query: async () => ({ rows: [] }), end: async () => {} },
  });
  const passwordHash: any = hashAdminPassword("assistant-password", { salt: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });

  assert.deepEqual(await repository.migrateLegacyAccounts([{
    username: "assistant",
    passwordHash,
    role: ADMIN_ROLES.ASSISTANT_TEACHER,
  }]), { imported: 1 });
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  const accountWrite: any = calls.find((call: any) => call.sql.includes("INSERT INTO teacher_accounts"));
  const membershipWrite: any = calls.find((call: any) => call.sql.includes("INSERT INTO subject_memberships"));
  assert.deepEqual(accountWrite.values.slice(1), [passwordHash, "teacher"]);
  assert.equal(membershipWrite.values[2], "proctor");
});

test("legacy database import rolls back the whole batch on failure", async () => {
  const commands: any = [];
  const client: any = {
    query: async (sql: any) => {
      commands.push(sql);
      if (sql.includes("INSERT INTO teacher_accounts")) throw new Error("simulated write failure");
      return { rows: sql.includes("SELECT id") ? [{ id: "existing-account" }] : [] };
    },
    release() {},
  };
  const repository: any = new PostgresTeacherAccountRepository({
    pool: { connect: async () => client, query: async () => ({ rows: [] }), end: async () => {} },
  });

  await assert.rejects(
    repository.migrateLegacyAccounts([{
      username: "teacher",
      passwordHash: hashAdminPassword("teacher-password", { salt: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      role: ADMIN_ROLES.TEACHER,
    }]),
    /simulated write failure/,
  );
  assert.equal(commands.at(-1), "ROLLBACK");
});

test("subject settings audit binds UUID and text identifiers separately", async () => {
  const subjectId = "22e756e2-91c1-43a8-a7dc-a7ae381f73c6";
  const row = {
    id: subjectId,
    subject_code: "manual-test",
    name_ja: "システム開発入門",
    name_zh: "测试",
    name_en: "Test",
    student_locale: "ja",
    assessment_type_key: "manual_questions",
    subject_status: "active",
    membership_count: 1,
  };
  const client: any = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM subjects subject WHERE subject.id=$1 FOR UPDATE")) return { rows: [row] };
      if (sql.includes("UPDATE subjects SET")) return { rows: [row] };
      if (sql.includes("INSERT INTO teacher_authorization_audit_events")) {
        if (/\$3,'subject',\$3(?:::text)?/.test(sql)) {
          throw Object.assign(new Error("inconsistent types deduced for parameter $3"), { code: "42P08" });
        }
        assert.match(sql, /\$3,'subject',\$4/);
        assert.deepEqual(values?.slice(2), [subjectId, subjectId]);
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository: any = new PostgresTeacherAccountRepository({
    pool: { connect: async () => client, query: async () => ({ rows: [] }), end: async () => {} },
  });

  const subject = await repository.updateSubjectSettings({
    actorAccountId: "00000000-0000-4000-8000-000000000001",
    subjectId,
    nameJa: row.name_ja,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    studentLocale: row.student_locale,
    assessmentTypeKeys: ["manual_questions"],
  });

  assert.equal(subject.id, subjectId);
});

test("subject creation audit binds UUID and text identifiers separately", async () => {
  let createdSubjectId = "";
  const client: any = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("INSERT INTO subjects")) {
        createdSubjectId = String(values?.[0]);
        return {
          rows: [{
            id: createdSubjectId,
            subject_code: "it001",
            name_ja: "開発入門",
            name_zh: "系统开发入门",
            name_en: "IT Test",
            student_locale: "en",
            assessment_type_key: "manual_questions",
            subject_status: "active",
          }],
        };
      }
      if (sql.includes("INSERT INTO teacher_authorization_audit_events")) {
        if (/\$3,'subject',\$3(?:::text)?/.test(sql)) {
          throw Object.assign(new Error("inconsistent types deduced for parameter $3"), { code: "42P08" });
        }
        assert.match(sql, /\$3,'subject',\$4/);
        assert.deepEqual(values?.slice(2), [createdSubjectId, createdSubjectId]);
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository: any = new PostgresTeacherAccountRepository({
    pool: { connect: async () => client, query: async () => ({ rows: [] }), end: async () => {} },
  });

  const subject = await repository.createSubject({
    actorAccountId: "00000000-0000-4000-8000-000000000001",
    code: "it001",
    nameJa: "開発入門",
    nameZh: "系统开发入门",
    nameEn: "IT Test",
    studentLocale: "en",
    assessmentTypeKeys: ["manual_questions"],
  });

  assert.equal(subject.id, createdSubjectId);
  assert.equal(subject.code, "it001");
});

test("subject status audit binds UUID and text identifiers separately", async () => {
  const subjectId = "22e756e2-91c1-43a8-a7dc-a7ae381f73c6";
  const row = {
    id: subjectId,
    subject_code: "it001",
    name_ja: "開発入門",
    name_zh: "系统开发入门",
    name_en: "IT Test",
    student_locale: "en",
    assessment_type_key: "manual_questions",
    assessment_type_keys: ["manual_questions"],
    subject_status: "archived",
    membership_count: 0,
  };
  const client: any = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM subjects subject WHERE subject.id=$1 FOR UPDATE")) {
        return { rows: [{ ...row, subject_status: "active" }] };
      }
      if (sql.includes("UPDATE subjects SET subject_status")) return { rows: [row] };
      if (sql.includes("INSERT INTO teacher_authorization_audit_events")) {
        if (/\$3,'subject',\$3(?:::text)?/.test(sql)) {
          throw Object.assign(new Error("inconsistent types deduced for parameter $3"), { code: "42P08" });
        }
        assert.match(sql, /\$3,'subject',\$4,\$5/);
        assert.deepEqual(values?.slice(2), [subjectId, subjectId, "SUBJECT_ARCHIVED"]);
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository: any = new PostgresTeacherAccountRepository({
    pool: { connect: async () => client, query: async () => ({ rows: [] }), end: async () => {} },
  });

  const subject = await repository.setSubjectStatus({
    actorAccountId: "00000000-0000-4000-8000-000000000001",
    subjectId,
    status: "archived",
  });

  assert.equal(subject.status, "archived");
});
