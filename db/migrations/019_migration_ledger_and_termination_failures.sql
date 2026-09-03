BEGIN;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  filename TEXT NOT NULL UNIQUE CHECK (filename ~ '^[0-9]{3}_[a-z0-9_]+[.]sql$'),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 240),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_by TEXT NOT NULL DEFAULT CURRENT_USER
);

INSERT INTO schema_migrations (version, filename, description) VALUES
  (1, '001_initial_schema.sql', 'Initial examination schema'),
  (2, '002_exam_configuration_history.sql', 'Reusable exam configuration history'),
  (3, '003_composition_mode_alignment.sql', 'Composition mode alignment'),
  (4, '004_sum_starter_blueprint.sql', 'Initial executable SUM blueprint'),
  (5, '005_prepared_papers.sql', 'Roster-based prepared papers'),
  (6, '006_live_room_recovery.sql', 'Live room session recovery'),
  (7, '007_teacher_authorized_second_attempt.sql', 'Teacher-authorized attempts'),
  (8, '008_exam_45_question_structure.sql', 'Forty-five-question exam structure'),
  (9, '009_extended_formula_catalog.sql', 'Extended formula catalog'),
  (10, '010_dynamic_assignment_question_count.sql', 'Dynamic assignment question count'),
  (11, '011_formula_only_exam_difficulty.sql', 'Formula-only exam stability baseline'),
  (12, '012_active_session_token_lifecycle.sql', 'Active session token lifecycle'),
  (13, '013_course_basic_function_catalog.sql', 'Course basic function catalog'),
  (14, '014_classroom_assignment_mode.sql', 'Classroom assignment mode'),
  (15, '015_assignment_question_volume.sql', 'Assignment question volume'),
  (16, '016_protect_in_progress_attempts.sql', 'Protect recoverable attempts'),
  (17, '017_easy_exam_mode.sql', 'Easy formal exam mode'),
  (18, '018_policy_suspension_and_teacher_collection.sql', 'Policy suspension and resumable room collection'),
  (19, '019_migration_ledger_and_termination_failures.sql', 'Migration ledger and collection failure diagnostics');

CREATE OR REPLACE FUNCTION prevent_schema_migration_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'MIGRATION_LEDGER_APPEND_ONLY';
END;
$$;

CREATE TRIGGER schema_migrations_append_only
BEFORE UPDATE OR DELETE ON schema_migrations
FOR EACH ROW
EXECUTE FUNCTION prevent_schema_migration_mutation();

CREATE TABLE exam_termination_failures (
  id UUID PRIMARY KEY,
  termination_run_id UUID NOT NULL REFERENCES exam_termination_runs(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE RESTRICT,
  error_code TEXT NOT NULL CHECK (error_code ~ '^[A-Z0-9_]{1,64}$'),
  error_message TEXT NOT NULL CHECK (char_length(error_message) BETWEEN 1 AND 240),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ,
  last_retried_at TIMESTAMPTZ,
  last_retried_by_teacher_id UUID REFERENCES teachers(id) ON DELETE RESTRICT,
  UNIQUE (termination_run_id, attempt_id),
  CHECK (last_failed_at >= first_failed_at),
  CHECK (resolved_at IS NULL OR resolved_at >= last_failed_at),
  CHECK ((last_retried_at IS NULL) = (last_retried_by_teacher_id IS NULL))
);

CREATE INDEX exam_termination_failures_unresolved_idx
  ON exam_termination_failures (termination_run_id, last_failed_at DESC)
  WHERE resolved_at IS NULL;

COMMIT;
