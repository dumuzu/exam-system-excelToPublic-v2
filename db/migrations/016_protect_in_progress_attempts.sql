-- Protect live answer sheets at the database boundary. Application checks make
-- this a normal 409 response; these triggers remain as a last-resort guard for
-- direct SQL, future maintenance code, and submit/delete transaction races.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_in_progress_attempt_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'in_progress' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'EXAM_HAS_IN_PROGRESS_ATTEMPTS';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS attempts_prevent_in_progress_delete ON attempts;
CREATE TRIGGER attempts_prevent_in_progress_delete
BEFORE DELETE ON attempts
FOR EACH ROW
EXECUTE FUNCTION prevent_in_progress_attempt_deletion();

CREATE OR REPLACE FUNCTION prevent_exam_with_in_progress_attempts_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM attempts
    WHERE exam_id = OLD.id
      AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'EXAM_HAS_IN_PROGRESS_ATTEMPTS';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS exams_prevent_in_progress_attempt_delete ON exams;
CREATE TRIGGER exams_prevent_in_progress_attempt_delete
BEFORE DELETE ON exams
FOR EACH ROW
EXECUTE FUNCTION prevent_exam_with_in_progress_attempts_deletion();

COMMIT;
