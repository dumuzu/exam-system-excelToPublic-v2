-- Publish frequently used basic functions found in the course workbooks.
-- Formula parsing and grading remain application-owned; this migration only
-- exposes functions whose implementations and question templates are shipped.

BEGIN;

INSERT INTO function_catalog (
  function_name,
  category,
  supports_choice,
  supports_formula,
  difficulty,
  description_ja,
  description_zh,
  blueprint_requirements
) VALUES
  ('VALUE', 'text',        TRUE, TRUE, 1, '数値を表す文字列を計算可能な数値へ変換します。', '将表示数字的文本转换为可计算的数值。', '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('TEXT',  'text',        TRUE, TRUE, 2, '数値を指定した表示形式の文字列へ変換します。',   '按指定格式将数值转换为文本。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MOD',   'calculation', TRUE, TRUE, 1, '割り算の余りを求めます。',                       '计算除法的余数。',                     '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb)
ON CONFLICT (function_name) DO UPDATE SET
  category = EXCLUDED.category,
  supports_choice = EXCLUDED.supports_choice,
  supports_formula = EXCLUDED.supports_formula,
  difficulty = EXCLUDED.difficulty,
  description_ja = EXCLUDED.description_ja,
  description_zh = EXCLUDED.description_zh,
  blueprint_requirements = EXCLUDED.blueprint_requirements,
  is_active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
