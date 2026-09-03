BEGIN;

ALTER TABLE students ALTER COLUMN name_ja DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_name_present_check') THEN
    ALTER TABLE students ADD CONSTRAINT students_name_present_check
      CHECK (NULLIF(name_ja, '') IS NOT NULL OR NULLIF(name_native, '') IS NOT NULL) NOT VALID;
  END IF;
END $$;

ALTER TABLE students VALIDATE CONSTRAINT students_name_present_check;

UPDATE students
SET name_native = TRIM(regexp_replace(regexp_replace(COALESCE(NULLIF(name_native, ''), name_ja), '[?]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')),
    updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(NULLIF(name_native, ''), name_ja) ~ '[A-Za-z]'
  AND POSITION('?' IN COALESCE(NULLIF(name_native, ''), name_ja)) > 0;

CREATE TABLE IF NOT EXISTS attempt_resume_authorizations (
  id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  authorized_by_teacher_id UUID NOT NULL REFERENCES teachers(id),
  previous_session_id UUID REFERENCES active_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('granted', 'used', 'superseded')),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS attempt_resume_one_grant_idx
  ON attempt_resume_authorizations (attempt_id)
  WHERE status = 'granted';

CREATE INDEX IF NOT EXISTS active_sessions_attempt_last_seen_idx
  ON active_sessions (attempt_id, status, last_seen_at DESC);

COMMIT;
