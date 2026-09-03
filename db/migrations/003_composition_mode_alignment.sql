-- Align the original fixed exam schema with the reusable exam/assignment
-- composer introduced in v0.4. Run after 001 and 002 on every database branch.
-- Existing locked plans remain readable; new plans carry their composer version.

BEGIN;

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS exam_mode TEXT NOT NULL DEFAULT 'exam',
  ADD COLUMN IF NOT EXISTS formula_question_count SMALLINT NOT NULL DEFAULT 30;

ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_function_choice_count_check,
  DROP CONSTRAINT IF EXISTS exams_formula_group_count_check,
  DROP CONSTRAINT IF EXISTS exams_formula_questions_per_group_check,
  DROP CONSTRAINT IF EXISTS exams_exam_mode_check,
  DROP CONSTRAINT IF EXISTS exams_formula_question_count_check,
  DROP CONSTRAINT IF EXISTS exams_current_mode_question_structure_check;

-- The core mode module and the database enforce the same currently supported
-- structures. A future mode must add a new migration, leaving old snapshots
-- valid and unmodified.
ALTER TABLE exams
  ADD CONSTRAINT exams_exam_mode_check
    CHECK (exam_mode IN ('exam', 'assignment')),
  ADD CONSTRAINT exams_function_choice_count_check
    CHECK (function_choice_count >= 0 AND function_choice_count <= 50),
  ADD CONSTRAINT exams_formula_question_count_check
    CHECK (formula_question_count >= 1 AND formula_question_count <= 50),
  ADD CONSTRAINT exams_formula_group_count_check
    CHECK (formula_group_count >= 1 AND formula_group_count <= 10),
  ADD CONSTRAINT exams_formula_questions_per_group_check
    CHECK (formula_questions_per_group >= 1 AND formula_questions_per_group <= 10),
  ADD CONSTRAINT exams_current_mode_question_structure_check
    CHECK (
      (exam_mode = 'exam'
        AND function_choice_count = 10
        AND formula_question_count = 30
        AND formula_group_count = 5
        AND formula_questions_per_group = 6)
      OR
      (exam_mode = 'assignment'
        AND function_choice_count IN (0, 3, 5)
        AND formula_question_count IN (3, 6, 10)
        AND formula_group_count = CEIL(formula_question_count::NUMERIC / 6)
        AND formula_questions_per_group = 6)
    );

ALTER TABLE exam_blueprint_plans
  ADD COLUMN IF NOT EXISTS selection_policy TEXT,
  ADD COLUMN IF NOT EXISTS composer_version SMALLINT;

-- Plans made before this change used the old allocation label. Preserve that
-- fact rather than relabelling an immutable historical composition as new logic.
UPDATE exam_blueprint_plans
SET selection_policy = CASE
  WHEN allocation_policy = 'auto_balanced_coverage' THEN 'legacy_auto_balanced_coverage'
  ELSE 'selected_functions_only'
END
WHERE selection_policy IS NULL;

-- Existing plans must not be silently interpreted as a new composer version.
-- The old plan schema version doubled as its composer version; otherwise v1 is
-- the conservative fallback. New rows receive v2 only after this backfill.
UPDATE exam_blueprint_plans
SET composer_version = CASE
  WHEN COALESCE(composition ->> 'composerVersion', composition ->> 'version') ~ '^[1-9][0-9]{0,3}$'
    THEN COALESCE(composition ->> 'composerVersion', composition ->> 'version')::SMALLINT
  ELSE 1
END
WHERE composer_version IS NULL;

ALTER TABLE exam_blueprint_plans
  ALTER COLUMN selection_policy SET DEFAULT 'selected_functions_only',
  ALTER COLUMN selection_policy SET NOT NULL,
  ALTER COLUMN composer_version SET DEFAULT 2,
  ALTER COLUMN composer_version SET NOT NULL;

ALTER TABLE exam_blueprint_plans
  DROP CONSTRAINT IF EXISTS exam_blueprint_plans_allocation_policy_check,
  DROP CONSTRAINT IF EXISTS exam_blueprint_plans_selection_policy_check,
  DROP CONSTRAINT IF EXISTS exam_blueprint_plans_composer_version_check;

-- Policy names are versioned data. Restrict their shape, not a fixed list, so
-- later composition algorithms do not require a destructive schema rewrite.
ALTER TABLE exam_blueprint_plans
  ADD CONSTRAINT exam_blueprint_plans_allocation_policy_check
    CHECK (char_length(allocation_policy) BETWEEN 1 AND 100),
  ADD CONSTRAINT exam_blueprint_plans_selection_policy_check
    CHECK (char_length(selection_policy) BETWEEN 1 AND 100),
  ADD CONSTRAINT exam_blueprint_plans_composer_version_check
    CHECK (composer_version > 0);

COMMIT;
