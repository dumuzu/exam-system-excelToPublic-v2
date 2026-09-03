-- Allow classroom assignments to generate 5, 10 or 15 questions for every
-- selected function. Formal exam structure and historical assignment rules
-- remain unchanged.

BEGIN;

ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_formula_question_count_check,
  DROP CONSTRAINT IF EXISTS exams_formula_group_count_check,
  DROP CONSTRAINT IF EXISTS exams_current_mode_question_structure_check;

ALTER TABLE exams
  ADD CONSTRAINT exams_formula_question_count_check
    CHECK (formula_question_count BETWEEN 1 AND 1500),
  ADD CONSTRAINT exams_formula_group_count_check
    CHECK (formula_group_count BETWEEN 1 AND 250),
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
          AND formula_question_count BETWEEN 5 AND 1500
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
