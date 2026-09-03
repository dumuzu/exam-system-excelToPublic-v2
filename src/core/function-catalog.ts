export type FunctionMode = "choice" | "formula";

export interface FunctionDefinition {
  readonly name: string;
  readonly category: string;
  readonly modes: readonly FunctionMode[];
  readonly choiceBlueprintCount: number;
  readonly formulaBlueprintCount: number;
}

const formulaFunction = (name: string, category: string): FunctionDefinition => ({
  name,
  category,
  modes: ["choice", "formula"],
  choiceBlueprintCount: 3,
  formulaBlueprintCount: 3,
});

export const FUNCTION_CATALOG: readonly FunctionDefinition[] = Object.freeze([
  formulaFunction("SUM", "aggregate"),
  formulaFunction("AVERAGE", "aggregate"),
  formulaFunction("MAX", "aggregate"),
  formulaFunction("MIN", "aggregate"),
  formulaFunction("COUNT", "aggregate"),
  formulaFunction("COUNTA", "aggregate"),

  formulaFunction("IF", "logic"),
  formulaFunction("IFS", "logic"),
  formulaFunction("AND", "logic"),
  formulaFunction("OR", "logic"),
  formulaFunction("IFERROR", "logic"),

  formulaFunction("COUNTIF", "conditional"),
  formulaFunction("COUNTIFS", "conditional"),
  formulaFunction("SUMIF", "conditional"),
  formulaFunction("SUMIFS", "conditional"),
  formulaFunction("AVERAGEIF", "conditional"),
  formulaFunction("MAXIFS", "conditional"),
  formulaFunction("MINIFS", "conditional"),

  formulaFunction("XLOOKUP", "lookup"),

  formulaFunction("LEFT", "text"),
  formulaFunction("RIGHT", "text"),
  formulaFunction("MID", "text"),
  formulaFunction("LEN", "text"),
  formulaFunction("UPPER", "text"),
  formulaFunction("LOWER", "text"),
  formulaFunction("PROPER", "text"),
  formulaFunction("SUBSTITUTE", "text"),
  formulaFunction("VALUE", "text"),
  formulaFunction("TEXT", "text"),

  formulaFunction("ABS", "calculation"),
  formulaFunction("ROUND", "calculation"),
  formulaFunction("ROUNDUP", "calculation"),
  formulaFunction("ROUNDDOWN", "calculation"),
  formulaFunction("CEILING", "calculation"),
  formulaFunction("SUMPRODUCT", "calculation"),
  formulaFunction("MOD", "calculation"),

  formulaFunction("YEAR", "date"),
  formulaFunction("MONTH", "date"),
  formulaFunction("DAY", "date"),

  formulaFunction("FILTER", "dynamic"),
  formulaFunction("SORT", "dynamic"),
  formulaFunction("UNIQUE", "dynamic"),
]);

export const FUNCTION_BY_NAME = new Map(
  FUNCTION_CATALOG.map((functionDefinition) => [functionDefinition.name, functionDefinition]),
);
