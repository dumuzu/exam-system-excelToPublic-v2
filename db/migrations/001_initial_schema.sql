-- Provider-neutral PostgreSQL schema for the Excel web exam system.
-- UUID values are created by the application so this migration does not rely on
-- provider-specific extensions such as pgcrypto.

BEGIN;

CREATE TABLE teachers (
  id UUID PRIMARY KEY,
  login_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  preferred_locale TEXT NOT NULL DEFAULT 'ja' CHECK (preferred_locale IN ('ja', 'zh')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
  id UUID PRIMARY KEY,
  student_number TEXT NOT NULL UNIQUE,
  name_ja TEXT NOT NULL,
  name_native TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exams (
  id UUID PRIMARY KEY,
  exam_code TEXT NOT NULL UNIQUE,
  title_ja TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  created_by_teacher_id UUID NOT NULL REFERENCES teachers(id),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'active', 'closed', 'archived')),
  duration_minutes SMALLINT NOT NULL DEFAULT 90 CHECK (duration_minutes > 0 AND duration_minutes <= 240),
  function_choice_count SMALLINT NOT NULL DEFAULT 10 CHECK (function_choice_count = 10),
  formula_group_count SMALLINT NOT NULL DEFAULT 5 CHECK (formula_group_count = 5),
  formula_questions_per_group SMALLINT NOT NULL DEFAULT 6 CHECK (formula_questions_per_group = 6),
  student_locale TEXT NOT NULL DEFAULT 'ja' CHECK (student_locale = 'ja'),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exam_roster (
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id),
  enrollment_status TEXT NOT NULL DEFAULT 'eligible' CHECK (enrollment_status IN ('eligible', 'withdrawn')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exam_id, student_id)
);

CREATE TABLE admission_approvals (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL,
  student_id UUID NOT NULL,
  approved_by_teacher_id UUID NOT NULL REFERENCES teachers(id),
  status TEXT NOT NULL CHECK (status IN ('waiting', 'approved', 'rejected', 'expired')),
  approved_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id, student_id) REFERENCES exam_roster(exam_id, student_id),
  UNIQUE (exam_id, student_id)
);

CREATE TABLE active_sessions (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL,
  student_id UUID NOT NULL,
  attempt_id UUID,
  session_token_hash TEXT NOT NULL UNIQUE,
  browser_family TEXT,
  browser_version TEXT,
  device_summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'replaced', 'revoked', 'expired')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id, student_id) REFERENCES exam_roster(exam_id, student_id)
);

CREATE TABLE function_catalog (
  function_name TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  supports_choice BOOLEAN NOT NULL,
  supports_formula BOOLEAN NOT NULL,
  difficulty SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  description_ja TEXT NOT NULL,
  description_zh TEXT NOT NULL,
  blueprint_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (supports_choice OR supports_formula)
);

CREATE TABLE question_blueprints (
  id UUID PRIMARY KEY,
  blueprint_key TEXT NOT NULL UNIQUE,
  title_ja TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  question_mode TEXT NOT NULL CHECK (question_mode IN ('choice', 'formula')),
  scenario_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  created_by_teacher_id UUID REFERENCES teachers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE blueprint_versions (
  id UUID PRIMARY KEY,
  blueprint_id UUID NOT NULL REFERENCES question_blueprints(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  generation_rule JSONB NOT NULL,
  scoring_rule JSONB NOT NULL,
  student_copy JSONB NOT NULL,
  supported_functions JSONB NOT NULL,
  created_by_teacher_id UUID REFERENCES teachers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (blueprint_id, version_number)
);

CREATE TABLE exam_function_selections (
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL REFERENCES function_catalog(function_name),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exam_id, function_name)
);

CREATE TABLE exam_blueprint_plans (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL UNIQUE REFERENCES exams(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  allocation_policy TEXT NOT NULL CHECK (allocation_policy = 'auto_balanced_coverage'),
  selected_functions JSONB NOT NULL,
  composition JSONB NOT NULL,
  coverage_summary JSONB NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_teacher_id UUID NOT NULL REFERENCES teachers(id)
);

CREATE TABLE attempts (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL,
  student_id UUID NOT NULL,
  admission_approval_id UUID REFERENCES admission_approvals(id),
  active_session_id UUID REFERENCES active_sessions(id),
  status TEXT NOT NULL CHECK (status IN ('waiting', 'in_progress', 'submitted', 'auto_submitted', 'policy_submitted', 'review_required')),
  started_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  browser_preflight JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id, student_id) REFERENCES exam_roster(exam_id, student_id),
  UNIQUE (exam_id, student_id)
);

ALTER TABLE active_sessions
  ADD CONSTRAINT active_sessions_attempt_id_fkey
  FOREIGN KEY (attempt_id) REFERENCES attempts(id);

CREATE TABLE question_instances (
  id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  blueprint_version_id UUID NOT NULL REFERENCES blueprint_versions(id),
  question_mode TEXT NOT NULL CHECK (question_mode IN ('choice', 'formula')),
  display_order SMALLINT NOT NULL CHECK (display_order > 0),
  instance_payload JSONB NOT NULL,
  answer_key JSONB NOT NULL,
  scoring_rule JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attempt_id, question_key),
  UNIQUE (attempt_id, display_order)
);

CREATE TABLE answers (
  attempt_id UUID PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
  answer_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  client_saved_at TIMESTAMPTZ,
  server_saved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE answer_revisions (
  id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 0),
  reason TEXT NOT NULL CHECK (reason IN ('five_minute_checkpoint', 'before_submit', 'policy_event', 'recovery_import')),
  answer_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attempt_id, version)
);

CREATE TABLE submissions (
  id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL UNIQUE REFERENCES attempts(id) ON DELETE CASCADE,
  submission_type TEXT NOT NULL CHECK (submission_type IN ('manual', 'timer', 'policy', 'recovery')),
  final_answer_payload JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  grading_status TEXT NOT NULL DEFAULT 'pending' CHECK (grading_status IN ('pending', 'graded', 'review_required', 'failed')),
  grading_started_at TIMESTAMPTZ,
  graded_at TIMESTAMPTZ
);

CREATE TABLE grade_results (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_instance_id UUID NOT NULL REFERENCES question_instances(id),
  awarded_score NUMERIC(5, 2) NOT NULL CHECK (awarded_score >= 0),
  maximum_score NUMERIC(5, 2) NOT NULL CHECK (maximum_score > 0),
  result_status TEXT NOT NULL CHECK (result_status IN ('correct', 'partial_core_function_missing', 'incorrect', 'review_required')),
  explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  grading_rule_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (submission_id, question_instance_id)
);

CREATE TABLE proctor_events (
  id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_hidden', 'long_blur', 'fullscreen_exit', 'refresh_attempt', 'copy_blocked', 'paste_blocked', 'duplicate_session', 'preflight_failure')),
  event_count SMALLINT NOT NULL DEFAULT 1 CHECK (event_count > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE offline_recovery_packages (
  id UUID PRIMARY KEY,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generated', 'imported', 'rejected')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_at TIMESTAMPTZ,
  imported_by_teacher_id UUID REFERENCES teachers(id),
  UNIQUE (attempt_id, integrity_hash)
);

CREATE TABLE teacher_adjustments (
  id UUID PRIMARY KEY,
  grade_result_id UUID NOT NULL REFERENCES grade_results(id) ON DELETE CASCADE,
  adjusted_by_teacher_id UUID NOT NULL REFERENCES teachers(id),
  previous_score NUMERIC(5, 2) NOT NULL,
  new_score NUMERIC(5, 2) NOT NULL CHECK (new_score >= 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX attempts_exam_status_idx ON attempts (exam_id, status);
CREATE INDEX attempts_student_idx ON attempts (student_id, created_at DESC);
CREATE INDEX active_sessions_exam_student_status_idx ON active_sessions (exam_id, student_id, status);
CREATE UNIQUE INDEX active_sessions_one_active_per_student_idx
  ON active_sessions (exam_id, student_id)
  WHERE status = 'active';
CREATE INDEX question_instances_attempt_idx ON question_instances (attempt_id, display_order);
CREATE INDEX submissions_status_idx ON submissions (grading_status, submitted_at);
CREATE INDEX grade_results_submission_idx ON grade_results (submission_id);
CREATE INDEX proctor_events_attempt_occurred_idx ON proctor_events (attempt_id, occurred_at DESC);

COMMIT;
