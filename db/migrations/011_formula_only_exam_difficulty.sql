-- Destructive stability baseline for the 2026 formula-only release.
-- This migration intentionally removes every historical exam/configuration and
-- generated blueprint. Student and teacher identities are preserved.

BEGIN;

LOCK TABLE exams, exam_configuration_history, question_blueprints IN ACCESS EXCLUSIVE MODE;
TRUNCATE TABLE exams, exam_configuration_history, question_blueprints CASCADE;

ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_current_mode_question_structure_check,
  DROP CONSTRAINT IF EXISTS exams_short_code_check,
  DROP CONSTRAINT IF EXISTS exams_publication_review_check;

ALTER TABLE exams
  ALTER COLUMN function_choice_count SET DEFAULT 0,
  ALTER COLUMN formula_question_count SET DEFAULT 50,
  ALTER COLUMN formula_group_count SET DEFAULT 9;

ALTER TABLE exams
  ADD CONSTRAINT exams_current_mode_question_structure_check
    CHECK (
      (exam_mode = 'exam'
        AND function_choice_count = 0 AND formula_question_count = 50
        AND formula_group_count = 9 AND formula_questions_per_group = 6)
      OR
      (exam_mode = 'assignment'
        AND function_choice_count IN (0, 3, 5)
        AND formula_question_count BETWEEN 1 AND 50
        AND formula_group_count = CEIL(formula_question_count::NUMERIC / 6)
        AND formula_questions_per_group = 6)
    ),
  ADD CONSTRAINT exams_short_code_check
    CHECK (exam_code ~ '^[A-HJ-NP-Z2-9]{7}$'),
  ADD CONSTRAINT exams_publication_review_check
    CHECK (
      state NOT IN ('published', 'active')
      OR COALESCE(settings #>> '{publicationAudit,status}', '') = 'approved'
    );

ALTER TABLE question_blueprints
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN review_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT question_blueprints_review_status_check
    CHECK (review_status IN ('pending', 'approved', 'blocked')),
  ADD CONSTRAINT question_blueprints_approved_reviewed_at_check
    CHECK (review_status <> 'approved' OR reviewed_at IS NOT NULL);

ALTER TABLE blueprint_versions
  ADD COLUMN content_hash TEXT NOT NULL,
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD CONSTRAINT blueprint_versions_content_hash_check
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT blueprint_versions_review_status_check
    CHECK (review_status IN ('pending', 'approved', 'blocked')),
  ADD CONSTRAINT blueprint_versions_approved_reviewed_at_check
    CHECK (review_status <> 'approved' OR reviewed_at IS NOT NULL),
  ADD CONSTRAINT blueprint_versions_blueprint_content_hash_key
    UNIQUE (blueprint_id, content_hash);

CREATE TABLE exam_publication_reviews (
  id UUID PRIMARY KEY,
  exam_id UUID NOT NULL UNIQUE REFERENCES exams(id) ON DELETE CASCADE,
  audit_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'blocked')),
  audit_report JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  reviewed_by_teacher_id UUID NOT NULL REFERENCES teachers(id),
  reviewed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'approved' OR audit_report ->> 'status' = 'approved')
);

CREATE INDEX attempts_expiry_scan_idx
  ON attempts (deadline_at, id)
  WHERE status = 'in_progress';

CREATE INDEX exam_publication_reviews_status_idx
  ON exam_publication_reviews (status, reviewed_at DESC);

COMMIT;
