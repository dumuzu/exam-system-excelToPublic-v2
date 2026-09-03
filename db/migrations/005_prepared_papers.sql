BEGIN;

CREATE TABLE exam_preparation_runs (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL UNIQUE REFERENCES exams(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'validating', 'ready', 'failed')),
  roster_count INTEGER NOT NULL CHECK (roster_count >= 0),
  planned_question_count INTEGER NOT NULL CHECK (planned_question_count >= 0),
  generated_question_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_question_count >= 0),
  generator_version TEXT NOT NULL,
  error_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prepared_question_instances (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id),
  question_key TEXT NOT NULL,
  blueprint_version_id UUID NOT NULL REFERENCES blueprint_versions(id),
  question_mode TEXT NOT NULL CHECK (question_mode IN ('choice', 'formula')),
  display_order SMALLINT NOT NULL CHECK (display_order > 0),
  instance_payload JSONB NOT NULL,
  answer_key JSONB NOT NULL,
  scoring_rule JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id, student_id) REFERENCES exam_roster(exam_id, student_id),
  UNIQUE (exam_id, student_id, question_key),
  UNIQUE (exam_id, student_id, display_order)
);

CREATE INDEX prepared_question_instances_student_idx ON prepared_question_instances (exam_id, student_id, display_order);

COMMIT;
