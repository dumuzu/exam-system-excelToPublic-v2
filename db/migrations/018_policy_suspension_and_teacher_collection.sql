-- Keep a policy-stopped answer sheet resumable and distinguish a teacher's
-- room-wide collection from timer and student submissions.

BEGIN;

ALTER TABLE attempts
  DROP CONSTRAINT IF EXISTS attempts_status_check;

ALTER TABLE attempts
  ADD CONSTRAINT attempts_status_check
  CHECK (status IN (
    'waiting',
    'in_progress',
    'policy_suspended',
    'submitted',
    'auto_submitted',
    'teacher_submitted',
    'policy_submitted',
    'review_required'
  ));

ALTER TABLE submissions
  DROP CONSTRAINT IF EXISTS submissions_submission_type_check;

ALTER TABLE submissions
  ADD CONSTRAINT submissions_submission_type_check
  CHECK (submission_type IN ('manual', 'timer', 'teacher', 'policy', 'recovery'));

-- Keep session lifecycle data bounded and make database expiry authoritative,
-- not merely a property of the signed browser cookie.
UPDATE active_sessions
SET status = 'expired'
WHERE status = 'active'
  AND expires_at <= CURRENT_TIMESTAMP;

CREATE INDEX active_sessions_active_expiry_idx
  ON active_sessions (expires_at)
  WHERE status = 'active';

-- Application transactions already serialize entry on the roster row. These
-- indexes and foreign keys make the same invariants true for direct SQL and
-- future maintenance code.
CREATE UNIQUE INDEX attempts_one_open_per_exam_student_idx
  ON attempts (exam_id, student_id)
  WHERE status IN ('waiting', 'in_progress', 'policy_suspended');

ALTER TABLE attempts
  ADD CONSTRAINT attempts_id_exam_student_key UNIQUE (id, exam_id, student_id);

ALTER TABLE active_sessions
  ADD CONSTRAINT active_sessions_attempt_identity_fkey
  FOREIGN KEY (attempt_id, exam_id, student_id)
  REFERENCES attempts (id, exam_id, student_id)
  NOT VALID;

ALTER TABLE active_sessions
  VALIDATE CONSTRAINT active_sessions_attempt_identity_fkey;

ALTER TABLE proctor_events
  ADD CONSTRAINT proctor_events_event_attempt_key UNIQUE (id, attempt_id);

CREATE TABLE attempt_policy_suspensions (
  id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  trigger_event_id UUID NOT NULL UNIQUE,
  remaining_seconds INTEGER NOT NULL CHECK (remaining_seconds >= 0),
  status TEXT NOT NULL DEFAULT 'suspended' CHECK (status IN ('suspended', 'resumed', 'collected')),
  suspended_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resumed_at TIMESTAMPTZ,
  resumed_by_teacher_id UUID REFERENCES teachers(id),
  collected_at TIMESTAMPTZ,
  collected_by_teacher_id UUID REFERENCES teachers(id),
  FOREIGN KEY (trigger_event_id, attempt_id)
    REFERENCES proctor_events (id, attempt_id),
  CHECK (
    (status = 'suspended'
      AND resumed_at IS NULL AND resumed_by_teacher_id IS NULL
      AND collected_at IS NULL AND collected_by_teacher_id IS NULL)
    OR
    (status = 'resumed'
      AND resumed_at IS NOT NULL AND resumed_by_teacher_id IS NOT NULL
      AND collected_at IS NULL AND collected_by_teacher_id IS NULL)
    OR
    (status = 'collected'
      AND resumed_at IS NULL AND resumed_by_teacher_id IS NULL
      AND collected_at IS NOT NULL AND collected_by_teacher_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX attempt_policy_suspensions_one_open_idx
  ON attempt_policy_suspensions (attempt_id)
  WHERE status = 'suspended';

CREATE INDEX attempt_policy_suspensions_attempt_time_idx
  ON attempt_policy_suspensions (attempt_id, suspended_at DESC);

-- A resumable batch job is the canonical room-collection state. The existing
-- JSON copy in exams.settings remains only a lightweight student notification.
CREATE TABLE exam_termination_runs (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL UNIQUE REFERENCES exams(id) ON DELETE CASCADE,
  requested_by_teacher_id UUID NOT NULL REFERENCES teachers(id),
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'processing', 'completed')),
  collect_until TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  target_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (target_attempt_count >= 0),
  submitted_count INTEGER NOT NULL DEFAULT 0 CHECK (submitted_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (status <> 'completed' AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX exam_termination_runs_status_time_idx
  ON exam_termination_runs (status, collect_until);

-- Deferred checks let one transaction update the Attempt and its suspension in
-- either order while rejecting an impossible committed state.
CREATE OR REPLACE FUNCTION validate_attempt_policy_suspension_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_attempt_id UUID;
  target_attempt_status TEXT;
  open_suspension_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'attempts' THEN
    IF TG_OP = 'DELETE' THEN target_attempt_id := OLD.id;
    ELSE target_attempt_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN target_attempt_id := OLD.attempt_id;
    ELSE target_attempt_id := NEW.attempt_id;
    END IF;
  END IF;

  SELECT status INTO target_attempt_status
  FROM attempts
  WHERE id = target_attempt_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO open_suspension_count
  FROM attempt_policy_suspensions
  WHERE attempt_id = target_attempt_id
    AND status = 'suspended';

  IF target_attempt_status = 'policy_suspended' AND open_suspension_count <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POLICY_SUSPENSION_STATE_MISMATCH';
  END IF;
  IF target_attempt_status <> 'policy_suspended' AND open_suspension_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'POLICY_SUSPENSION_STATE_MISMATCH';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER attempts_policy_suspension_state_check
AFTER INSERT OR UPDATE ON attempts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_attempt_policy_suspension_state();

CREATE CONSTRAINT TRIGGER suspension_attempt_state_check
AFTER INSERT OR UPDATE OR DELETE ON attempt_policy_suspensions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_attempt_policy_suspension_state();

-- Migration 016 protected live attempts from event deletion. A suspended
-- attempt is equally live: it still owns answers and remaining examination
-- time, so extend both database-boundary guards.
CREATE OR REPLACE FUNCTION prevent_in_progress_attempt_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('in_progress', 'policy_suspended') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'EXAM_HAS_IN_PROGRESS_ATTEMPTS';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_exam_with_in_progress_attempts_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM attempts
    WHERE exam_id = OLD.id
      AND status IN ('in_progress', 'policy_suspended')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'EXAM_HAS_IN_PROGRESS_ATTEMPTS';
  END IF;
  RETURN OLD;
END;
$$;

COMMIT;
