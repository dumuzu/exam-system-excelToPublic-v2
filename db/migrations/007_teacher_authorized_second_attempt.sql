BEGIN;

ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS attempt_number SMALLINT NOT NULL DEFAULT 1
  CHECK (attempt_number > 0);

ALTER TABLE attempts
  DROP CONSTRAINT IF EXISTS attempts_exam_id_student_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS attempts_exam_student_number_idx
  ON attempts (exam_id, student_id, attempt_number);

CREATE TABLE IF NOT EXISTS attempt_retake_authorizations (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL,
  student_id UUID NOT NULL,
  previous_attempt_id UUID NOT NULL REFERENCES attempts(id),
  new_attempt_id UUID NOT NULL UNIQUE REFERENCES attempts(id),
  authorized_by_teacher_id UUID NOT NULL REFERENCES teachers(id),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id, student_id) REFERENCES exam_roster(exam_id, student_id),
  UNIQUE (exam_id, student_id, previous_attempt_id)
);

CREATE INDEX IF NOT EXISTS attempt_retake_exam_student_idx
  ON attempt_retake_authorizations (exam_id, student_id, authorized_at DESC);

COMMIT;
