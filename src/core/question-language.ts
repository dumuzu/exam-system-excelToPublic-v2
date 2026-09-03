const INLINE_READING = /（[ぁ-んァ-ンー]+）/g;
const FUNCTION_NAME = /^[A-Z][A-Z0-9.]*$/;
const APPROVED_WORKSHEET_ROW_LABEL_SOURCE = "表の(\\d+)行目[（(](最初|\\d+件目)のデータ行[）)]";
const AMBIGUOUS_ROW_DESCRIPTION = /\d+行目/;

function cleanTask(taskJa: unknown): string {
  return String(taskJa ?? "")
    .replace(INLINE_READING, "")
    .normalize("NFKC")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function assertUnambiguousWorksheetRows(task: string): void {
  const withoutApprovedLabels = task.replace(new RegExp(APPROVED_WORKSHEET_ROW_LABEL_SOURCE, "g"), "");
  if (AMBIGUOUS_ROW_DESCRIPTION.test(withoutApprovedLabels)) {
    throw new Error("AMBIGUOUS_WORKSHEET_ROW_DESCRIPTION");
  }
}

function normalizeDataRowDescriptions(task: string): string {
  return task.replace(/(?<!表の)(\d+)行目/g, (_match, ordinal: string) => worksheetDataRowLabel(Number(ordinal)));
}

function quoteColumnLabels(task: string): string {
  return task.replace(/(?<!「)\b([A-Za-z][A-Za-z0-9 ]*?) 列/g, "「$1」列");
}

export function createStandardQuestionPrompt(taskJa: unknown): string {
  const task = normalizeDataRowDescriptions(cleanTask(taskJa));
  assertUnambiguousWorksheetRows(task);
  const filteredList = task.match(/^(.+?) が (.+?) の (.+?) 一覧を抽出してください。$/);
  if (filteredList) {
    const [, conditionColumn, conditionValue, resultColumn] = filteredList;
    return `次の表を確認してください。「${conditionColumn}」列が「${conditionValue}」の行だけを対象にし、「${resultColumn}」列の値を一覧で取り出してください。`;
  }

  const uniqueList = task.match(/^(.+?) の重複を除いた一覧を返してください。$/);
  if (uniqueList) {
    return `次の表を確認してください。「${uniqueList[1]}」列から重複する値を除き、残った値を一覧で表示してください。`;
  }

  const sortedList = task.match(/^(.+?) 一覧を昇順に並べ替えてください。$/);
  if (sortedList) {
    return `次の表を確認してください。「${sortedList[1]}」列の値を小さい順（昇順）に並べて、一覧で表示してください。`;
  }

  return `次の表を確認し、次の指示に従って結果を求めてください。${quoteColumnLabels(task)}`;
}

function englishDataRow(dataOrdinal: string | number): string {
  const ordinal = Number(dataOrdinal);
  const position = ordinal === 1 ? "the first data row" : `data row ${ordinal}`;
  return `worksheet row ${ordinal + 1} (${position})`;
}

function translatedTerm(terms: Readonly<Record<string, string>>, key: unknown): string {
  return terms[String(key)] ?? "";
}

// RegExp capture counts vary by translation pattern. Keep that dynamic boundary
// explicit while the exported language helpers remain strictly typed.
type RegexCaptures = any[];
type EnglishPattern = readonly [RegExp, (match: RegexCaptures) => string];

function englishTask(taskJa: unknown): string | null {
  const task = cleanTask(taskJa);
  const patterns: EnglishPattern[] = [
    [/^名前付き範囲 (\S+) の合計を求めてください。$/, ([, range]) => `Calculate the total of the named range ${range}.`],
    [/^(\w+) 列の(合計|平均|最大値|最小値)を求めてください。$/, ([, column, operation]) => `${translatedTerm({ 合計: "Calculate the total", 平均: "Calculate the average", 最大値: "Find the highest value", 最小値: "Find the lowest value" }, operation)} in the ${column} column.`],
    [/^(\w+) 列全体にある数値セルを数えてください。$/, ([, column]) => `Count the numeric cells in the entire ${column} column.`],
    [/^(\w+) 列全体の空白ではないセル(?:[（(]見出しを含む[）)])?を数えてください。$/, ([, column]) => `Count all nonblank cells in the entire ${column} column, including the header.`],
    [/^(\d+)行目の (\w+) が(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, row, column, condition, yes, no]) => `For ${englishDataRow(row)}, display ${yes} if ${column} is ${condition}; otherwise display ${no}.`],
    [/^(\d+)行目の (\w+) を (.+) の3段階で判定してください。$/, ([, row, column, levels]) => `Classify ${column} in ${englishDataRow(row)} into the three levels ${levels}.`],
    [/^(\d+)行目が (.+) かつ (.+) か判定してください。$/, ([, row, left, right]) => `Determine whether both ${left} and ${right} are true for ${englishDataRow(row)}.`],
    [/^(\d+)行目が (.+) または (.+) か判定してください。$/, ([, row, left, right]) => `Determine whether ${left} or ${right} is true for ${englishDataRow(row)}.`],
    [/^(\w+) を0で割ったエラーを (.+) と表示してください。$/, ([, column, fallback]) => `Divide ${column} by zero and display ${fallback} instead of the resulting error.`],
    [/^(\w+) が (.+) の行数を求めてください。$/, ([, column, value]) => `Count the rows where ${column} is ${value}.`],
    [/^(\w+) が (.+) かつ (\w+) が(.+)の行数を求めてください。$/, ([, firstColumn, firstValue, secondColumn, condition]) => `Count the rows where ${firstColumn} is ${firstValue} and ${secondColumn} is ${condition}.`],
    [/^(\w+) が (.+) の (\w+) (合計|平均|最大値|最小値)を求めてください。$/, ([, conditionColumn, conditionValue, resultColumn, operation]) => `${translatedTerm({ 合計: "Calculate the total", 平均: "Calculate the average", 最大値: "Find the highest value", 最小値: "Find the lowest value" }, operation)} of ${resultColumn} for rows where ${conditionColumn} is ${conditionValue}.`],
    [/^(\w+) が (.+) かつ (\w+) が (.+) の (\w+) 合計を求めてください。$/, ([, firstColumn, firstValue, secondColumn, secondValue, resultColumn]) => `Calculate the total of ${resultColumn} for rows where ${firstColumn} is ${firstValue} and ${secondColumn} is ${secondValue}.`],
    [/^(\w+) が (.+) の (\w+) を検索してください。$/, ([, lookupColumn, value, resultColumn]) => `Find the ${resultColumn} for the row where ${lookupColumn} is ${value}.`],
    [/^(\d+)行目の (\w+) の左から(\d+)文字を取り出してください。$/, ([, row, column, count]) => `Extract the first ${count} characters from ${column} in ${englishDataRow(row)}.`],
    [/^(\d+)行目の (\w+) の右から(\d+)文字を取り出してください。$/, ([, row, column, count]) => `Extract the last ${count} characters from ${column} in ${englishDataRow(row)}.`],
    [/^(\d+)行目の (\w+) の(\d+)文字目から(\d+)文字を取り出してください。$/, ([, row, column, start, count]) => `Extract ${count} characters starting at character ${start} from ${column} in ${englishDataRow(row)}.`],
    [/^(\d+)行目の (\w+) の文字数を求めてください。$/, ([, row, column]) => `Count the characters in ${column} in ${englishDataRow(row)}.`],
    [/^(\d+)行目の (\w+) を(大文字|小文字|先頭大文字)にしてください。$/, ([, row, column, form]) => `${translatedTerm({ 大文字: "Convert", 小文字: "Convert", 先頭大文字: "Convert" }, form)} ${column} in ${englishDataRow(row)} to ${translatedTerm({ 大文字: "uppercase", 小文字: "lowercase", 先頭大文字: "title case" }, form)}.`],
    [/^(\d+)行目の (\w+) のハイフンを(.+)に置換してください。$/, ([, row, column, replacement]) => `Replace the hyphens in ${column} in ${englishDataRow(row)} with ${replacement}.`],
    [/^(\d+)行目の (\w+) に入力された数値の文字列を、計算に使える数値へ変換してください。$/, ([, row, column]) => `Convert the numeric text in ${column} in ${englishDataRow(row)} to a number that can be used in calculations.`],
    [/^(\d+)行目の (\w+) を、先頭を0で埋めた(\d+)桁の文字列に変換してください。$/, ([, row, column, digits]) => `Convert ${column} in ${englishDataRow(row)} to a ${digits}-digit text value padded with leading zeros.`],
    [/^0 から(\d+)行目の (\w+) を引いた値の絶対値を求めてください。$/, ([, row, column]) => `Calculate the absolute value of zero minus ${column} in ${englishDataRow(row)}.`],
    [/^(\d+)行目の (\w+) を(\d+)で割り、小数第(\d+)位まで四捨五入してください。$/, ([, row, column, divisor, digits]) => `Divide ${column} in ${englishDataRow(row)} by ${divisor} and round to ${digits} decimal places.`],
    [/^(\d+)行目の (\w+) を(\d+)で割り、整数へ(切り上げ|切り捨て)てください。$/, ([, row, column, divisor, direction]) => `Divide ${column} in ${englishDataRow(row)} by ${divisor} and ${direction === "切り上げ" ? "round up" : "round down"} to an integer.`],
    [/^(\d+)行目の (\w+) を(\d+)の倍数へ切り上げてください。$/, ([, row, column, multiple]) => `Round ${column} in ${englishDataRow(row)} up to the next multiple of ${multiple}.`],
    [/^(\w+) と (\w+) の積の合計を求めてください。$/, ([, left, right]) => `Multiply the corresponding ${left} and ${right} values and calculate their total.`],
    [/^(\d+)行目の (\w+) を (\w+) で割った余りを求めてください。$/, ([, row, left, right]) => `Calculate the remainder when ${left} in ${englishDataRow(row)} is divided by ${right}.`],
    [/^(\d+)行目の (\w+) から(年|月|日)を取り出してください。$/, ([, row, column, part]) => `Extract the ${translatedTerm({ 年: "year", 月: "month", 日: "day" }, part)} from ${column} in ${englishDataRow(row)}.`],
    [/^(\w+) が (.+) の (\w+) 一覧を抽出してください。$/, ([, conditionColumn, conditionValue, resultColumn]) => `Return a list of ${resultColumn} values from rows where ${conditionColumn} is ${conditionValue}.`],
    [/^(\w+) 一覧を昇順に並べ替えてください。$/, ([, column]) => `Sort the ${column} values in ascending order.`],
    [/^(\w+) の重複を除いた一覧を返してください。$/, ([, column]) => `Return a list of unique values from ${column}.`],
    [/^(\w+) が最大の行にある (\w+) を返してください。$/, ([, valueColumn, resultColumn]) => `Return the ${resultColumn} from the row with the highest ${valueColumn}.`],
    [/^(\w+) が最小の行にある (\w+) を返してください。$/, ([, valueColumn, resultColumn]) => `Return the ${resultColumn} from the row with the lowest ${valueColumn}.`],
    [/^(.+)を求め、小数第(\d+)位まで四捨五入してください。$/, ([, calculation, digits]) => `Calculate ${calculation} and round the result to ${digits} decimal place${digits === "1" ? "" : "s"}.`],
    [/^(.+)を求め、整数へ(切り上げ|切り捨て)てください。$/, ([, calculation, direction]) => `Calculate ${calculation} and ${direction === "切り上げ" ? "round up" : "round down"} to an integer.`],
    [/^(.+)を求め、(\d+)の倍数へ切り上げてください。$/, ([, calculation, multiple]) => `Calculate ${calculation} and round up to the next multiple of ${multiple}.`],
    [/^(\w+) の重複を除き、昇順に並べてください。$/, ([, column]) => `Remove duplicate ${column} values and sort the remaining values in ascending order.`],
    [/^(\w+) が最大の行にある (\w+) を検索し、大文字で返してください。$/, ([, valueColumn, resultColumn]) => `Find the ${resultColumn} in the row with the highest ${valueColumn} and return it in uppercase.`],
    [/^(\w+) が最小の行にある (\w+) を検索し、小文字で返してください。$/, ([, valueColumn, resultColumn]) => `Find the ${resultColumn} in the row with the lowest ${valueColumn} and return it in lowercase.`],
    [/^(\w+) の最大値が(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, column, condition, yes, no]) => `Display ${yes} if the highest ${column} value is ${condition}; otherwise display ${no}.`],
    [/^(\w+) の最小値が(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, column, condition, yes, no]) => `Display ${yes} if the lowest ${column} value is ${condition}; otherwise display ${no}.`],
    [/^(\d+)行目で (\w+) が(.+)、かつ (\w+) が(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, row, firstColumn, firstCondition, secondColumn, secondCondition, yes, no]) => `For ${englishDataRow(row)}, display ${yes} if ${firstColumn} is ${firstCondition} and ${secondColumn} is ${secondCondition}; otherwise display ${no}.`],
    [/^(\d+)行目で (\w+) が(.+)、または (\w+) が(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, row, firstColumn, firstCondition, secondColumn, secondCondition, yes, no]) => `For ${englishDataRow(row)}, display ${yes} if ${firstColumn} is ${firstCondition} or ${secondColumn} is ${secondCondition}; otherwise display ${no}.`],
    [/^(\d+)行目の (\w+) が(\d+)文字以上なら (.+)、それ以外は (.+) と表示してください。$/, ([, row, column, count, yes, no]) => `For ${englishDataRow(row)}, display ${yes} if ${column} has at least ${count} characters; otherwise display ${no}.`],
    [/^存在しない (\w+) を検索し、見つからない場合は (.+) と表示してください。$/, ([, column, fallback]) => `Search for a nonexistent ${column} and display ${fallback} when it is not found.`],
    [/^(\w+) の数値セルが(\d+)個なら (.+)、それ以外は (.+) と表示してください。$/, ([, column, count, yes, no]) => `Display ${yes} if ${column} contains ${count} numeric cells; otherwise display ${no}.`],
    [/^(\w+) の入力済みセルが(\d+)個以上なら (.+)、それ以外は (.+) と表示してください。$/, ([, column, count, yes, no]) => `Display ${yes} if ${column} contains at least ${count} nonblank cells; otherwise display ${no}.`],
    [/^(\w+) が (.+) の行を数え、(\d+)件以上なら (.+)、それ以外は (.+) と表示してください。$/, ([, column, value, count, yes, no]) => `Count rows where ${column} is ${value}. Display ${yes} when there are at least ${count}; otherwise display ${no}.`],
    [/^(\w+) が (.+) かつ (\w+) が (.+) の行を数え、(\d+)件以上なら (.+)、それ以外は (.+) と表示してください。$/, ([, firstColumn, firstValue, secondColumn, secondValue, count, yes, no]) => `Count rows where ${firstColumn} is ${firstValue} and ${secondColumn} is ${secondValue}. Display ${yes} when there are at least ${count}; otherwise display ${no}.`],
    [/^(.+) の行で (\w+) が最大となる (\w+) を返してください。$/, ([, condition, valueColumn, resultColumn]) => `Return the ${resultColumn} from the matching ${condition} row with the highest ${valueColumn}.`],
    [/^(.+) の行で (\w+) が最小となる (\w+) を返してください。$/, ([, condition, valueColumn, resultColumn]) => `Return the ${resultColumn} from the matching ${condition} row with the lowest ${valueColumn}.`],
    [/^(\d+)行目の (\w+) の左(\d+)文字を取り出し、(大文字|小文字)にしてください。$/, ([, row, column, count, form]) => `Extract the first ${count} characters from ${column} in ${englishDataRow(row)} and convert them to ${form === "大文字" ? "uppercase" : "lowercase"}.`],
    [/^(\d+)行目の (\w+) の右(\d+)文字を取り出し、(大文字|小文字)にしてください。$/, ([, row, column, count, form]) => `Extract the last ${count} characters from ${column} in ${englishDataRow(row)} and convert them to ${form === "大文字" ? "uppercase" : "lowercase"}.`],
    [/^(\d+)行目の (\w+) の(\d+)文字目から(\d+)文字を取り出し、(大文字|小文字)にしてください。$/, ([, row, column, start, count, form]) => `Extract ${count} characters starting at character ${start} from ${column} in ${englishDataRow(row)} and convert them to ${form === "大文字" ? "uppercase" : "lowercase"}.`],
    [/^(\d+)行目の (\w+) のハイフンを空白へ置換し、各単語の先頭を大文字にしてください。$/, ([, row, column]) => `In ${column} in ${englishDataRow(row)}, replace hyphens with spaces and capitalize the first letter of each word.`],
    [/^(\d+)行目の (\w+) のハイフンをアンダースコアへ置換し、全体を大文字にしてください。$/, ([, row, column]) => `In ${column} in ${englishDataRow(row)}, replace hyphens with underscores and convert the entire result to uppercase.`],
    [/^指定した (\w+) の (\w+) を検索し、(大文字|小文字)で返してください。$/, ([, lookupColumn, resultColumn, form]) => `Find the ${resultColumn} for the specified ${lookupColumn} and return it in ${form === "大文字" ? "uppercase" : "lowercase"}.`],
    [/^(\d+)行目の (\w+) の右端(\d+)文字を取り出し、計算に使える数値へ変換してください。$/, ([, row, column, count]) => `Extract the last ${count} character${count === "1" ? "" : "s"} from ${column} in ${englishDataRow(row)} and convert the result to a number.`],
    [/^(\d+)行目の (\w+) を数値へ変換し、変換できない場合は (.+) を返してください。$/, ([, row, column, fallback]) => `Convert ${column} in ${englishDataRow(row)} to a number and return ${fallback} if conversion fails.`],
    [/^(\d+)行目の (\w+) を(\d+)で割った余りを調べ、偶数なら (.+)、奇数なら (.+) と表示してください。$/, ([, row, column, divisor, even, odd]) => `Calculate the remainder when ${column} in ${englishDataRow(row)} is divided by ${divisor}. Display ${even} for an even value and ${odd} for an odd value.`],
    [/^指定した (\w+) の (\w+) を検索し、先頭を0で埋めた(\d+)桁の文字列に変換してください。$/, ([, lookupColumn, resultColumn, digits]) => `Find the ${resultColumn} for the specified ${lookupColumn} and convert it to a ${digits}-digit text value padded with leading zeros.`],
    [/^(\d+)行目の (\w+) を数値へ変換し、(\d+)で割った余りを求めてください。$/, ([, row, column, divisor]) => `Convert ${column} in ${englishDataRow(row)} to a number and calculate the remainder after division by ${divisor}.`],
    [/^(.+) の (\w+) だけを抽出し、昇順に並べてください。$/, ([, condition, resultColumn]) => `Return only the ${resultColumn} values matching ${condition}, sorted in ascending order.`],
    [/^(.+) の行から重複しない (\w+) 一覧を返してください。$/, ([, condition, resultColumn]) => `Return a unique list of ${resultColumn} values from rows matching ${condition}.`],
    [/^(\d+)行目の (\w+) の年が(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, row, column, condition, yes, no]) => `For ${englishDataRow(row)}, display ${yes} if the year in ${column} is ${condition}; otherwise display ${no}.`],
    [/^(\d+)行目の (\w+) が上半期なら (.+)、それ以外は (.+) と表示してください。$/, ([, row, column, firstHalf, secondHalf]) => `For ${englishDataRow(row)}, display ${firstHalf} when ${column} is in the first half of the year; otherwise display ${secondHalf}.`],
    [/^(\d+)行目の (\w+) の日が(\d+)日以前なら (.+)、それ以外は (.+) と表示してください。$/, ([, row, column, day, yes, no]) => `For ${englishDataRow(row)}, display ${yes} when the day in ${column} is ${day} or earlier; otherwise display ${no}.`],
    [/^(\w+) の合計を整数へ四捨五入し、(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, column, condition, yes, no]) => `Round the total of ${column} to an integer. Display ${yes} if the result is ${condition}; otherwise display ${no}.`],
    [/^(\w+) の平均を整数へ四捨五入し、(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, column, condition, yes, no]) => `Round the average of ${column} to an integer. Display ${yes} if the result is ${condition}; otherwise display ${no}.`],
    [/^(.+) の (\w+) 合計を整数へ四捨五入し、(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, condition, valueColumn, threshold, yes, no]) => `Round the total of ${valueColumn} for ${condition} to an integer. Display ${yes} if the result is ${threshold}; otherwise display ${no}.`],
    [/^(.+) が(\d+)件以上、または(\d+)行目の (\w+) が(.+)なら (.+)、それ以外は (.+) と表示してください。$/, ([, condition, count, row, column, threshold, yes, no]) => `Display ${yes} if ${condition} occurs at least ${count} times or ${column} in ${englishDataRow(row)} is ${threshold}; otherwise display ${no}.`],
    [/^(\d+)行目の (\w+) のハイフンを置換し、左(\d+)文字を大文字で返してください。$/, ([, row, column, count]) => `Replace the hyphens in ${column} in ${englishDataRow(row)}, take the first ${count} characters, and return them in uppercase.`],
    [/^(\w+) を検索して (\w+) を大文字で返し、見つからない場合は (.+) と表示してください。$/, ([, lookupColumn, resultColumn, fallback]) => `Find ${resultColumn} by ${lookupColumn}, return it in uppercase, and display ${fallback} when no match is found.`],
    [/^(.+) の (\w+) を抽出し、重複を除いて昇順に並べてください。$/, ([, condition, resultColumn]) => `Return the ${resultColumn} values matching ${condition}, remove duplicates, and sort them in ascending order.`],
    [/^(\d+)行目の (\w+) を年度として判定し、1月から6月は同年、7月以降は翌年を返してください。$/, ([, row, column]) => `Treat ${column} in ${englishDataRow(row)} as a fiscal year: return the same year for January through June and the next year for July onward.`],
    [/^(\d+)行目の (\w+) の右端(\d+)文字を数値へ変換し、変換できない場合は (.+) を返してください。$/, ([, row, column, count, fallback]) => `Convert the last ${count} character${count === "1" ? "" : "s"} of ${column} in ${englishDataRow(row)} to a number and return ${fallback} if conversion fails.`],
    [/^(\d+)行目の (\w+) を数値へ変換して偶数か奇数かを判定し、(.+) または (.+) と表示してください。$/, ([, row, column, even, odd]) => `Convert ${column} in ${englishDataRow(row)} to a number, determine whether it is even or odd, and display ${even} or ${odd}.`],
  ];
  for (const [pattern, render] of patterns) {
    const match = task.match(pattern);
    if (match) return render(match as RegexCaptures);
  }
  return null;
}

export function createStandardEnglishQuestionPrompt(taskJa: unknown, { requiredFunctions = [] }: { requiredFunctions?: readonly string[] } = {}): string {
  const translated = englishTask(taskJa);
  if (translated) return `Review the table. ${translated}`;
  const functions = requiredFunctions.join(" + ") || "the indicated function";
  return `Review the table and calculate the result described in the Japanese instruction. Use ${functions}.`;
}

export function worksheetDataRowLabel(dataOrdinal: string | number): string {
  const ordinal = Number(dataOrdinal);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new TypeError("INVALID_DATA_ROW_ORDINAL");
  const position = ordinal === 1 ? "最初" : `${ordinal}件目`;
  return `表の${ordinal + 1}行目（${position}のデータ行）`;
}

export function validateQuestionPromptRowReferences({ promptJa, formula }: { promptJa?: unknown; formula?: unknown } = {}): true {
  const prompt = cleanTask(promptJa);
  assertUnambiguousWorksheetRows(prompt);
  const promptRows = [...prompt.matchAll(new RegExp(APPROVED_WORKSHEET_ROW_LABEL_SOURCE, "g"))].map((match) => {
    const visibleRow = Number(match[1]);
    const describedOrdinal = match[2] === "最初" ? 1 : Number.parseInt(match[2]!, 10);
    if (visibleRow !== describedOrdinal + 1) throw new Error("QUESTION_PROMPT_DATA_ORDINAL_MISMATCH");
    return visibleRow;
  });
  if (!promptRows.length) return true;

  const formulaRows = new Set(
    [...String(formula ?? "").normalize("NFKC").toUpperCase().matchAll(/\$?[A-Z]{1,3}\$?(\d{1,7})\b/g)]
      .map((match) => Number(match[1])),
  );
  for (const row of promptRows) {
    if (!formulaRows.has(row)) throw new Error(`QUESTION_PROMPT_ROW_FORMULA_MISMATCH:${row}`);
  }
  return true;
}

export function createFunctionHint(requiredFunctions: unknown): string {
  const functions = [...new Set(
    (Array.isArray(requiredFunctions) ? requiredFunctions : [])
      .map((name) => String(name ?? "").toUpperCase())
      .filter((name) => FUNCTION_NAME.test(name)),
  )];
  if (!functions.length) return "";
  const names = functions.join(" + ");
  return `関数のヒント：${names} / Function hint: ${names}`;
}
