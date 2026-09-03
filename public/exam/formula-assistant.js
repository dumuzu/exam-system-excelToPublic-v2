const functionHelp = (name, syntax, descriptionJa, descriptionEn) => ({ name, syntax, descriptionJa, descriptionEn });
export const FORMULA_FUNCTION_HELP = [
    functionHelp("SUM", "SUM(number1, [number2], …)", "数値または範囲の合計を求めます。", "Adds numbers or ranges."),
    functionHelp("SUMIF", "SUMIF(range, criteria, [sum_range])", "1つの条件に一致する値を合計します。", "Adds values matching one condition."),
    functionHelp("SUMIFS", "SUMIFS(sum_range, criteria_range1, criteria1, …)", "複数の条件に一致する値を合計します。", "Adds values matching multiple conditions."),
    functionHelp("SUMPRODUCT", "SUMPRODUCT(array1, [array2], …)", "配列の対応する要素を掛けて合計します。", "Multiplies matching array values and adds them."),
    functionHelp("AVERAGE", "AVERAGE(number1, [number2], …)", "数値または範囲の平均を求めます。", "Returns the average of numbers or ranges."),
    functionHelp("AVERAGEIF", "AVERAGEIF(range, criteria, [average_range])", "条件に一致する値の平均を求めます。", "Averages values matching a condition."),
    functionHelp("MAX", "MAX(number1, [number2], …)", "最大値を求めます。", "Returns the largest value."),
    functionHelp("MAXIFS", "MAXIFS(max_range, criteria_range1, criteria1, …)", "条件に一致する値の最大値を求めます。", "Returns the largest value matching conditions."),
    functionHelp("MIN", "MIN(number1, [number2], …)", "最小値を求めます。", "Returns the smallest value."),
    functionHelp("MINIFS", "MINIFS(min_range, criteria_range1, criteria1, …)", "条件に一致する値の最小値を求めます。", "Returns the smallest value matching conditions."),
    functionHelp("COUNT", "COUNT(value1, [value2], …)", "数値が入っているセルを数えます。", "Counts cells containing numbers."),
    functionHelp("COUNTA", "COUNTA(value1, [value2], …)", "空白でないセルを数えます。", "Counts non-empty cells."),
    functionHelp("COUNTIF", "COUNTIF(range, criteria)", "1つの条件に一致するセルを数えます。", "Counts cells matching one condition."),
    functionHelp("COUNTIFS", "COUNTIFS(criteria_range1, criteria1, …)", "複数の条件に一致するセルを数えます。", "Counts cells matching multiple conditions."),
    functionHelp("IF", "IF(logical_test, value_if_true, value_if_false)", "条件によって返す値を切り替えます。", "Returns different values based on a condition."),
    functionHelp("IFS", "IFS(logical_test1, value_if_true1, …)", "複数の条件を順番に判定します。", "Tests multiple conditions in order."),
    functionHelp("AND", "AND(logical1, [logical2], …)", "すべての条件が成立するか判定します。", "Checks whether all conditions are true."),
    functionHelp("OR", "OR(logical1, [logical2], …)", "いずれかの条件が成立するか判定します。", "Checks whether any condition is true."),
    functionHelp("IFERROR", "IFERROR(value, value_if_error)", "エラー時に代わりの値を返します。", "Returns a fallback value when an error occurs."),
    functionHelp("XLOOKUP", "XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])", "検索値に対応する値を別の範囲から返します。", "Finds a value and returns its matching result."),
    functionHelp("LEFT", "LEFT(text, [num_chars])", "文字列の左端から文字を取り出します。", "Takes characters from the left of text."),
    functionHelp("RIGHT", "RIGHT(text, [num_chars])", "文字列の右端から文字を取り出します。", "Takes characters from the right of text."),
    functionHelp("MID", "MID(text, start_num, num_chars)", "文字列の指定位置から文字を取り出します。", "Takes characters from a specified text position."),
    functionHelp("LEN", "LEN(text)", "文字数を数えます。", "Counts characters in text."),
    functionHelp("UPPER", "UPPER(text)", "英字を大文字に変換します。", "Converts text to uppercase."),
    functionHelp("LOWER", "LOWER(text)", "英字を小文字に変換します。", "Converts text to lowercase."),
    functionHelp("PROPER", "PROPER(text)", "英単語の先頭を大文字に変換します。", "Capitalizes the first letter of each word."),
    functionHelp("SUBSTITUTE", "SUBSTITUTE(text, old_text, new_text, [instance_num])", "文字列内の指定文字を置き換えます。", "Replaces specified text."),
    functionHelp("VALUE", "VALUE(text)", "数値を表す文字列を計算可能な数値へ変換します。", "Converts numeric text into a number."),
    functionHelp("TEXT", "TEXT(value, format_text)", "数値を指定した表示形式の文字列へ変換します。", "Formats a value as text."),
    functionHelp("ABS", "ABS(number)", "数値の絶対値を返します。", "Returns the absolute value."),
    functionHelp("ROUND", "ROUND(number, num_digits)", "指定桁数で四捨五入します。", "Rounds to a specified number of digits."),
    functionHelp("ROUNDUP", "ROUNDUP(number, num_digits)", "指定桁数で切り上げます。", "Rounds away from zero."),
    functionHelp("ROUNDDOWN", "ROUNDDOWN(number, num_digits)", "指定桁数で切り捨てます。", "Rounds toward zero."),
    functionHelp("CEILING", "CEILING(number, significance)", "指定した基準値の倍数に切り上げます。", "Rounds up to a multiple of significance."),
    functionHelp("MOD", "MOD(number, divisor)", "割り算の余りを返します。", "Returns the remainder after division."),
    functionHelp("YEAR", "YEAR(serial_number)", "日付から年を取り出します。", "Returns the year from a date."),
    functionHelp("MONTH", "MONTH(serial_number)", "日付から月を取り出します。", "Returns the month from a date."),
    functionHelp("DAY", "DAY(serial_number)", "日付から日を取り出します。", "Returns the day from a date."),
    functionHelp("FILTER", "FILTER(array, include, [if_empty])", "条件に一致する行を抽出します。", "Filters rows matching a condition."),
    functionHelp("SORT", "SORT(array, [sort_index], [sort_order])", "範囲または配列を並べ替えます。", "Sorts a range or array."),
    functionHelp("UNIQUE", "UNIQUE(array)", "重複を除いた一意の値を返します。", "Returns unique values."),
];
const HELP_BY_NAME = new Map(FORMULA_FUNCTION_HELP.map((item) => [item.name, item]));
function normalizedFormula(value) {
    return String(value ?? "").normalize("NFKC");
}
function completionContext(value, cursor) {
    const formula = normalizedFormula(value);
    const safeCursor = Math.max(0, Math.min(Number(cursor) || 0, formula.length));
    if (!formula.startsWith("="))
        return null;
    const match = formula.slice(0, safeCursor).match(/([A-Za-z]+)$/);
    if (!match)
        return null;
    const query = match[1];
    if (!query)
        return null;
    const start = safeCursor - query.length;
    const previous = formula[start - 1];
    if (start > 1 && (!previous || !/[,(+\-*/^]/.test(previous)))
        return null;
    return { formula, start, end: safeCursor, query: query.toUpperCase() };
}
export function getFunctionCompletions(value, cursor = String(value ?? "").length) {
    const context = completionContext(value, cursor);
    if (!context)
        return { query: "", start: cursor, end: cursor, items: [] };
    return {
        ...context,
        items: FORMULA_FUNCTION_HELP.filter((item) => item.name.startsWith(context.query)).slice(0, 8),
    };
}
export function applyFunctionCompletion(value, cursor, functionName) {
    const context = completionContext(value, cursor);
    const selected = HELP_BY_NAME.get(String(functionName ?? "").toUpperCase());
    if (!context || !selected)
        return { value: String(value ?? ""), cursor: Number(cursor) || 0 };
    const completedValue = `${context.formula.slice(0, context.start)}${selected.name}(${context.formula.slice(context.end)}`;
    return { value: completedValue, cursor: context.start + selected.name.length + 1 };
}
export function findActiveFunctionHelp(value, cursor = String(value ?? "").length) {
    const formula = normalizedFormula(value).slice(0, Math.max(0, Number(cursor) || 0));
    const stack = [];
    for (let index = 0; index < formula.length; index += 1) {
        if (formula[index] === "(") {
            const name = formula.slice(0, index).match(/([A-Za-z]+)\s*$/)?.[1]?.toUpperCase();
            stack.push(name && HELP_BY_NAME.has(name) ? name : null);
        }
        else if (formula[index] === ")") {
            stack.pop();
        }
    }
    const activeName = [...stack].reverse().find(Boolean);
    return activeName ? HELP_BY_NAME.get(activeName) ?? null : null;
}
