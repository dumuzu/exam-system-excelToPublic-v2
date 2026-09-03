-- Keep the name imported for an exam separate from the student's mutable
-- current name. Student number remains the durable identity key.

BEGIN;

ALTER TABLE exam_roster
  ADD COLUMN roster_name TEXT;

UPDATE exam_roster roster
SET roster_name = COALESCE(NULLIF(student.name_native, ''), student.name_ja)
FROM students student
WHERE student.id = roster.student_id;

ALTER TABLE exam_roster
  ADD CONSTRAINT exam_roster_name_present_check
    CHECK (roster_name IS NOT NULL
      AND char_length(btrim(roster_name)) BETWEEN 1 AND 100) NOT VALID;

ALTER TABLE exam_roster
  VALIDATE CONSTRAINT exam_roster_name_present_check;

ALTER TABLE exam_roster
  ALTER COLUMN roster_name SET NOT NULL;

INSERT INTO schema_migrations (version, filename, description)
VALUES (22, '022_exam_roster_name_snapshots.sql', 'Per-exam roster name snapshots');

COMMIT;
