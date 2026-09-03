-- Store one immutable prepared paper per classroom assignment instead of
-- duplicating the same payload for every rostered student.

BEGIN;

CREATE TABLE assignment_shared_question_instances (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  blueprint_version_id UUID NOT NULL REFERENCES blueprint_versions(id),
  question_mode TEXT NOT NULL CHECK (question_mode = 'formula'),
  display_order SMALLINT NOT NULL CHECK (display_order > 0),
  instance_payload JSONB NOT NULL,
  answer_key JSONB NOT NULL,
  scoring_rule JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (exam_id, question_key),
  UNIQUE (exam_id, display_order)
);

CREATE INDEX assignment_shared_questions_exam_order_idx
  ON assignment_shared_question_instances (exam_id, display_order);

CREATE OR REPLACE FUNCTION guard_assignment_shared_question()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_mode TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'SHARED_ASSIGNMENT_PAPER_IMMUTABLE';
  END IF;

  SELECT exam_mode INTO target_mode FROM exams WHERE id = NEW.exam_id;
  IF target_mode IS NULL OR target_mode <> 'assignment' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'SHARED_PAPER_REQUIRES_ASSIGNMENT_EXAM';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignment_shared_questions_guard
BEFORE INSERT OR UPDATE ON assignment_shared_question_instances
FOR EACH ROW
EXECUTE FUNCTION guard_assignment_shared_question();

INSERT INTO schema_migrations (version, filename, description)
VALUES (21, '021_shared_assignment_papers.sql', 'Shared classroom assignment papers');

COMMIT;
