-- Assignment mode now creates one formula exercise per selected
-- formula-capable function. Keep both historical exam structures valid.

BEGIN;

ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_dynamic_assignment_question_structure_check;

ALTER TABLE exams
  ADD CONSTRAINT exams_dynamic_assignment_question_structure_check
    CHECK (
      (exam_mode = 'exam' AND (
        (function_choice_count = 10 AND formula_question_count = 30 AND formula_group_count = 5 AND formula_questions_per_group = 6)
        OR
        (function_choice_count = 5 AND formula_question_count = 40 AND formula_group_count = 7 AND formula_questions_per_group = 6)
      ))
      OR
      (exam_mode = 'assignment'
        AND function_choice_count IN (0, 3, 5)
        AND formula_question_count BETWEEN 1 AND 50
        AND formula_group_count = CEIL(formula_question_count::NUMERIC / 6)
        AND formula_questions_per_group = 6)
    ) NOT VALID;

ALTER TABLE exams
  VALIDATE CONSTRAINT exams_dynamic_assignment_question_structure_check;

ALTER TABLE exams
  DROP CONSTRAINT IF EXISTS exams_current_mode_question_structure_check;

ALTER TABLE exams
  RENAME CONSTRAINT exams_dynamic_assignment_question_structure_check
  TO exams_current_mode_question_structure_check;

COMMIT;
