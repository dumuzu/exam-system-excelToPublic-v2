-- Keep the durable catalog aligned with every function the TypeScript
-- composition engine can publish. Historical environments may only contain
-- functions introduced by migrations 009 and 013, so this seed is idempotent.

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
  ('SUM',         'aggregate',   TRUE, TRUE, 1, 'SUM 関数を試験で使用できます。',         '考试可使用 SUM 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('AVERAGE',     'aggregate',   TRUE, TRUE, 1, 'AVERAGE 関数を試験で使用できます。',     '考试可使用 AVERAGE 函数。',     '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MAX',         'aggregate',   TRUE, TRUE, 1, 'MAX 関数を試験で使用できます。',         '考试可使用 MAX 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MIN',         'aggregate',   TRUE, TRUE, 1, 'MIN 関数を試験で使用できます。',         '考试可使用 MIN 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('COUNT',       'aggregate',   TRUE, TRUE, 1, 'COUNT 関数を試験で使用できます。',       '考试可使用 COUNT 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('COUNTA',      'aggregate',   TRUE, TRUE, 1, 'COUNTA 関数を試験で使用できます。',      '考试可使用 COUNTA 函数。',      '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('IF',          'logic',       TRUE, TRUE, 2, 'IF 関数を試験で使用できます。',          '考试可使用 IF 函数。',          '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('IFS',         'logic',       TRUE, TRUE, 2, 'IFS 関数を試験で使用できます。',         '考试可使用 IFS 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('AND',         'logic',       TRUE, TRUE, 2, 'AND 関数を試験で使用できます。',         '考试可使用 AND 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('OR',          'logic',       TRUE, TRUE, 2, 'OR 関数を試験で使用できます。',          '考试可使用 OR 函数。',          '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('IFERROR',     'logic',       TRUE, TRUE, 2, 'IFERROR 関数を試験で使用できます。',     '考试可使用 IFERROR 函数。',     '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('COUNTIF',     'conditional', TRUE, TRUE, 2, 'COUNTIF 関数を試験で使用できます。',     '考试可使用 COUNTIF 函数。',     '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('COUNTIFS',    'conditional', TRUE, TRUE, 3, 'COUNTIFS 関数を試験で使用できます。',    '考试可使用 COUNTIFS 函数。',    '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('SUMIF',       'conditional', TRUE, TRUE, 2, 'SUMIF 関数を試験で使用できます。',       '考试可使用 SUMIF 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('SUMIFS',      'conditional', TRUE, TRUE, 3, 'SUMIFS 関数を試験で使用できます。',      '考试可使用 SUMIFS 函数。',      '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('AVERAGEIF',   'conditional', TRUE, TRUE, 2, 'AVERAGEIF 関数を試験で使用できます。',   '考试可使用 AVERAGEIF 函数。',   '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MAXIFS',      'conditional', TRUE, TRUE, 3, 'MAXIFS 関数を試験で使用できます。',      '考试可使用 MAXIFS 函数。',      '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MINIFS',      'conditional', TRUE, TRUE, 3, 'MINIFS 関数を試験で使用できます。',      '考试可使用 MINIFS 函数。',      '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('XLOOKUP',     'lookup',      TRUE, TRUE, 3, 'XLOOKUP 関数を試験で使用できます。',     '考试可使用 XLOOKUP 函数。',     '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('LEFT',        'text',        TRUE, TRUE, 1, 'LEFT 関数を試験で使用できます。',        '考试可使用 LEFT 函数。',        '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('RIGHT',       'text',        TRUE, TRUE, 1, 'RIGHT 関数を試験で使用できます。',       '考试可使用 RIGHT 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MID',         'text',        TRUE, TRUE, 2, 'MID 関数を試験で使用できます。',         '考试可使用 MID 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('LEN',         'text',        TRUE, TRUE, 1, 'LEN 関数を試験で使用できます。',         '考试可使用 LEN 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('UPPER',       'text',        TRUE, TRUE, 1, 'UPPER 関数を試験で使用できます。',       '考试可使用 UPPER 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('LOWER',       'text',        TRUE, TRUE, 1, 'LOWER 関数を試験で使用できます。',       '考试可使用 LOWER 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('PROPER',      'text',        TRUE, TRUE, 2, 'PROPER 関数を試験で使用できます。',      '考试可使用 PROPER 函数。',      '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('SUBSTITUTE',  'text',        TRUE, TRUE, 2, 'SUBSTITUTE 関数を試験で使用できます。',  '考试可使用 SUBSTITUTE 函数。',  '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('VALUE',       'text',        TRUE, TRUE, 1, 'VALUE 関数を試験で使用できます。',       '考试可使用 VALUE 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('TEXT',        'text',        TRUE, TRUE, 2, 'TEXT 関数を試験で使用できます。',        '考试可使用 TEXT 函数。',        '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('ABS',         'calculation', TRUE, TRUE, 1, 'ABS 関数を試験で使用できます。',         '考试可使用 ABS 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('ROUND',       'calculation', TRUE, TRUE, 1, 'ROUND 関数を試験で使用できます。',       '考试可使用 ROUND 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('ROUNDUP',     'calculation', TRUE, TRUE, 2, 'ROUNDUP 関数を試験で使用できます。',     '考试可使用 ROUNDUP 函数。',     '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('ROUNDDOWN',   'calculation', TRUE, TRUE, 2, 'ROUNDDOWN 関数を試験で使用できます。',   '考试可使用 ROUNDDOWN 函数。',   '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('CEILING',     'calculation', TRUE, TRUE, 2, 'CEILING 関数を試験で使用できます。',     '考试可使用 CEILING 函数。',     '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('SUMPRODUCT',  'calculation', TRUE, TRUE, 3, 'SUMPRODUCT 関数を試験で使用できます。',  '考试可使用 SUMPRODUCT 函数。',  '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MOD',         'calculation', TRUE, TRUE, 1, 'MOD 関数を試験で使用できます。',         '考试可使用 MOD 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('YEAR',        'date',        TRUE, TRUE, 1, 'YEAR 関数を試験で使用できます。',        '考试可使用 YEAR 函数。',        '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('MONTH',       'date',        TRUE, TRUE, 1, 'MONTH 関数を試験で使用できます。',       '考试可使用 MONTH 函数。',       '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('DAY',         'date',        TRUE, TRUE, 1, 'DAY 関数を試験で使用できます。',         '考试可使用 DAY 函数。',         '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('FILTER',      'dynamic',     TRUE, TRUE, 3, 'FILTER 関数を試験で使用できます。',      '考试可使用 FILTER 函数。',      '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('SORT',        'dynamic',     TRUE, TRUE, 2, 'SORT 関数を試験で使用できます。',        '考试可使用 SORT 函数。',        '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb),
  ('UNIQUE',      'dynamic',     TRUE, TRUE, 2, 'UNIQUE 関数を試験で使用できます。',      '考试可使用 UNIQUE 函数。',      '{"minimum_choice_blueprints":3,"minimum_formula_blueprints":3}'::jsonb)
ON CONFLICT (function_name) DO UPDATE SET
  category = EXCLUDED.category,
  supports_choice = EXCLUDED.supports_choice,
  supports_formula = EXCLUDED.supports_formula,
  blueprint_requirements = EXCLUDED.blueprint_requirements,
  is_active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO schema_migrations (version, filename, description)
VALUES (26, '026_complete_function_catalog.sql', 'Complete application function catalog');

COMMIT;
