-- Add reviewed subject localization metadata without changing assessment behavior.

BEGIN;

ALTER TABLE subjects
  ADD COLUMN name_en TEXT,
  ADD COLUMN student_locale TEXT NOT NULL DEFAULT 'legacy_bilingual'
    CHECK (student_locale IN ('legacy_bilingual', 'ja', 'zh', 'en')),
  ADD CONSTRAINT subjects_name_en_length_check
    CHECK (name_en IS NULL OR char_length(btrim(name_en)) BETWEEN 1 AND 100);

UPDATE subjects
SET name_en = CASE subject_code
  WHEN 'excel-applications' THEN 'Spreadsheet Practice'
  WHEN 'manual-test' THEN 'Test'
  ELSE NULL
END;

INSERT INTO schema_migrations (version, filename, description)
VALUES (28, '028_subject_locales_and_bulk_memberships.sql', 'Subject locales and bulk membership support');

COMMIT;
