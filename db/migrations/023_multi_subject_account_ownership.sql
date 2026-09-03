-- Add durable teacher accounts and subject-scoped ownership without changing
-- existing exam, attempt, answer or grade identifiers.

BEGIN;

ALTER TABLE teachers
  ADD CONSTRAINT teachers_login_name_present_check
    CHECK (char_length(btrim(login_name)) BETWEEN 1 AND 100) NOT VALID;

ALTER TABLE teachers
  VALIDATE CONSTRAINT teachers_login_name_present_check;

CREATE UNIQUE INDEX teachers_login_name_canonical_idx
  ON teachers (lower(btrim(login_name)));

-- Configuration history predates the teachers table relationship. Create an
-- inactive audit identity for any history author that has never created an
-- exam. md5 is used only to derive a repeatable UUID, never for credentials.
WITH history_accounts AS (
  SELECT
    lower(btrim(created_by)) AS canonical_login,
    min(btrim(created_by)) AS login_name
  FROM exam_configuration_history
  WHERE char_length(btrim(created_by)) BETWEEN 1 AND 100
  GROUP BY lower(btrim(created_by))
), missing_history_accounts AS (
  SELECT
    history.canonical_login,
    history.login_name,
    md5('legacy-teacher:' || history.canonical_login) AS identifier_hash
  FROM history_accounts history
  WHERE NOT EXISTS (
    SELECT 1
    FROM teachers teacher
    WHERE lower(btrim(teacher.login_name)) = history.canonical_login
  )
)
INSERT INTO teachers (id, login_name, display_name)
SELECT
  (
    substr(identifier_hash, 1, 8) || '-' ||
    substr(identifier_hash, 9, 4) || '-' ||
    substr(identifier_hash, 13, 4) || '-' ||
    substr(identifier_hash, 17, 4) || '-' ||
    substr(identifier_hash, 21, 12)
  )::uuid,
  login_name,
  login_name
FROM missing_history_accounts;

CREATE TABLE teacher_accounts (
  id UUID PRIMARY KEY REFERENCES teachers(id) ON DELETE RESTRICT,
  password_hash TEXT,
  platform_role TEXT NOT NULL DEFAULT 'teacher'
    CHECK (platform_role IN ('super_admin', 'teacher')),
  account_status TEXT NOT NULL DEFAULT 'migration_pending'
    CHECK (account_status IN ('migration_pending', 'active', 'disabled')),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  activated_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (password_hash IS NULL OR char_length(password_hash) BETWEEN 32 AND 512),
  CHECK (account_status <> 'active' OR password_hash IS NOT NULL),
  CHECK (account_status <> 'active' OR activated_at IS NOT NULL),
  CHECK (account_status <> 'disabled' OR disabled_at IS NOT NULL)
);

INSERT INTO teacher_accounts (id)
SELECT teacher.id
FROM teachers teacher;

CREATE TABLE subjects (
  id UUID PRIMARY KEY,
  subject_code TEXT NOT NULL UNIQUE
    CHECK (subject_code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  name_ja TEXT NOT NULL CHECK (char_length(btrim(name_ja)) BETWEEN 1 AND 100),
  name_zh TEXT NOT NULL CHECK (char_length(btrim(name_zh)) BETWEEN 1 AND 100),
  assessment_type_key TEXT NOT NULL
    CHECK (assessment_type_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  subject_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subject_status IN ('active', 'archived')),
  created_by_account_id UUID REFERENCES teacher_accounts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO subjects (
  id,
  subject_code,
  name_ja,
  name_zh,
  assessment_type_key,
  subject_status
) VALUES (
  '00000000-0000-4000-8000-000000000023',
  'excel-applications',
  '表計算演習',
  '电子表格练习',
  'excel_formula',
  'active'
);

CREATE TABLE subject_memberships (
  id UUID PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL REFERENCES teacher_accounts(id) ON DELETE RESTRICT,
  subject_role TEXT NOT NULL
    CHECK (subject_role IN ('subject_admin', 'teacher', 'proctor')),
  membership_status TEXT NOT NULL DEFAULT 'active'
    CHECK (membership_status IN ('active', 'revoked')),
  granted_by_account_id UUID REFERENCES teacher_accounts(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (subject_id, account_id),
  CHECK (
    (membership_status = 'active' AND revoked_at IS NULL) OR
    (membership_status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

INSERT INTO subject_memberships (
  id,
  subject_id,
  account_id,
  subject_role,
  membership_status
)
SELECT
  (
    substr(identifier_hash, 1, 8) || '-' ||
    substr(identifier_hash, 9, 4) || '-' ||
    substr(identifier_hash, 13, 4) || '-' ||
    substr(identifier_hash, 17, 4) || '-' ||
    substr(identifier_hash, 21, 12)
  )::uuid,
  '00000000-0000-4000-8000-000000000023'::uuid,
  account.id,
  'teacher',
  'active'
FROM (
  SELECT item.id, md5('legacy-membership:' || item.id::text) AS identifier_hash
  FROM teacher_accounts item
) account;

CREATE INDEX subject_memberships_account_scope_idx
  ON subject_memberships (account_id, membership_status, subject_id);

CREATE INDEX subject_memberships_subject_role_idx
  ON subject_memberships (subject_id, membership_status, subject_role, account_id);

ALTER TABLE exams
  ADD COLUMN subject_id UUID,
  ADD COLUMN owner_account_id UUID,
  ADD COLUMN assessment_type_key TEXT;

UPDATE exams
SET
  subject_id = '00000000-0000-4000-8000-000000000023'::uuid,
  owner_account_id = created_by_teacher_id,
  assessment_type_key = 'excel_formula';

ALTER TABLE exams
  ADD CONSTRAINT exams_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT exams_owner_account_id_fkey
    FOREIGN KEY (owner_account_id) REFERENCES teacher_accounts(id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT exams_owner_subject_membership_fkey
    FOREIGN KEY (subject_id, owner_account_id)
    REFERENCES subject_memberships(subject_id, account_id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT exams_assessment_type_key_check
    CHECK (assessment_type_key ~ '^[a-z][a-z0-9_]{1,63}$') NOT VALID;

ALTER TABLE exams
  VALIDATE CONSTRAINT exams_subject_id_fkey;

ALTER TABLE exams
  VALIDATE CONSTRAINT exams_owner_account_id_fkey;

ALTER TABLE exams
  VALIDATE CONSTRAINT exams_owner_subject_membership_fkey;

ALTER TABLE exams
  VALIDATE CONSTRAINT exams_assessment_type_key_check;

ALTER TABLE exams
  ALTER COLUMN subject_id SET NOT NULL,
  ALTER COLUMN owner_account_id SET NOT NULL,
  ALTER COLUMN assessment_type_key SET NOT NULL;

CREATE INDEX exams_subject_owner_created_idx
  ON exams (subject_id, owner_account_id, created_at DESC);

CREATE INDEX exams_subject_state_created_idx
  ON exams (subject_id, state, created_at DESC);

ALTER TABLE exam_configuration_history
  ADD COLUMN subject_id UUID,
  ADD COLUMN owner_account_id UUID,
  ADD COLUMN assessment_type_key TEXT;

UPDATE exam_configuration_history history
SET
  subject_id = '00000000-0000-4000-8000-000000000023'::uuid,
  owner_account_id = account.id,
  assessment_type_key = 'excel_formula'
FROM teachers teacher
INNER JOIN teacher_accounts account ON account.id = teacher.id
WHERE lower(btrim(teacher.login_name)) = lower(btrim(history.created_by));

ALTER TABLE exam_configuration_history
  ADD CONSTRAINT exam_configuration_history_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT exam_configuration_history_owner_account_id_fkey
    FOREIGN KEY (owner_account_id) REFERENCES teacher_accounts(id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT exam_configuration_history_owner_subject_membership_fkey
    FOREIGN KEY (subject_id, owner_account_id)
    REFERENCES subject_memberships(subject_id, account_id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT exam_configuration_history_assessment_type_key_check
    CHECK (assessment_type_key ~ '^[a-z][a-z0-9_]{1,63}$') NOT VALID;

ALTER TABLE exam_configuration_history
  VALIDATE CONSTRAINT exam_configuration_history_subject_id_fkey;

ALTER TABLE exam_configuration_history
  VALIDATE CONSTRAINT exam_configuration_history_owner_account_id_fkey;

ALTER TABLE exam_configuration_history
  VALIDATE CONSTRAINT exam_configuration_history_owner_subject_membership_fkey;

ALTER TABLE exam_configuration_history
  VALIDATE CONSTRAINT exam_configuration_history_assessment_type_key_check;

ALTER TABLE exam_configuration_history
  ALTER COLUMN subject_id SET NOT NULL,
  ALTER COLUMN owner_account_id SET NOT NULL,
  ALTER COLUMN assessment_type_key SET NOT NULL;

CREATE INDEX exam_configuration_history_subject_owner_updated_idx
  ON exam_configuration_history (subject_id, owner_account_id, updated_at DESC);

INSERT INTO schema_migrations (version, filename, description)
VALUES (23, '023_multi_subject_account_ownership.sql', 'Teacher accounts and subject-scoped ownership');

COMMIT;
