-- Preserve an immutable record whenever a platform administrator crosses the
-- ordinary subject or ownership boundary.

BEGIN;

CREATE TABLE teacher_authorization_audit_events (
  id UUID PRIMARY KEY,
  actor_account_id UUID NOT NULL REFERENCES teacher_accounts(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]{1,63}$'),
  subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('platform', 'subject', 'exam', 'configuration', 'grade_result')),
  resource_id TEXT NOT NULL CHECK (char_length(resource_id) BETWEEN 1 AND 100),
  decision_code TEXT NOT NULL CHECK (decision_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX teacher_authorization_audit_actor_recorded_idx
  ON teacher_authorization_audit_events (actor_account_id, recorded_at DESC);

CREATE INDEX teacher_authorization_audit_subject_recorded_idx
  ON teacher_authorization_audit_events (subject_id, recorded_at DESC)
  WHERE subject_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_teacher_authorization_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'TEACHER_AUTHORIZATION_AUDIT_APPEND_ONLY';
END;
$$;

CREATE TRIGGER teacher_authorization_audit_events_append_only
BEFORE UPDATE OR DELETE ON teacher_authorization_audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_teacher_authorization_audit_mutation();

INSERT INTO schema_migrations (version, filename, description)
VALUES (25, '025_teacher_authorization_audit.sql', 'Append-only cross-subject authorization audit');

COMMIT;
