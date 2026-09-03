-- Split the strict formal exam experience from untimed classroom assignments.
-- Composer v9 assignments contain five ordered formula questions per selected
-- function, no choice questions, and no server deadline. Historical plans stay
-- readable under their original constraints.

BEGIN;

ALTER TABLE exams
  ALTER COLUMN duration_minutes DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS exams_duration_minutes_check,
  DROP CONSTRAINT IF EXISTS exams_formula_question_count_check,
  DROP CONSTRAINT IF EXISTS exams_formula_group_count_check,
  DROP CONSTRAINT IF EXISTS exams_current_mode_question_structure_check,
  DROP CONSTRAINT IF EXISTS exams_mode_duration_check;

ALTER TABLE exams
  ADD CONSTRAINT exams_formula_question_count_check
    CHECK (formula_question_count BETWEEN 1 AND 500),
  ADD CONSTRAINT exams_formula_group_count_check
    CHECK (formula_group_count BETWEEN 1 AND 84),
  ADD CONSTRAINT exams_mode_duration_check
    CHECK (
      (exam_mode = 'exam' AND duration_minutes BETWEEN 1 AND 240)
      OR
      (exam_mode = 'assignment' AND (
        (
          COALESCE(settings #>> '{plan,composerVersion}', '') ~ '^[0-9]+$'
          AND (settings #>> '{plan,composerVersion}')::INTEGER >= 9
          AND duration_minutes IS NULL
        )
        OR
        (
          NOT (COALESCE(settings #>> '{plan,composerVersion}', '') ~ '^[0-9]+$')
          OR (settings #>> '{plan,composerVersion}')::INTEGER < 9
        )
        AND duration_minutes BETWEEN 1 AND 240
      ))
    ),
  ADD CONSTRAINT exams_current_mode_question_structure_check
    CHECK (
      (exam_mode = 'exam'
        AND function_choice_count = 0
        AND formula_question_count = 50
        AND formula_group_count = 9
        AND formula_questions_per_group = 6)
      OR
      (exam_mode = 'assignment' AND (
        (
          COALESCE(settings #>> '{plan,composerVersion}', '') ~ '^[0-9]+$'
          AND (settings #>> '{plan,composerVersion}')::INTEGER >= 9
          AND function_choice_count = 0
          AND formula_question_count BETWEEN 5 AND 500
          AND formula_question_count % 5 = 0
          AND formula_group_count = CEIL(formula_question_count::NUMERIC / 6)
          AND formula_questions_per_group = 6
        )
        OR
        (
          (
            NOT (COALESCE(settings #>> '{plan,composerVersion}', '') ~ '^[0-9]+$')
            OR (settings #>> '{plan,composerVersion}')::INTEGER < 9
          )
          AND function_choice_count IN (0, 3, 5)
          AND formula_question_count BETWEEN 1 AND 50
          AND formula_group_count = CEIL(formula_question_count::NUMERIC / 6)
          AND formula_questions_per_group = 6
        )
      ))
    );

COMMIT;
