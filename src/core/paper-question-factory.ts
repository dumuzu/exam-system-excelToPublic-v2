import { createHash } from "node:crypto";

import {
  BUSINESS_FIELDS,
  contextualizeBusinessPrompt,
  createBusinessDataset,
  createDisplayTable,
} from "./business-scenario-library.ts";
import type { BusinessField } from "./business-scenario-library.ts";
import { createCombinationDefinition, createTripleCombinationDefinition } from "./function-combination-library.ts";
import {
  createFunctionHint,
  createStandardEnglishQuestionPrompt,
  createStandardQuestionPrompt,
  validateQuestionPromptRowReferences,
} from "./question-language.ts";

const FORMULA_FUNCTIONS = new Set<string>([
  "SUM", "AVERAGE", "MAX", "MIN", "COUNT", "COUNTA", "IF", "IFS", "AND", "OR", "IFERROR",
  "COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS", "AVERAGEIF", "MAXIFS", "MINIFS", "XLOOKUP",
  "LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "PROPER", "SUBSTITUTE", "VALUE", "TEXT", "ABS", "ROUND",
  "ROUNDUP", "ROUNDDOWN", "CEILING", "SUMPRODUCT", "MOD",
  "YEAR", "MONTH", "DAY", "FILTER", "SORT", "UNIQUE",
]);
const CHOICE_ONLY_FUNCTIONS = new Set<string>();
const ALL_FUNCTIONS = new Set([...FORMULA_FUNCTIONS, ...CHOICE_ONLY_FUNCTIONS]);
const FUNCTION_PURPOSES: Readonly<Record<string, string>> = {
  SUM: "数値の合計を求める", AVERAGE: "数値の平均を求める", MAX: "最大値を求める", MIN: "最小値を求める",
  COUNT: "数値が入ったセルの個数を数える", COUNTA: "空白ではないセルの個数を数える",
  IF: "一つの条件で表示を分ける", IFS: "複数の条件を上から順に判定する", AND: "すべての条件を満たすか判定する",
  OR: "いずれかの条件を満たすか判定する", IFERROR: "計算エラー時に別の値を表示する",
  COUNTIF: "一つの条件に合うセルを数える", COUNTIFS: "複数条件に合う行を数える",
  SUMIF: "一つの条件に合う値を合計する", SUMIFS: "複数条件に合う値を合計する", AVERAGEIF: "条件に合う値の平均を求める",
  MAXIFS: "条件に合う値の最大値を求める", MINIFS: "条件に合う値の最小値を求める", XLOOKUP: "検索値に対応する別の列の値を返す",
  LEFT: "文字列の左端から文字を取り出す", RIGHT: "文字列の右端から文字を取り出す", MID: "文字列の途中から文字を取り出す",
  LEN: "文字列の文字数を求める", UPPER: "英字を大文字に変換する", LOWER: "英字を小文字に変換する",
  PROPER: "英単語の先頭を大文字にする", SUBSTITUTE: "文字列内の指定文字を置き換える",
  VALUE: "数値として入力された文字列を計算可能な数値へ変換する", TEXT: "数値を指定した表示形式の文字列へ変換する",
  ABS: "数値の絶対値を求める", ROUND: "指定桁で四捨五入する", ROUNDUP: "指定桁で切り上げる",
  ROUNDDOWN: "指定桁で切り捨てる", CEILING: "指定した倍数へ切り上げる", SUMPRODUCT: "対応する要素を掛けて合計する", MOD: "割り算の余りを求める",
  YEAR: "日付から年を取り出す", MONTH: "日付から月を取り出す", DAY: "日付から日を取り出す",
  FILTER: "条件に合う行だけを抽出する", SORT: "一覧を指定順に並べ替える", UNIQUE: "重複しない一覧を返す",
};
const FUNCTION_PURPOSES_EN: Readonly<Record<string, string>> = {
  SUM: "calculate a total", AVERAGE: "calculate an average", MAX: "find the highest value", MIN: "find the lowest value",
  COUNT: "count numeric cells", COUNTA: "count nonblank cells", IF: "return different values for one condition",
  IFS: "evaluate several conditions in order", AND: "test whether all conditions are true", OR: "test whether any condition is true",
  IFERROR: "return another value when a calculation produces an error", COUNTIF: "count cells matching one condition",
  COUNTIFS: "count rows matching several conditions", SUMIF: "total values matching one condition",
  SUMIFS: "total values matching several conditions", AVERAGEIF: "average values matching a condition",
  MAXIFS: "find the highest value matching a condition", MINIFS: "find the lowest value matching a condition",
  XLOOKUP: "find a value and return data from another column", LEFT: "extract characters from the left of text",
  RIGHT: "extract characters from the right of text", MID: "extract characters from the middle of text",
  LEN: "count the characters in text", UPPER: "convert text to uppercase", LOWER: "convert text to lowercase",
  PROPER: "capitalize the first letter of each word", SUBSTITUTE: "replace specified text", VALUE: "convert numeric text to a number",
  TEXT: "format a value as text", ABS: "calculate an absolute value", ROUND: "round to a specified number of digits",
  ROUNDUP: "round a value up", ROUNDDOWN: "round a value down", CEILING: "round up to a specified multiple",
  SUMPRODUCT: "multiply corresponding values and total the products", MOD: "calculate a division remainder",
  YEAR: "extract the year from a date", MONTH: "extract the month from a date", DAY: "extract the day from a date",
  FILTER: "return only rows matching a condition", SORT: "sort a list", UNIQUE: "return unique values",
};
const FUNCTION_FAMILIES: readonly (readonly string[])[] = [
  ["SUM", "AVERAGE", "MAX", "MIN", "COUNT", "COUNTA", "SUMPRODUCT"],
  ["IF", "IFS", "AND", "OR", "IFERROR"],
  ["COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS", "AVERAGEIF", "MAXIFS", "MINIFS"],
  ["XLOOKUP", "IFERROR", "MAX", "MIN"],
  ["LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "PROPER", "SUBSTITUTE", "VALUE", "TEXT"],
  ["ABS", "ROUND", "ROUNDUP", "ROUNDDOWN", "CEILING", "MOD"],
  ["YEAR", "MONTH", "DAY"],
  ["FILTER", "SORT", "UNIQUE"],
];
const CHOICE_SCENARIOS: Readonly<Record<string, string>> = {
  SUM: "各支店の月間 Sales を一つの合計金額にまとめます。",
  AVERAGE: "研修参加者全員の Score から平均点を求めます。",
  MAX: "商品一覧の Sales から最も大きい金額を求めます。",
  MIN: "配送記録の Delivery Days から最短日数を求めます。",
  COUNT: "回答欄のうち、数値の Score が入力されたセル数だけを数えます。",
  COUNTA: "申請フォームで、文字や数値を問わず入力済みのセル数を数えます。",
  IF: "在庫数が基準以上なら『発注不要』、それ以外なら『要発注』と表示を分けます。",
  IFS: "Score を90以上・70以上・それ未満の三段階で上から順に評価します。",
  AND: "研修の出席率と試験点数の両方が基準を満たしたか判定します。",
  OR: "電話番号またはメールアドレスのどちらか一方が登録済みか判定します。",
  COUNTIF: "注文一覧で Status が Late の行数だけを数えます。",
  COUNTIFS: "Status と Region の二つの条件を同時に満たす注文数を数えます。",
  SUMIF: "Region が East の行だけを対象に Sales を合計します。",
  SUMIFS: "Department と Month の二つの条件に一致する Sales だけを合計します。",
  AVERAGEIF: "Department が Sales の社員だけを対象に Score の平均を求めます。",
  MAXIFS: "指定した Department に属する社員だけを対象に最高 Score を求めます。",
  MINIFS: "指定した Supplier の商品だけを対象に最小 Price を求めます。",
  XLOOKUP: "商品コードを検索し、同じ行の商品名を商品台帳から返します。",
  IFERROR: "検索結果が見つからない場合に、エラーではなく『Not found』と表示します。",
  LEFT: "商品コードの左端にある3文字の Category Code を取り出します。",
  RIGHT: "追跡番号の右端にある4文字の Branch Code を取り出します。",
  MID: "社員IDの途中に記録された4桁の入社年を取り出します。",
  LEN: "入力された会員番号が規定の10文字か確認するため、文字数を求めます。",
  UPPER: "入力形式を統一するため、英字の商品コードをすべて大文字にします。",
  LOWER: "入力形式を統一するため、メールアドレスをすべて小文字にします。",
  PROPER: "英字で入力された氏名について、各単語の先頭だけを大文字にします。",
  SUBSTITUTE: "電話番号内のハイフンを空白へ置き換えます。",
  VALUE: "数字が文字列として保存されているセルを、計算に使える数値へ変換します。",
  TEXT: "数値を4桁のコードなど、指定した表示形式の文字列へ変換します。",
  ABS: "予算と実績の差が正負どちらでも、差の大きさだけを求めます。",
  ROUND: "計算した単価を小数第2位まで四捨五入します。",
  ROUNDUP: "必要な箱数に不足が出ないよう、計算結果を整数へ切り上げます。",
  ROUNDDOWN: "在庫から作れる完全なセット数だけを求めるため、端数を切り捨てます。",
  CEILING: "出荷数を箱の単位である10の倍数へ切り上げます。",
  SUMPRODUCT: "各商品の Quantity と Unit Price を掛け、注文全体の金額を一度に合計します。",
  MOD: "箱詰め後に余る商品の個数を求めるため、割り算の余りを計算します。",
  YEAR: "入社日のセルから年だけを取り出し、年度別の一覧を作ります。",
  MONTH: "注文日のセルから月だけを取り出し、月別集計の補助列を作ります。",
  DAY: "納品日のセルから日だけを取り出します。",
  FILTER: "注文一覧から条件に合う行だけを別の一覧として抽出します。",
  SORT: "商品コードの一覧を昇順に並べ替えます。",
  UNIQUE: "部署一覧から重複を除いた値だけを返します。",
};

type RandomSource = () => number;
type FormulaDefinition = readonly [string, unknown, string];
type DynamicRecord = any;

export interface PreparedQuestion {
  readonly key: string;
  readonly functionName: string;
  readonly questionMode: "choice" | "formula";
  readonly blueprintKey: string;
  readonly studentPayload: DynamicRecord;
  readonly answerKey: DynamicRecord;
  readonly scoringRule: DynamicRecord;
}

function randomFor(seed: string): RandomSource {
  let state = createHash("sha256").update(seed).digest().readUInt32BE(0) || 1;
  return () => ((state = (state * 1_664_525 + 1_013_904_223) >>> 0) / 0x1_0000_0000);
}

function shuffle<Item>(values: readonly Item[], random: RandomSource): Item[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = result[index]; const replacement = result[swap];
    if (current === undefined || replacement === undefined) continue;
    [result[index], result[swap]] = [replacement, current];
  }
  return result;
}

function columnName(index: number): string { return String.fromCharCode(65 + index); }

function choiceOptions(functionName: string, random: RandomSource): string[] {
  const family = FUNCTION_FAMILIES.find((items) => items.includes(functionName)) ?? [];
  const candidates = [...family.filter((name) => name !== functionName), ...[...ALL_FUNCTIONS].filter((name) => name !== functionName && !family.includes(name))];
  return shuffle([functionName, ...shuffle(candidates, random).slice(0, 3)], random);
}

function choicePrompt(functionName: string): string {
  const scenario = CHOICE_SCENARIOS[functionName] ?? `業務用の表で「${FUNCTION_PURPOSES[functionName]}」必要があります。`;
  return `${scenario} この処理に最も適切な関数（かんすう）を一つ選んでください。`;
}

function choicePromptEn(functionName: string): string {
  return `Choose the most appropriate function to ${FUNCTION_PURPOSES_EN[functionName] ?? "complete the requested spreadsheet task"}.`;
}

function formulaDefinition(functionName: string, ref: (name: string) => string, dataset: any): FormulaDefinition {
  const range = (name: string): string => `${ref(name)}2:${ref(name)}6`;
  const { rows, values, quantities, targetGroup, targetStatus } = dataset as {
    rows: any[]; values: any[]; quantities: any[]; targetGroup: string; targetStatus: string;
  };
  const sum = values.reduce((total, value) => total + value, 0);
  const groupValues = rows.filter((row) => row.Group === targetGroup).map((row) => row.Value);
  const definitions: Readonly<Record<string, FormulaDefinition>> = {
    SUM: ["=SUM(ValueData)", sum, "名前付き範囲 ValueData の合計（ごうけい）を求めてください。"],
    AVERAGE: [`=AVERAGE(${range("Value")})`, sum / values.length, "Value 列の平均（へいきん）を求めてください。"],
    MAX: [`=MAX(${range("Value")})`, Math.max(...values), "Value 列の最大値（さいだいち）を求めてください。"],
    MIN: [`=MIN(${range("Value")})`, Math.min(...values), "Value 列の最小値（さいしょうち）を求めてください。"],
    COUNT: [`=COUNT(${ref("Value")}:${ref("Value")})`, 5, "Value 列全体にある数値セルを数えてください。"],
    COUNTA: [`=COUNTA(${ref("Mixed")}:${ref("Mixed")})`, 4, "Mixed 列全体の空白ではないセル（見出しを含む）を数えてください。"],
    IF: [`=IF(${ref("Value")}2>=20,"High","Low")`, values[0] >= 20 ? "High" : "Low", "1行目の Value が20以上なら High、それ以外は Low と表示してください。"],
    IFS: [`=IFS(${ref("Value")}2>=30,"A",${ref("Value")}2>=20,"B",TRUE,"C")`, values[0] >= 30 ? "A" : values[0] >= 20 ? "B" : "C", "1行目の Value を A・B・C の3段階で判定してください。"],
    AND: [`=AND(${ref("Value")}2<20,${ref("Qty")}2=2)`, values[0] < 20, "1行目が Value<20 かつ Qty=2 か判定してください。"],
    OR: [`=OR(${ref("Value")}2>=20,${ref("Qty")}2=2)`, values[0] >= 20 || quantities[0] === 2, "1行目が Value>=20 または Qty=2 か判定してください。"],
    IFERROR: [`=IFERROR(${ref("Value")}2/0,"Error")`, "Error", "Value を0で割ったエラーを Error と表示してください。"],
    COUNTIF: [`=COUNTIF(${range("Group")},"${targetGroup}")`, groupValues.length, `Group が ${targetGroup} の行数を求めてください。`],
    COUNTIFS: [`=COUNTIFS(${range("Group")},"${targetGroup}",${range("Value")},">=10")`, groupValues.filter((value) => value >= 10).length, `Group が ${targetGroup} かつ Value が10以上の行数を求めてください。`],
    SUMIF: [`=SUMIF(${range("Group")},"${targetGroup}",${range("Value")})`, groupValues.reduce((a, b) => a + b, 0), `Group が ${targetGroup} の Value 合計を求めてください。`],
    SUMIFS: [`=SUMIFS(${range("Value")},${range("Group")},"${targetGroup}",${range("Status")},"${targetStatus}")`, rows.filter((row) => row.Group === targetGroup && row.Status === targetStatus).reduce((total, row) => total + row.Value, 0), `Group が ${targetGroup} かつ Status が ${targetStatus} の Value 合計を求めてください。`],
    AVERAGEIF: [`=AVERAGEIF(${range("Group")},"${targetGroup}",${range("Value")})`, groupValues.reduce((a, b) => a + b, 0) / groupValues.length, `Group が ${targetGroup} の Value 平均を求めてください。`],
    MAXIFS: [`=MAXIFS(${range("Value")},${range("Group")},"${targetGroup}")`, Math.max(...groupValues), `Group が ${targetGroup} の Value 最大値を求めてください。`],
    MINIFS: [`=MINIFS(${range("Value")},${range("Group")},"${targetGroup}")`, Math.min(...groupValues), `Group が ${targetGroup} の Value 最小値を求めてください。`],
    XLOOKUP: [`=XLOOKUP("${rows[3].Code}",${range("Code")},${range("Name")})`, rows[3].Name, `Code が ${rows[3].Code} の Name を検索してください。`],
    LEFT: [`=LEFT(${ref("Text")}2,5)`, rows[0].Text.slice(0, 5), "1行目の Text の左から5文字を取り出してください。"],
    RIGHT: [`=RIGHT(${ref("Text")}2,4)`, rows[0].Text.slice(-4), "1行目の Text の右から4文字を取り出してください。"],
    MID: [`=MID(${ref("Text")}2,7,4)`, rows[0].Text.slice(6, 10), "1行目の Text の7文字目から4文字を取り出してください。"],
    LEN: [`=LEN(${ref("Text")}2)`, rows[0].Text.length, "1行目の Text の文字数を求めてください。"],
    UPPER: [`=UPPER(${ref("Name")}2)`, rows[0].Name.toUpperCase(), "1行目の Name を大文字にしてください。"],
    LOWER: [`=LOWER(${ref("Status")}2)`, rows[0].Status.toLowerCase(), "1行目の Status を小文字にしてください。"],
    PROPER: [`=PROPER(${ref("Text")}2)`, rows[0].Text.replace(/\b\w/g, (value: string) => value.toUpperCase()), "1行目の Text を先頭大文字にしてください。"],
    SUBSTITUTE: [`=SUBSTITUTE(${ref("Text")}2,"-"," ")`, rows[0].Text.replaceAll("-", " "), "1行目の Text のハイフンを空白に置換してください。"],
    VALUE: [`=VALUE(${ref("Mixed")}2)`, values[0], "1行目の Mixed に入力された数値の文字列を、計算に使える数値へ変換してください。"],
    TEXT: [`=TEXT(${ref("Value")}2,"0000")`, String(values[0]).padStart(4, "0"), "1行目の Value を、先頭を0で埋めた4桁の文字列に変換してください。"],
    ABS: [`=ABS(0-${ref("Value")}2)`, values[0], "0 から1行目の Value を引いた値の絶対値を求めてください。"],
    ROUND: [`=ROUND(${ref("Value")}2/7,2)`, Math.round((values[0] / 7) * 100) / 100, "1行目の Value を7で割り、小数第2位まで四捨五入してください。"],
    ROUNDUP: [`=ROUNDUP(${ref("Value")}2/7,0)`, Math.ceil(values[0] / 7), "1行目の Value を7で割り、整数へ切り上げてください。"],
    ROUNDDOWN: [`=ROUNDDOWN(${ref("Value")}2/7,0)`, Math.floor(values[0] / 7), "1行目の Value を7で割り、整数へ切り捨ててください。"],
    CEILING: [`=CEILING(${ref("Value")}2,5)`, Math.ceil(values[0] / 5) * 5, "1行目の Value を5の倍数へ切り上げてください。"],
    SUMPRODUCT: [`=SUMPRODUCT(${range("Value")},${range("Qty")})`, values.reduce((total, value, index) => total + value * quantities[index], 0), "Value と Qty の積の合計を求めてください。"],
    MOD: [`=MOD(${ref("Value")}2,${ref("Qty")}2)`, values[0] % quantities[0], "1行目の Value を Qty で割った余りを求めてください。"],
    YEAR: [`=YEAR(${ref("Date")}2)`, Number(rows[0].Date.slice(0, 4)), "1行目の Date から年を取り出してください。"],
    MONTH: [`=MONTH(${ref("Date")}2)`, Number(rows[0].Date.slice(5, 7)), "1行目の Date から月を取り出してください。"],
    DAY: [`=DAY(${ref("Date")}2)`, Number(rows[0].Date.slice(8, 10)), "1行目の Date から日を取り出してください。"],
    FILTER: [`=FILTER(${range("Code")},${range("Group")}="${targetGroup}")`, rows.filter((row) => row.Group === targetGroup).map((row) => row.Code), `Group が ${targetGroup} の Code 一覧を抽出してください。`],
    SORT: [`=SORT(${range("Code")})`, rows.map((row) => row.Code).sort(), "Code 一覧を昇順に並べ替えてください。"],
    UNIQUE: [`=UNIQUE(${range("Group")})`, [...new Set(rows.map((row) => row.Group))], "Group の重複を除いた一覧を返してください。"],
  };
  const definition = definitions[functionName];
  if (!definition) throw new Error(`Unsupported formula function: ${functionName}`);
  return definition;
}

export function generateQuestionInstance({ examCode, studentNumber, question, pairingExamCode = examCode }: {
  examCode: string;
  studentNumber: string;
  question: DynamicRecord;
  pairingExamCode?: string;
}): PreparedQuestion {
  if (!ALL_FUNCTIONS.has(question.functionName)) throw new Error(`Unsupported function: ${question.functionName}`);
  const key = `${question.id}-${question.functionName.toLowerCase()}`;
  const random = randomFor(`${examCode}:${studentNumber}:${key}:business-v2`);
  if (question.mode === "choice") {
    const options = choiceOptions(question.functionName, random);
    return { key, functionName: question.functionName, questionMode: "choice", blueprintKey: `business-${question.functionName.toLowerCase()}-choice-v2`, studentPayload: { kind: "choice", promptJa: choicePrompt(question.functionName), promptEn: choicePromptEn(question.functionName), options }, answerKey: { correctOption: question.functionName }, scoringRule: { maximumScore: 1, version: "business-choice-v2" } };
  }
  if (!FORMULA_FUNCTIONS.has(question.functionName)) throw new Error(`Function is choice-only: ${question.functionName}`);
  const offset = Math.floor(random() * 8);
  const dataset = createBusinessDataset({ random, offset });
  const fields = shuffle(BUSINESS_FIELDS, random);
  const table: DynamicRecord = createDisplayTable(dataset, fields);
  const ref = (name: string): string => columnName(fields.indexOf(name as BusinessField));
  table.namedRanges = {
    ValueData: `${ref("Value")}2:${ref("Value")}6`,
    GroupData: `${ref("Group")}2:${ref("Group")}6`,
  };
  const companionCandidates: string[] = Array.isArray(question.companionCandidates) && question.companionCandidates.length
    ? question.companionCandidates
    : question.companionFunction ? [question.companionFunction] : [];
  const pairingRandom = randomFor(`${pairingExamCode}:${studentNumber}:${key}:pairing-v2`);
  const tripleCandidates: string[][] = Array.isArray(question.tripleCandidates) ? question.tripleCandidates.filter((item: unknown): item is string[] => Array.isArray(item) && item.length === 2 && item.every((name) => typeof name === "string")) : [];
  const tripleCompanions = tripleCandidates.length ? tripleCandidates[Math.floor(pairingRandom() * tripleCandidates.length)] ?? null : null;
  const companionFunction = companionCandidates.length ? companionCandidates[Math.floor(pairingRandom() * companionCandidates.length)] ?? null : null;
  const triple = tripleCompanions ? createTripleCombinationDefinition([question.functionName, ...tripleCompanions], ref, dataset) : null;
  const composite = triple ?? (companionFunction ? createCombinationDefinition(question.functionName, companionFunction, ref, dataset) : null);
  const [allowedFormula, expectedValue, genericPrompt] = composite ?? formulaDefinition(question.functionName, ref, dataset);
  const requiredFunctions: string[] = triple ? [question.functionName, ...tripleCompanions!] : composite ? [question.functionName, companionFunction!] : [question.functionName];
  const promptJa = createStandardQuestionPrompt(contextualizeBusinessPrompt(genericPrompt, dataset.labels));
  const promptEn = contextualizeBusinessPrompt(
    createStandardEnglishQuestionPrompt(genericPrompt, { requiredFunctions }),
    dataset.labels,
  );
  validateQuestionPromptRowReferences({ promptJa, formula: allowedFormula });
  const functionCount = requiredFunctions.length;
  const compositionLabelJa = functionCount === 3 ? "3関数問題" : functionCount === 2 ? "2関数問題" : null;
  const compositionLabelEn = functionCount === 3 ? "Three-function question" : functionCount === 2 ? "Two-function question" : null;
  const tipJa = createFunctionHint(requiredFunctions);
  const scoringRule: DynamicRecord = {
    maximumScore: functionCount === 3 ? 5 : functionCount === 2 ? 4 : 3,
    requiredFunction: question.functionName,
    requiredFunctions,
    numericEpsilon: 1e-6,
    coreFunctionMissingScore: functionCount === 3 ? 2.5 : functionCount === 2 ? 2 : 1.5,
    version: functionCount === 3 ? "triple-formula-v3" : functionCount === 2 ? "combined-formula-v3" : "business-formula-v3",
  };
  if (typeof expectedValue === "number") scoringRule.numericMode = "decimal";
  return {
    key,
    functionName: question.functionName,
    questionMode: "formula",
    blueprintKey: composite ? `combined-${requiredFunctions.map((name) => name.toLowerCase()).join("-")}-v3` : `business-${dataset.key}-${question.functionName.toLowerCase()}-formula-v3`,
    studentPayload: {
      kind: "formula",
      difficulty: composite ? "advanced" : "standard",
      functionCount,
      compositionLabelJa,
      compositionLabelEn,
      scenario: { key: dataset.key, title: dataset.title },
      table,
      promptJa,
      promptEn,
      tipJa,
      answerCell: `${columnName(fields.length)}2`,
    },
    answerKey: { allowedFormula, expectedValue },
    scoringRule,
  };
}

export function orderQuestionInstances<Item>(instances: readonly Item[], { examCode, studentNumber }: { examCode: string; studentNumber: string }): Item[] {
  return shuffle(instances, randomFor(`${examCode}:${studentNumber}:question-order-v2`));
}

export function flattenPlanQuestions(plan: DynamicRecord): DynamicRecord[] { return [...plan.choiceQuestions, ...plan.formulaGroups.flatMap((group: DynamicRecord) => group.questions)]; }

export function validatePreparedPaper(instances: readonly DynamicRecord[], plan: DynamicRecord) {
  const expected = Number(plan.questionCounts.choice) + Number(plan.questionCounts.formula);
  const selectedFunctions = new Set(plan.coverage?.selected ?? []);
  const errors: DynamicRecord[] = [];
  if (instances.length !== expected) errors.push({ code: "QUESTION_COUNT_MISMATCH", expected, actual: instances.length });
  const actualChoice = instances.filter((item) => item.questionMode === "choice").length;
  const actualFormula = instances.filter((item) => item.questionMode === "formula").length;
  if (actualChoice !== Number(plan.questionCounts.choice) || actualFormula !== Number(plan.questionCounts.formula)) {
    errors.push({ code: "QUESTION_MODE_COUNT_MISMATCH", expectedChoice: Number(plan.questionCounts.choice), actualChoice, expectedFormula: Number(plan.questionCounts.formula), actualFormula });
  }
  if (new Set(instances.map((item) => item.key)).size !== instances.length) errors.push({ code: "DUPLICATE_QUESTION_KEY" });
  instances.forEach((item: DynamicRecord, index: number) => {
    if (!item.studentPayload || item.studentPayload.answerKey || item.studentPayload.expectedValue !== undefined) errors.push({ code: "STUDENT_PAYLOAD_INVALID", index });
    if (!item.answerKey || !item.scoringRule || !["choice", "formula"].includes(item.questionMode)) errors.push({ code: "QUESTION_STRUCTURE_INVALID", index });
    if (item.questionMode === "formula" && (!item.studentPayload.table?.columns?.length || !item.answerKey.allowedFormula)) errors.push({ code: "FORMULA_STRUCTURE_INVALID", index });
    if (item.questionMode === "formula" && (!Array.isArray(item.scoringRule.requiredFunctions) || item.scoringRule.requiredFunctions.some((name: unknown) => !selectedFunctions.has(name)))) errors.push({ code: "FORMULA_FUNCTION_SCOPE_INVALID", index });
    if (item.questionMode === "choice" && (!Array.isArray(item.studentPayload.options) || item.studentPayload.options.length !== 4)) errors.push({ code: "CHOICE_STRUCTURE_INVALID", index });
  });
  return { ok: errors.length === 0, errors, expectedQuestionCount: expected };
}

export { ALL_FUNCTIONS, FORMULA_FUNCTIONS };
