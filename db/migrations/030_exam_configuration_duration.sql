-- Preserve the teacher-selected formal exam duration in reusable configurations.

BEGIN;

ALTER TABLE exam_configuration_history
  ADD COLUMN duration_minutes SMALLINT;

UPDATE exam_configuration_history
SET duration_minutes = 90
WHERE configuration_mode = 'exam';

ALTER TABLE exam_configuration_history
  ADD CONSTRAINT exam_configuration_history_duration_check CHECK (
    (configuration_mode = 'exam' AND duration_minutes BETWEEN 1 AND 240)
    OR (configuration_mode = 'assignment' AND duration_minutes IS NULL)
  );

INSERT INTO schema_migrations (version, filename, description)
VALUES (30, '030_exam_configuration_duration.sql', 'Reusable formal exam duration');

COMMIT;
