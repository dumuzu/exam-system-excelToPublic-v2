-- First executable blueprint used by the student attempt proof of concept.
-- Run after 001-003 and the function catalog seed.

BEGIN;

INSERT INTO question_blueprints (
  id, blueprint_key, title_ja, title_zh, question_mode, scenario_key, status
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'sum-starter-v1',
  'Sales 列の合計',
  'Sales 列求和',
  'formula',
  'sales',
  'active'
)
ON CONFLICT (blueprint_key) DO NOTHING;

INSERT INTO blueprint_versions (
  id, blueprint_id, version_number, generation_rule, scoring_rule, student_copy, supported_functions
)
VALUES (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  1,
  '{"generator":"sum-starter-v1","seedVersion":1}'::jsonb,
  '{"maximumScore":2.5,"requiredFunction":"SUM","numericEpsilon":0.000001,"coreFunctionMissingScore":1.5,"version":"sum-starter-v1"}'::jsonb,
  '{"promptKey":"sumSalesColumn","language":"ja","tableLanguage":"en"}'::jsonb,
  '["SUM"]'::jsonb
)
ON CONFLICT (blueprint_id, version_number) DO NOTHING;

COMMIT;
