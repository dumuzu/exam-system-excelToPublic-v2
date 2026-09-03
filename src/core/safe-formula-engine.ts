import { Decimal } from "decimal.js";

const ExcelDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });
const DEFAULT_LIMITS = Object.freeze({
  maxFormulaLength: 512,
  maxTokens: 512,
  maxAstDepth: 40,
  maxRangeCells: 10_000,
  maxOperations: 20_000,
});
const EXCEL_MAX_ROW = 1_048_576;

const SUPPORTED_FUNCTIONS = new Set([
  "SUM", "AVERAGE", "MAX", "MIN", "COUNT", "COUNTA", "IF", "IFS", "AND", "OR", "IFERROR",
  "COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS", "AVERAGEIF", "MAXIFS", "MINIFS", "XLOOKUP",
  "LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "PROPER", "SUBSTITUTE", "ABS", "ROUND",
  "ROUNDUP", "ROUNDDOWN", "CEILING", "SUMPRODUCT", "VALUE", "MOD", "TEXT",
  "FILTER", "SORT", "UNIQUE",
  "YEAR", "MONTH", "DAY",
]);
const CATCHABLE_SPREADSHEET_ERRORS = new Set([
  "DIVISION_BY_ZERO", "NUMBER_REQUIRED", "BOOLEAN_REQUIRED", "TEXT_REQUIRED", "REFERENCE_OUT_OF_BOUNDS",
  "RANGE_USED_AS_SCALAR", "RANGE_SIZE_MISMATCH", "RANGE_REQUIRED", "NOT_FOUND", "NO_MATCH",
  "INVALID_LENGTH", "INVALID_OCCURRENCE", "NON_FINITE_RESULT",
  "INVALID_DATE", "UNSUPPORTED_TEXT_FORMAT",
]);

class FormulaEngineError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function fail(code: string): never {
  throw new FormulaEngineError(code);
}

function tokenize(source: string, limits: any): any[] {
  const tokens: any[] = [];
  let index = 0;
  const push = (type: string, value: unknown = null): void => {
    if (tokens.length >= limits.maxTokens) fail("TOKEN_LIMIT_EXCEEDED");
    tokens.push({ type, value });
  };

  while (index < source.length) {
    const character = source[index] ?? "";
    if (/\s/.test(character)) { index += 1; continue; }

    if (character === '"') {
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '"') {
          if (source[index + 1] === '"') { value += '"'; index += 2; continue; }
          index += 1; closed = true; break;
        }
        value += source[index];
        index += 1;
      }
      if (!closed) fail("UNTERMINATED_STRING");
      push("string", value);
      continue;
    }

    const remaining = source.slice(index);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/i.exec(remaining);
    if (number) {
      try { new ExcelDecimal(number[0]); } catch { fail("INVALID_NUMBER"); }
      push("number", number[0]);
      index += number[0].length;
      continue;
    }

    const reference = /^\$?[A-Z]{1,3}\$?[1-9][0-9]*/i.exec(remaining);
    if (reference && !/[A-Z0-9_.]/i.test(remaining[reference[0].length] ?? "")) {
      push("reference", reference[0].replaceAll("$", "").toUpperCase());
      index += reference[0].length;
      continue;
    }

    const identifier = /^[A-Z_][A-Z0-9_.]*/i.exec(remaining);
    if (identifier) {
      push("identifier", identifier[0].toUpperCase());
      index += identifier[0].length;
      continue;
    }

    const doubleOperator = ["<=", ">=", "<>"].find((operator) => remaining.startsWith(operator));
    if (doubleOperator) { push("operator", doubleOperator); index += 2; continue; }
    if ("+-*/^&=<>:".includes(character)) { push("operator", character); index += 1; continue; }
    if (character === "(") { push("leftParen"); index += 1; continue; }
    if (character === ")") { push("rightParen"); index += 1; continue; }
    if (character === ",") { push("comma"); index += 1; continue; }
    if (character === "#") { push("spill"); index += 1; continue; }
    fail("INVALID_CHARACTER");
  }
  push("eof");
  return tokens;
}

const PRECEDENCE = Object.freeze({ "=": 1, "<>": 1, "<": 1, "<=": 1, ">": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5, ":": 6 });

function parse(tokens: any[], limits: any): any {
  let index = 0;
  const peek = () => tokens[index];
  const take = (type: string): any => {
    const token = tokens[index];
    if (token.type !== type) fail("UNEXPECTED_TOKEN");
    index += 1;
    return token;
  };

  function expression(minimumPrecedence = 0, depth = 0): any {
    if (depth > limits.maxAstDepth) fail("AST_DEPTH_EXCEEDED");
    let left;
    const token = peek();
    if (token.type === "operator" && ["+", "-"].includes(token.value)) {
      index += 1;
      left = { type: "unary", operator: token.value, argument: expression(6, depth + 1) };
    } else if (token.type === "number" || token.type === "string") {
      index += 1;
      left = { type: "literal", value: token.value, numeric: token.type === "number" };
    } else if (token.type === "reference") {
      index += 1;
      left = { type: "reference", reference: token.value };
    } else if (token.type === "identifier") {
      index += 1;
      if (token.value === "TRUE" || token.value === "FALSE") {
        left = { type: "literal", value: token.value === "TRUE" };
      } else {
        if (peek().type === "leftParen") {
          take("leftParen");
          const args: any[] = [];
          if (peek().type !== "rightParen") {
            while (true) {
              args.push(expression(0, depth + 1));
              if (peek().type !== "comma") break;
              take("comma");
            }
          }
          take("rightParen");
          left = { type: "call", name: token.value, args };
        } else {
          left = { type: "name", name: token.value };
        }
      }
    } else if (token.type === "leftParen") {
      take("leftParen");
      left = expression(0, depth + 1);
      take("rightParen");
    } else {
      fail("EXPECTED_EXPRESSION");
    }

    if (peek().type === "spill") {
      if (left.type !== "reference") fail("INVALID_SPILL_REFERENCE");
      index += 1;
      left = { type: "spill", anchor: left.reference };
    }

    while (peek().type === "operator") {
      const operator = peek().value;
      const precedence = (PRECEDENCE as Readonly<Record<string, number>>)[operator];
      if (precedence === undefined || precedence < minimumPrecedence) break;
      index += 1;
      const right = expression(operator === "^" ? precedence : precedence + 1, depth + 1);
      if (operator === ":") {
        if (left.type === "reference" && right.type === "reference") {
          left = { type: "range", start: left.reference, end: right.reference };
        } else if (
          left.type === "name" && right.type === "name"
          && /^[A-Z]{1,3}$/.test(left.name) && /^[A-Z]{1,3}$/.test(right.name)
        ) {
          left = { type: "wholeColumn", start: left.name, end: right.name };
        } else {
          fail("INVALID_RANGE");
        }
      } else {
        left = { type: "binary", operator, left, right };
      }
    }
    return left;
  }

  const ast = expression();
  if (peek().type !== "eof") fail("TRAILING_INPUT");
  return ast;
}

function columnIndex(letters: string): number {
  let result = 0;
  for (const character of letters) result = result * 26 + character.charCodeAt(0) - 64;
  return result - 1;
}

function parseReference(reference: string): { column: number; row: number } {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(reference);
  if (!match) fail("INVALID_REFERENCE");
  const row = Number(match[2]!);
  if (!Number.isSafeInteger(row) || row > EXCEL_MAX_ROW) fail("REFERENCE_OUT_OF_BOUNDS");
  return { column: columnIndex(match[1]!), row };
}

function createRange(values: any[], rowCount: number, columnCount: number): any {
  return { kind: "range", values, rowCount, columnCount };
}

function isRange(value: any): boolean {
  return Boolean(value && typeof value === "object" && value.kind === "range");
}

function isDecimal(value: any): boolean {
  return value instanceof ExcelDecimal;
}

function isCatchableSpreadsheetError(error: unknown): boolean {
  return error instanceof FormulaEngineError && CATCHABLE_SPREADSHEET_ERRORS.has(error.code);
}

function evaluate(ast: any, table: any, limits: any): any {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) fail("INVALID_TABLE");
  let operationCount = 0;
  const tick = (amount: number = 1): void => {
    operationCount += amount;
    if (operationCount > limits.maxOperations) fail("OPERATION_LIMIT_EXCEEDED");
  };

  const readCell = (reference: string): any => {
    tick();
    const { column, row } = parseReference(reference);
    if (column < 0 || column >= table.columns.length) fail("REFERENCE_OUT_OF_BOUNDS");
    if (row === 1) return table.columns[column];
    if (row - 2 >= table.rows.length) return null;
    const record = table.rows[row - 2];
    const value = record?.[table.columns[column]] ?? null;
    return typeof value === "number" && Number.isFinite(value) ? new ExcelDecimal(String(value)) : value;
  };

  const readRange = (start: string, end: string): any => {
    const first = parseReference(start);
    const last = parseReference(end);
    if (first.column > last.column || first.row > last.row) fail("INVALID_RANGE");
    if (first.column < 0 || last.column >= table.columns.length) fail("REFERENCE_OUT_OF_BOUNDS");
    const rowCount = last.row - first.row + 1;
    const columnCount = last.column - first.column + 1;
    if (rowCount * columnCount > limits.maxRangeCells) fail("RANGE_LIMIT_EXCEEDED");
    const values: any[] = [];
    for (let row = first.row; row <= last.row; row += 1) {
      for (let column = first.column; column <= last.column; column += 1) {
        const letters = [];
        let number = column + 1;
        while (number > 0) { number -= 1; letters.unshift(String.fromCharCode(65 + (number % 26))); number = Math.floor(number / 26); }
        values.push(readCell(`${letters.join("")}${row}`));
      }
    }
    return createRange(values, rowCount, columnCount);
  };

  const readDeclaredRange = (declaration: unknown, invalidCode: string): any => {
    const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)(?::\$?([A-Z]{1,3})\$?([1-9][0-9]*))?$/i.exec(String(declaration).trim());
    if (!match) fail(invalidCode);
    const start = `${match[1]!.toUpperCase()}${match[2]}`;
    const end = `${(match[3] ?? match[1])!.toUpperCase()}${match[4] ?? match[2]}`;
    return readRange(start, end);
  };

  const readNamedRange = (name: string): any => {
    const entry = Object.entries(table.namedRanges ?? {}).find(([candidate]) => candidate.toUpperCase() === name);
    if (!entry || typeof entry[1] !== "string") fail("UNKNOWN_NAME");
    return readDeclaredRange(entry[1], "INVALID_NAMED_RANGE");
  };

  const readSpillRange = (anchor: string): any => {
    const entry = Object.entries(table.spillRanges ?? {}).find(([candidate]) => candidate.replaceAll("$", "").toUpperCase() === anchor);
    if (!entry || typeof entry[1] !== "string") fail("UNKNOWN_SPILL_RANGE");
    return readDeclaredRange(entry[1], "INVALID_SPILL_RANGE");
  };

  const scalar = (value: any): any => {
    if (isRange(value)) fail("RANGE_USED_AS_SCALAR");
    return value;
  };
  const number = (value: any): any => {
    value = scalar(value);
    if (isDecimal(value)) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new ExcelDecimal(String(value));
    if (typeof value === "boolean") return new ExcelDecimal(value ? 1 : 0);
    if (value === null) return new ExcelDecimal(0);
    fail("NUMBER_REQUIRED");
  };
  const boolean = (value: any): boolean => {
    value = scalar(value);
    if (typeof value === "boolean") return value;
    if (isDecimal(value)) return !value.isZero();
    if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
    if (typeof value === "string" && /^(TRUE|FALSE)$/i.test(value)) return value.toUpperCase() === "TRUE";
    fail("BOOLEAN_REQUIRED");
  };
  const text = (value: any): string => {
    value = scalar(value);
    if (value === null) return "";
    if (isDecimal(value)) return value.toString();
    if (["string", "number", "boolean"].includes(typeof value)) return String(value);
    fail("TEXT_REQUIRED");
  };
  const valueFromText = (value: any): any => {
    const source = text(value).normalize("NFKC").trim();
    const percent = source.endsWith("%");
    const normalized = (percent ? source.slice(0, -1) : source).replaceAll(",", "").trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) fail("NUMBER_REQUIRED");
    const parsed = new ExcelDecimal(normalized);
    return percent ? parsed.dividedBy(100) : parsed;
  };
  const values = (items: any[]): any[] => items.flatMap((item: any) => isRange(item) ? item.values : [item]);
  const comparable = (value: any): any => typeof value === "string"
    ? value.normalize("NFKC").toLocaleLowerCase("en-US")
    : value;
  const equal = (left: any, right: any): boolean => {
    if (isDecimal(left) || isDecimal(right)) {
      try { return number(left).equals(number(right)); } catch { return false; }
    }
    return comparable(left) === comparable(right);
  };
  const compare = (left: any, right: any, operator: string): boolean => {
    left = scalar(left); right = scalar(right);
    if (operator === "=") return equal(left, right);
    if (operator === "<>") return !equal(left, right);
    if (isDecimal(left) || isDecimal(right)) {
      const order = number(left).comparedTo(number(right));
      if (operator === "<") return order < 0;
      if (operator === "<=") return order <= 0;
      if (operator === ">") return order > 0;
      if (operator === ">=") return order >= 0;
    }
    const a = comparable(left); const b = comparable(right);
    if (operator === "<") return a < b;
    if (operator === "<=") return a <= b;
    if (operator === ">") return a > b;
    if (operator === ">=") return a >= b;
    fail("INVALID_OPERATOR");
  };

  const criteriaPredicate = (criterion: any): ((value: any) => boolean) => {
    criterion = scalar(criterion);
    if (typeof criterion !== "string") return (value: any) => equal(value, criterion);
    const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criterion);
    const operator = match?.[1] ?? "=";
    let operand: any = match?.[2] ?? criterion;
    const trimmed = operand.trim();
    if (trimmed !== "" && Number.isFinite(Number(trimmed))) operand = new ExcelDecimal(trimmed);
    else if (/^(TRUE|FALSE)$/i.test(trimmed)) operand = trimmed.toUpperCase() === "TRUE";
    if (operator === "=" && typeof operand === "string" && /[*?]/.test(operand)) {
      const escaped = operand.normalize("NFKC").replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
      const pattern = new RegExp(`^${escaped}$`, "i");
      return (value: any) => pattern.test(text(value).normalize("NFKC"));
    }
    return (value: any) => compare(value, operand, operator);
  };

  const numericItems = (args: any[]): any[] => values(args).filter((value: any) => isDecimal(value));
  const requireArgs = (name: string, args: any[], minimum: number, maximum: number = minimum): void => {
    if (args.length < minimum || args.length > maximum) fail(`${name}_ARGUMENT_COUNT`);
  };
  const roundAt = (value: any, digits: any, mode: string): any => {
    value = number(value); digits = number(digits).truncated().toNumber();
    if (digits < -15 || digits > 15) fail("ROUND_DIGITS_OUT_OF_RANGE");
    const rounding = mode === "nearest" ? ExcelDecimal.ROUND_HALF_UP : mode === "up" ? ExcelDecimal.ROUND_UP : ExcelDecimal.ROUND_DOWN;
    if (digits >= 0) return value.toDecimalPlaces(digits, rounding);
    const factor = new ExcelDecimal(10).pow(-digits);
    return value.dividedBy(factor).toDecimalPlaces(0, rounding).times(factor);
  };

  const dateParts = (value: any): { year: number; month: number; day: number } => {
    value = scalar(value);
    let date: Date;
    if (isDecimal(value)) {
      const serial = value.truncated().toNumber();
      if (!Number.isSafeInteger(serial) || serial < 1 || serial > 2_958_465) fail("INVALID_DATE");
      date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    } else if (typeof value === "string") {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (!match) fail("INVALID_DATE");
      const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
      date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail("INVALID_DATE");
    } else {
      fail("INVALID_DATE");
    }
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  };
  const formattedNumber = (value: any, decimals: number, minimumIntegerDigits: number, grouped: boolean): string => {
    const fixed = number(value).toDecimalPlaces(decimals, ExcelDecimal.ROUND_HALF_UP).toFixed(decimals);
    const negative = fixed.startsWith("-");
    const [rawInteger, fraction] = (negative ? fixed.slice(1) : fixed).split(".");
    let integer = (rawInteger ?? "").padStart(minimumIntegerDigits, "0");
    if (grouped) integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${negative ? "-" : ""}${integer}${fraction === undefined ? "" : `.${fraction}`}`;
  };
  const formatTextValue = (value: any, formatValue: any): string => {
    const format = text(formatValue).normalize("NFKC");
    const zeroFormat = /^(0+)(?:\.(0+))?$/.exec(format);
    if (zeroFormat) return formattedNumber(value, zeroFormat[2]?.length ?? 0, zeroFormat[1]!.length, false);
    const groupedFormat = /^#,##0(?:\.(0+))?$/.exec(format);
    if (groupedFormat) return formattedNumber(value, groupedFormat[1]?.length ?? 0, 1, true);
    if (["yyyy", "yyyy-mm-dd", "yyyy/mm/dd", "yyyy年m月d日"].includes(format)) {
      const { year, month, day } = dateParts(value);
      if (format === "yyyy") return String(year);
      if (format === "yyyy年m月d日") return `${year}年${month}月${day}日`;
      const separator = format.includes("/") ? "/" : "-";
      return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join(separator);
    }
    fail("UNSUPPORTED_TEXT_FORMAT");
  };

  const scalarBinary = (left: any, right: any, operator: string): any => {
    if (["=", "<>", "<", "<=", ">", ">="].includes(operator)) return compare(left, right, operator);
    if (operator === "&") return `${text(left)}${text(right)}`;
    const a = number(left); const b = number(right);
    if (operator === "+") return a.plus(b);
    if (operator === "-") return a.minus(b);
    if (operator === "*") return a.times(b);
    if (operator === "/") { if (b.isZero()) fail("DIVISION_BY_ZERO"); return a.dividedBy(b); }
    if (operator === "^") {
      const exponent = b.toNumber();
      if (!Number.isFinite(exponent) || Math.abs(exponent) > 100) fail("POWER_LIMIT_EXCEEDED");
      try { return a.pow(exponent); } catch { fail("NON_FINITE_RESULT"); }
    }
    fail("INVALID_OPERATOR");
  };

  const binary = (left: any, right: any, operator: string): any => {
    if (!isRange(left) && !isRange(right)) return scalarBinary(left, right, operator);
    if (isRange(left) && isRange(right)
      && (left.rowCount !== right.rowCount || left.columnCount !== right.columnCount)) fail("RANGE_SIZE_MISMATCH");
    const shape = isRange(left) ? left : right;
    tick(shape.values.length);
    const values = shape.values.map((_: any, index: number) => scalarBinary(
      isRange(left) ? left.values[index] : left,
      isRange(right) ? right.values[index] : right,
      operator,
    ));
    return createRange(values, shape.rowCount, shape.columnCount);
  };

  function node(current: any, depth = 0): any {
    tick();
    if (depth > limits.maxAstDepth) fail("AST_DEPTH_EXCEEDED");
    if (current.type === "literal") return current.numeric ? new ExcelDecimal(current.value) : current.value;
    if (current.type === "reference") return readCell(current.reference);
    if (current.type === "range") return readRange(current.start, current.end);
    if (current.type === "wholeColumn") return readRange(`${current.start}1`, `${current.end}${table.rows.length + 1}`);
    if (current.type === "name") return readNamedRange(current.name);
    if (current.type === "spill") return readSpillRange(current.anchor);
    if (current.type === "unary") return current.operator === "-" ? number(node(current.argument, depth + 1)).negated() : number(node(current.argument, depth + 1));
    if (current.type === "binary") {
      const left: any = node(current.left, depth + 1); const right: any = node(current.right, depth + 1);
      return binary(left, right, current.operator);
    }
    if (current.type !== "call") fail("INVALID_AST");
    const name = current.name;
    if (!SUPPORTED_FUNCTIONS.has(name)) fail("UNSUPPORTED_FUNCTION");

    if (name === "IF") {
      requireArgs(name, current.args, 2, 3);
      return boolean(node(current.args[0], depth + 1)) ? node(current.args[1], depth + 1) : current.args[2] ? node(current.args[2], depth + 1) : false;
    }
    if (name === "IFS") {
      if (current.args.length < 2 || current.args.length % 2 !== 0) fail("IFS_ARGUMENT_COUNT");
      for (let index = 0; index < current.args.length; index += 2) if (boolean(node(current.args[index], depth + 1))) return node(current.args[index + 1], depth + 1);
      fail("NO_MATCH");
    }
    if (name === "IFERROR") {
      requireArgs(name, current.args, 2);
      try { return node(current.args[0], depth + 1); } catch (error) { if (!isCatchableSpreadsheetError(error)) throw error; return node(current.args[1], depth + 1); }
    }

    const args: any[] = current.args.map((argument: any) => node(argument, depth + 1));
    if (name === "FILTER") {
      requireArgs(name, args, 2, 3);
      const source = args[0]; const include = args[1];
      if (!isRange(source) || !isRange(include) || include.columnCount !== 1 || include.rowCount !== source.rowCount) fail("RANGE_SIZE_MISMATCH");
      const selectedRows: any[][] = [];
      for (let row = 0; row < source.rowCount; row += 1) {
        if (boolean(include.values[row])) {
          const offset = row * source.columnCount;
          selectedRows.push(source.values.slice(offset, offset + source.columnCount));
        }
      }
      tick(source.rowCount);
      if (!selectedRows.length) {
        if (args.length === 3) return scalar(args[2]);
        fail("NO_MATCH");
      }
      return createRange(selectedRows.flat(), selectedRows.length, source.columnCount);
    }
    if (name === "SORT") {
      requireArgs(name, args, 1, 3);
      const source = args[0];
      if (!isRange(source)) fail("RANGE_REQUIRED");
      const sortIndex = args[1] === undefined ? 1 : number(args[1]).truncated().toNumber();
      const sortOrder = args[2] === undefined ? 1 : number(args[2]).truncated().toNumber();
      if (sortIndex < 1 || sortIndex > source.columnCount || ![-1, 1].includes(sortOrder)) fail("INVALID_SORT_ARGUMENT");
      const rows = Array.from({ length: source.rowCount }, (_, row) => source.values.slice(row * source.columnCount, (row + 1) * source.columnCount));
      rows.sort((left, right) => {
        tick();
        const a = left[sortIndex - 1]; const b = right[sortIndex - 1];
        if (equal(a, b)) return 0;
        if (isDecimal(a) || isDecimal(b)) return number(a).comparedTo(number(b)) * sortOrder;
        return String(a ?? "").localeCompare(String(b ?? ""), "en", { numeric: true, sensitivity: "base" }) * sortOrder;
      });
      tick(source.rowCount);
      return createRange(rows.flat(), source.rowCount, source.columnCount);
    }
    if (name === "UNIQUE") {
      requireArgs(name, args, 1);
      const source = args[0];
      if (!isRange(source)) fail("RANGE_REQUIRED");
      const rows: any[][] = [];
      for (let row = 0; row < source.rowCount; row += 1) {
        const candidate = source.values.slice(row * source.columnCount, (row + 1) * source.columnCount);
        tick(Math.max(1, rows.length));
        if (!rows.some((existing: any[]) => existing.every((value: any, index: number) => equal(value, candidate[index])))) rows.push(candidate);
      }
      tick(source.rowCount);
      return createRange(rows.flat(), rows.length, source.columnCount);
    }
    if (["YEAR", "MONTH", "DAY"].includes(name)) {
      requireArgs(name, args, 1);
      const parts = dateParts(args[0]);
      return new ExcelDecimal(name === "YEAR" ? parts.year : name === "MONTH" ? parts.month : parts.day);
    }
    if (name === "VALUE") { requireArgs(name, args, 1); return valueFromText(args[0]); }
    if (name === "MOD") {
      requireArgs(name, args, 2);
      const dividend = number(args[0]); const divisor = number(args[1]);
      if (divisor.isZero()) fail("DIVISION_BY_ZERO");
      return dividend.minus(divisor.times(dividend.dividedBy(divisor).floor()));
    }
    if (name === "TEXT") { requireArgs(name, args, 2); return formatTextValue(args[0], args[1]); }
    if (name === "SUM") return numericItems(args).reduce((total: any, value: any) => total.plus(value), new ExcelDecimal(0));
    if (name === "AVERAGE") { const items = numericItems(args); if (!items.length) fail("DIVISION_BY_ZERO"); return items.reduce((total: any, value: any) => total.plus(value), new ExcelDecimal(0)).dividedBy(items.length); }
    if (name === "MAX" || name === "MIN") { const items = numericItems(args); return items.length ? items.reduce((best: any, value: any) => name === "MAX" ? ExcelDecimal.max(best, value) : ExcelDecimal.min(best, value)) : new ExcelDecimal(0); }
    if (name === "COUNT") return new ExcelDecimal(numericItems(args).length);
    if (name === "COUNTA") return new ExcelDecimal(values(args).filter((value: any) => value !== null && value !== "").length);
    if (name === "AND" || name === "OR") {
      const conditions = values(args).map(boolean);
      if (!conditions.length) fail(`${name}_ARGUMENT_COUNT`);
      return name === "AND" ? conditions.every(Boolean) : conditions.some(Boolean);
    }
    if (name === "COUNTIF") {
      requireArgs(name, args, 2); if (!isRange(args[0])) fail("RANGE_REQUIRED");
      const matches = criteriaPredicate(args[1]); return new ExcelDecimal(args[0].values.filter(matches).length);
    }
    if (name === "COUNTIFS") {
      if (args.length < 2 || args.length % 2 !== 0) fail("COUNTIFS_ARGUMENT_COUNT");
      const pairs: Array<[any, (value: any) => boolean]> = [];
      for (let index = 0; index < args.length; index += 2) { if (!isRange(args[index])) fail("RANGE_REQUIRED"); pairs.push([args[index], criteriaPredicate(args[index + 1])]); }
      const length = pairs[0]![0].values.length;
      if (pairs.some(([range]) => range.values.length !== length)) fail("RANGE_SIZE_MISMATCH");
      return new ExcelDecimal(Array.from({ length }, (_, index) => pairs.every(([range, matches]) => matches(range.values[index]))).filter(Boolean).length);
    }
    if (name === "SUMIF" || name === "AVERAGEIF") {
      requireArgs(name, args, 2, 3); if (!isRange(args[0])) fail("RANGE_REQUIRED");
      const target = args[2] ?? args[0]; if (!isRange(target) || target.values.length !== args[0].values.length) fail("RANGE_SIZE_MISMATCH");
      const matches = criteriaPredicate(args[1]);
      const selected: any[] = target.values.filter((_: any, index: number) => matches(args[0].values[index])).filter(isDecimal);
      if (name === "AVERAGEIF" && !selected.length) fail("DIVISION_BY_ZERO");
      const total = selected.reduce((sum: any, value: any) => sum.plus(value), new ExcelDecimal(0));
      return name === "SUMIF" ? total : total.dividedBy(selected.length);
    }
    if (["SUMIFS", "MAXIFS", "MINIFS"].includes(name)) {
      if (args.length < 3 || args.length % 2 !== 1 || !isRange(args[0])) fail(`${name}_ARGUMENT_COUNT`);
      const target = args[0]; const pairs: Array<[any, (value: any) => boolean]> = [];
      for (let index = 1; index < args.length; index += 2) { if (!isRange(args[index]) || args[index].values.length !== target.values.length) fail("RANGE_SIZE_MISMATCH"); pairs.push([args[index], criteriaPredicate(args[index + 1])]); }
      const selected: any[] = target.values.filter((_: any, index: number) => pairs.every(([range, matches]) => matches(range.values[index]))).filter(isDecimal);
      if (name !== "SUMIFS" && !selected.length) fail("NO_MATCH");
      if (name === "SUMIFS") return selected.reduce((sum: any, value: any) => sum.plus(value), new ExcelDecimal(0));
      return selected.reduce((best: any, value: any) => name === "MAXIFS" ? ExcelDecimal.max(best, value) : ExcelDecimal.min(best, value));
    }
    if (name === "XLOOKUP") {
      requireArgs(name, args, 3, 4); if (!isRange(args[1]) || !isRange(args[2]) || args[1].values.length !== args[2].values.length) fail("RANGE_SIZE_MISMATCH");
      const found = args[1].values.findIndex((value: any) => equal(value, scalar(args[0])));
      if (found < 0) { if (args.length === 4) return scalar(args[3]); fail("NOT_FOUND"); }
      return args[2].values[found];
    }
    if (name === "LEFT" || name === "RIGHT") {
      requireArgs(name, args, 1, 2); const source = text(args[0]); const count = args[1] === undefined ? 1 : number(args[1]).truncated().toNumber(); if (count < 0) fail("INVALID_LENGTH");
      return name === "LEFT" ? source.slice(0, count) : source.slice(Math.max(0, source.length - count));
    }
    if (name === "MID") { requireArgs(name, args, 3); const start = number(args[1]).truncated().toNumber(); const count = number(args[2]).truncated().toNumber(); if (start < 1 || count < 0) fail("INVALID_LENGTH"); return text(args[0]).slice(start - 1, start - 1 + count); }
    if (name === "LEN") { requireArgs(name, args, 1); return new ExcelDecimal(text(args[0]).length); }
    if (name === "UPPER" || name === "LOWER") { requireArgs(name, args, 1); return text(args[0])[name === "UPPER" ? "toUpperCase" : "toLowerCase"](); }
    if (name === "PROPER") { requireArgs(name, args, 1); return text(args[0]).toLowerCase().replace(/(^|[^A-Z0-9])([A-Z])/gi, (_: string, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`); }
    if (name === "SUBSTITUTE") { requireArgs(name, args, 3, 4); const source = text(args[0]); const oldText = text(args[1]); const replacement = text(args[2]); if (!oldText) return source; if (args[3] === undefined) return source.split(oldText).join(replacement); const occurrence = number(args[3]).truncated().toNumber(); if (occurrence < 1) fail("INVALID_OCCURRENCE"); let seen = 0; return source.replaceAll(oldText, (match: string) => (++seen === occurrence ? replacement : match)); }
    if (name === "ABS") { requireArgs(name, args, 1); return number(args[0]).abs(); }
    if (name === "ROUND") { requireArgs(name, args, 2); return roundAt(args[0], args[1], "nearest"); }
    if (name === "ROUNDUP") { requireArgs(name, args, 2); return roundAt(args[0], args[1], "up"); }
    if (name === "ROUNDDOWN") { requireArgs(name, args, 2); return roundAt(args[0], args[1], "down"); }
    if (name === "CEILING") { requireArgs(name, args, 2); const value = number(args[0]); const significance = number(args[1]).abs(); if (significance.isZero()) return new ExcelDecimal(0); return value.dividedBy(significance).ceil().times(significance); }
    if (name === "SUMPRODUCT") {
      if (!args.length || args.some((argument: any) => !isRange(argument))) fail("RANGE_REQUIRED");
      const length = args[0].values.length; if (args.some((argument: any) => argument.values.length !== length)) fail("RANGE_SIZE_MISMATCH");
      return Array.from({ length }, (_: unknown, index: number) => args.reduce((product: any, range: any) => product.times(number(range.values[index])), new ExcelDecimal(1))).reduce((sum: any, value: any) => sum.plus(value), new ExcelDecimal(0));
    }
    fail("UNSUPPORTED_FUNCTION");
  }

  const result = node(ast);
  const ensureFinite = (value: any): void => {
    if (isDecimal(value) && (!value.isFinite() || !Number.isFinite(value.toNumber()))) fail("NON_FINITE_RESULT");
    if (isRange(value)) value.values.forEach(ensureFinite);
  };
  ensureFinite(result);
  return result;
}

function publicValue(value: any): unknown {
  if (isRange(value)) {
    const items = value.values.map(publicValue);
    if (value.columnCount === 1) return items;
    return Array.from({ length: value.rowCount }, (_, row) => items.slice(row * value.columnCount, (row + 1) * value.columnCount));
  }
  return isDecimal(value) ? value.toNumber() : value;
}

function exactValue(value: any): unknown {
  if (isRange(value)) {
    const items = value.values.map(exactValue);
    if (value.columnCount === 1) return items;
    return Array.from({ length: value.rowCount }, (_, row) => items.slice(row * value.columnCount, (row + 1) * value.columnCount));
  }
  return isDecimal(value) ? value.toString() : value;
}

function collectFunctions(ast: any, target: Set<string> = new Set()): Set<string> {
  if (ast.type === "call") { target.add(ast.name); for (const arg of ast.args) collectFunctions(arg, target); }
  else if (ast.type === "binary") { collectFunctions(ast.left, target); collectFunctions(ast.right, target); }
  else if (ast.type === "unary") collectFunctions(ast.argument, target);
  return target;
}

export interface FormulaTable {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface FormulaEngineLimits {
  readonly maxFormulaLength?: number;
  readonly maxTokens?: number;
  readonly maxAstDepth?: number;
  readonly maxRangeCells?: number;
  readonly maxOperations?: number;
}

export type FormulaEvaluationResult =
  | { readonly ok: true; readonly value: unknown; readonly exactValue: unknown; readonly functions: Set<string>; readonly errorCode: null }
  | { readonly ok: false; readonly value: null; readonly exactValue: null; readonly functions: Set<string>; readonly errorCode: string };

export function evaluateExcelFormula({ formula, table, limits: limitOverrides = {} }: {
  formula: unknown;
  table: FormulaTable;
  limits?: FormulaEngineLimits;
}): FormulaEvaluationResult {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  try {
    if (typeof formula !== "string" || formula.length > limits.maxFormulaLength) fail("FORMULA_LENGTH_INVALID");
    const normalisedFormula = formula.normalize("NFKC");
    if (normalisedFormula.length > limits.maxFormulaLength) fail("FORMULA_LENGTH_INVALID");
    const trimmed = normalisedFormula.trim();
    if (!trimmed.startsWith("=") || trimmed.length === 1) fail("FORMULA_PREFIX_REQUIRED");
    const tokens = tokenize(trimmed.slice(1), limits);
    const ast = parse(tokens, limits);
    const functions = collectFunctions(ast);
    for (const name of functions) if (!SUPPORTED_FUNCTIONS.has(name)) fail("UNSUPPORTED_FUNCTION");
    const evaluated = evaluate(ast, table, limits);
    return { ok: true, value: publicValue(evaluated), exactValue: exactValue(evaluated), functions, errorCode: null };
  } catch (error) {
    if (!(error instanceof FormulaEngineError)) throw error;
    return { ok: false, value: null, exactValue: null, functions: new Set(), errorCode: error.code };
  }
}

export function listSupportedFormulaFunctions(): string[] {
  return [...SUPPORTED_FUNCTIONS];
}
