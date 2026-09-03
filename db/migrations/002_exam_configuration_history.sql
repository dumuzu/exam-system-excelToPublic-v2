-- Persistent teacher-side history for reusable exam and assignment configurations.
-- Run once after 001_initial_schema.sql using a direct (non-pooled) PostgreSQL connection.

BEGIN;

CREATE TABLE exam_configuration_history (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  configuration_mode TEXT NOT NULL CHECK (configuration_mode IN ('exam', 'assignment')),
  assignment_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_functions JSONB NOT NULL CHECK (jsonb_typeof(selected_functions) = 'array'),
  composition JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX exam_configuration_history_updated_at_idx
  ON exam_configuration_history (updated_at DESC);

COMMIT;
