import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl: any = new URL(
  "../db/migrations/023_multi_subject_account_ownership.sql",
  import.meta.url,
);

test("migration 023 creates durable accounts and subject memberships without plaintext credentials", async () => {
  const sql: any = await readFile(migrationUrl, "utf8");

  assert.match(sql, /(?:^|\n)BEGIN;/i);
  assert.match(sql, /COMMIT;\s*$/i);
  assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);

  assert.match(sql, /CREATE TABLE teacher_accounts/i);
  assert.match(sql, /password_hash TEXT/i);
  assert.doesNotMatch(sql, /password_plain|plaintext_password|password TEXT/i);
  assert.match(sql, /account_status TEXT NOT NULL DEFAULT 'migration_pending'/i);
  assert.match(sql, /platform_role TEXT NOT NULL DEFAULT 'teacher'/i);
  assert.match(sql, /credential_version INTEGER NOT NULL DEFAULT 1/i);
  assert.match(sql, /session_version INTEGER NOT NULL DEFAULT 1/i);
  assert.match(sql, /account_status <> 'active' OR password_hash IS NOT NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX teachers_login_name_canonical_idx[\s\S]*lower\(btrim\(login_name\)\)/i);

  assert.match(sql, /CREATE TABLE subjects/i);
  assert.match(sql, /CREATE TABLE subject_memberships/i);
  assert.match(sql, /UNIQUE \(subject_id, account_id\)/i);
  assert.match(sql, /subject_role IN \('subject_admin', 'teacher', 'proctor'\)/i);
  assert.match(sql, /membership_status IN \('active', 'revoked'\)/i);
});

test("migration 023 backfills legacy Excel ownership and validates scoped foreign keys", async () => {
  const sql: any = await readFile(migrationUrl, "utf8");

  assert.match(sql, /FROM exam_configuration_history/i);
  assert.match(sql, /INSERT INTO teachers/i);
  assert.match(sql, /INSERT INTO teacher_accounts[\s\S]*SELECT teacher[.]id/i);
  assert.match(sql, /INSERT INTO subjects[\s\S]*excel-applications/i);
  assert.match(sql, /INSERT INTO subject_memberships[\s\S]*FROM teacher_accounts/i);

  assert.match(sql, /ALTER TABLE exams[\s\S]*ADD COLUMN subject_id UUID/i);
  assert.match(sql, /ADD COLUMN owner_account_id UUID/i);
  assert.match(sql, /UPDATE exams[\s\S]*owner_account_id = created_by_teacher_id/i);
  assert.match(sql, /VALIDATE CONSTRAINT exams_subject_id_fkey/i);
  assert.match(sql, /VALIDATE CONSTRAINT exams_owner_account_id_fkey/i);
  assert.match(sql, /ALTER COLUMN subject_id SET NOT NULL/i);
  assert.match(sql, /ALTER COLUMN owner_account_id SET NOT NULL/i);

  assert.match(sql, /ALTER TABLE exam_configuration_history[\s\S]*ADD COLUMN subject_id UUID/i);
  assert.match(sql, /ADD COLUMN owner_account_id UUID/i);
  assert.match(sql, /VALIDATE CONSTRAINT exam_configuration_history_subject_id_fkey/i);
  assert.match(sql, /VALIDATE CONSTRAINT exam_configuration_history_owner_account_id_fkey/i);
});

test("migration 023 adds scoped lookup indexes and the next ledger entry", async () => {
  const sql: any = await readFile(migrationUrl, "utf8");

  assert.match(sql, /subject_memberships_account_scope_idx[\s\S]*\(account_id, membership_status, subject_id\)/i);
  assert.match(sql, /exams_subject_owner_created_idx[\s\S]*\(subject_id, owner_account_id, created_at DESC\)/i);
  assert.match(sql, /exam_configuration_history_subject_owner_updated_idx[\s\S]*\(subject_id, owner_account_id, updated_at DESC\)/i);
  assert.match(sql, /VALUES \(23, '023_multi_subject_account_ownership[.]sql'/i);
});
