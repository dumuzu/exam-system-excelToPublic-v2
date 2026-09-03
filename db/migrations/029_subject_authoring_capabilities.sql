-- Let one subject enable multiple reusable authoring capabilities without changing historical exams.

BEGIN;

CREATE TABLE subject_authoring_capabilities (
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  assessment_type_key TEXT NOT NULL
    CHECK (assessment_type_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  capability_position SMALLINT NOT NULL
    CHECK (capability_position BETWEEN 0 AND 31),
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subject_id, assessment_type_key),
  UNIQUE (subject_id, capability_position)
);

INSERT INTO subject_authoring_capabilities (
  subject_id,
  assessment_type_key,
  capability_position
)
SELECT id, assessment_type_key, 0
FROM subjects;

CREATE INDEX subject_authoring_capabilities_type_idx
  ON subject_authoring_capabilities (assessment_type_key, subject_id);

INSERT INTO schema_migrations (version, filename, description)
VALUES (29, '029_subject_authoring_capabilities.sql', 'Reusable subject authoring capabilities');

COMMIT;
