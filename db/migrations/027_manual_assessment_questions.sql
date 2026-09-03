-- Add teacher-authored question modes while retaining the reviewed Excel
-- paper structures and all existing event, attempt, answer, and grade rows.

BEGIN;

ALTER TABLE question_blueprints
  DROP CONSTRAINT IF EXISTS question_blueprints_question_mode_check;
ALTER TABLE question_blueprints
  ADD CONSTRAINT question_blueprints_question_mode_check
  CHECK (question_mode IN ('choice', 'formula', 'single_choice', 'multiple_choice', 'fill_blank', 'short_answer'));

ALTER TABLE prepared_question_instances
  DROP CONSTRAINT IF EXISTS prepared_question_instances_question_mode_check;
ALTER TABLE prepared_question_instances
  ADD CONSTRAINT prepared_question_instances_question_mode_check
  CHECK (question_mode IN ('choice', 'formula', 'single_choice', 'multiple_choice', 'fill_blank', 'short_answer'));

ALTER TABLE question_instances
  DROP CONSTRAINT IF EXISTS question_instances_question_mode_check;
ALTER TABLE question_instances
  ADD CONSTRAINT question_instances_question_mode_check
  CHECK (question_mode IN ('choice', 'formula', 'single_choice', 'multiple_choice', 'fill_blank', 'short_answer'));

ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_current_mode_question_structure_check;

ALTER TABLE exams
  ADD CONSTRAINT exams_current_mode_question_structure_check
  CHECK (
    (
      assessment_type_key = 'manual_questions'
      AND exam_mode = 'exam'
      AND function_choice_count = 0
      AND formula_question_count BETWEEN 1 AND 1500
      AND formula_group_count = CEIL(formula_question_count::NUMERIC / 6)
      AND formula_questions_per_group = 6
    )
    OR
    (
      assessment_type_key <> 'manual_questions'
      AND (
        (exam_mode = 'exam' AND (
          (
            settings #>> '{plan,difficulty}' = 'easy'
            AND (
              (
                COALESCE(settings #>> '{plan,composerVersion}', '') ~ '^[0-9]+$'
                AND (settings #>> '{plan,composerVersion}')::INTEGER >= 12
                AND function_choice_count = 10
                AND formula_question_count = 30
                AND formula_group_count = 5
                AND formula_questions_per_group = 6
              )
              OR
              (
                (
                  NOT (COALESCE(settings #>> '{plan,composerVersion}', '') ~ '^[0-9]+$')
                  OR (settings #>> '{plan,composerVersion}')::INTEGER < 12
                )
                AND function_choice_count = 10
                AND formula_question_count = 40
                AND formula_group_count = 7
                AND formula_questions_per_group = 6
              )
            )
          )
          OR
          (
            COALESCE(settings #>> '{plan,difficulty}', 'normal') <> 'easy'
            AND function_choice_count = 0
            AND formula_question_count = 50
            AND formula_group_count = 9
            AND formula_questions_per_group = 6
          )
        ))
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
      )
    )
  );

INSERT INTO schema_migrations (version, filename, description)
VALUES (27, '027_manual_assessment_questions.sql', 'Teacher-authored assessment question modes');

COMMIT;
