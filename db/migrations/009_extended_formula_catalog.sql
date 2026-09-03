-- Enable date formula questions and register bounded dynamic-array functions.
-- The evaluator remains application-owned; this migration only publishes the
-- supported catalog capabilities used by the teacher configuration screen.

BEGIN;

UPDATE function_catalog
SET supports_formula = TRUE,
    blueprint_requirements = '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE function_name IN ('YEAR', 'MONTH', 'DAY');

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
  ('FILTER', 'dynamic', TRUE, TRUE, 3, '条件に合う行を動的配列として抽出します。', '将符合条件的行提取为动态数组。', '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('SORT',   'dynamic', TRUE, TRUE, 2, '配列を指定した順序で並べ替えます。',       '按指定顺序对数组排序。',           '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('UNIQUE', 'dynamic', TRUE, TRUE, 2, '配列から重複しない値を返します。',         '返回数组中的唯一值。',             '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb)
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
