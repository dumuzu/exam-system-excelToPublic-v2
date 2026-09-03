const COMPATIBLE_PAIRS: readonly (readonly [string, string])[] = Object.freeze([
  ["SUM", "ROUND"], ["SUM", "ROUNDUP"], ["SUM", "ROUNDDOWN"], ["SUM", "CEILING"],
  ["AVERAGE", "ROUND"], ["AVERAGE", "ROUNDUP"], ["AVERAGE", "ROUNDDOWN"],
  ["MAX", "XLOOKUP"], ["MIN", "XLOOKUP"], ["MAX", "IF"], ["MIN", "IF"],
  ["IF", "AND"], ["IF", "OR"], ["IF", "LEN"], ["IFS", "LEN"],
  ["COUNT", "IF"], ["COUNTA", "IF"], ["COUNTIF", "IF"], ["COUNTIFS", "IF"],
  ["IFERROR", "XLOOKUP"], ["MAXIFS", "XLOOKUP"], ["MINIFS", "XLOOKUP"],
  ["SUMIF", "ROUND"], ["SUMIF", "ROUNDUP"], ["SUMIF", "ROUNDDOWN"], ["SUMIF", "CEILING"],
  ["SUMIFS", "ROUND"], ["SUMIFS", "ROUNDUP"], ["SUMIFS", "ROUNDDOWN"], ["SUMIFS", "CEILING"],
  ["AVERAGEIF", "ROUND"], ["AVERAGEIF", "ROUNDUP"], ["AVERAGEIF", "ROUNDDOWN"],
  ["LEFT", "UPPER"], ["LEFT", "LOWER"], ["RIGHT", "UPPER"], ["RIGHT", "LOWER"],
  ["MID", "UPPER"], ["MID", "LOWER"], ["PROPER", "SUBSTITUTE"], ["UPPER", "SUBSTITUTE"],
  ["XLOOKUP", "UPPER"], ["XLOOKUP", "LOWER"],
  ["RIGHT", "VALUE"], ["IFERROR", "VALUE"], ["IF", "MOD"],
  ["TEXT", "XLOOKUP"], ["VALUE", "MOD"],
  ["ABS", "ROUND"], ["ABS", "ROUNDUP"], ["ABS", "ROUNDDOWN"],
  ["SUMPRODUCT", "ROUND"], ["SUMPRODUCT", "ROUNDUP"], ["SUMPRODUCT", "ROUNDDOWN"], ["SUMPRODUCT", "CEILING"],
  ["FILTER", "SORT"], ["FILTER", "UNIQUE"], ["SORT", "UNIQUE"],
  ["YEAR", "IF"], ["MONTH", "IF"], ["DAY", "IF"],
]);

const COMPATIBLE_TRIPLES: readonly (readonly [string, string, string])[] = Object.freeze([
  ["MAX", "XLOOKUP", "UPPER"],
  ["MIN", "XLOOKUP", "LOWER"],
  ["SUM", "ROUND", "IF"],
  ["AVERAGE", "ROUND", "IF"],
  ["SUMIF", "ROUND", "IF"],
  ["COUNTIF", "IF", "OR"],
  ["LEFT", "SUBSTITUTE", "UPPER"],
  ["IFERROR", "XLOOKUP", "UPPER"],
  ["FILTER", "UNIQUE", "SORT"],
  ["IF", "YEAR", "MONTH"],
  ["IFERROR", "VALUE", "RIGHT"],
  ["IF", "MOD", "VALUE"],
]);

const pairKey = (left: string, right: string): string => [left, right].sort().join(":");
const COMPATIBLE_PAIR_KEYS = new Set(COMPATIBLE_PAIRS.map(([left, right]) => pairKey(left, right)));
const tripleKey = (functions: readonly string[]): string => [...functions].sort().join(":");
const COMPATIBLE_TRIPLE_KEYS = new Set(COMPATIBLE_TRIPLES.map(tripleKey));

export function getCompatibleCompanions(selectedFunctionNames: readonly string[], primaryFunction: string): string[] {
  return selectedFunctionNames.filter(
    (candidate) => candidate !== primaryFunction && COMPATIBLE_PAIR_KEYS.has(pairKey(primaryFunction, candidate)),
  );
}

export function getCompatibleTriples(selectedFunctionNames: readonly string[], primaryFunction: string): string[][] {
  const selected = new Set(selectedFunctionNames);
  return COMPATIBLE_TRIPLES
    .filter((functions) => functions.includes(primaryFunction) && functions.every((name) => selected.has(name)))
    .map((functions) => functions.filter((name) => name !== primaryFunction));
}

export function createCombinationDefinition(
  primary: string,
  companion: string,
  ref: (name: string) => string,
  dataset: any,
): readonly [string, unknown, string] | null {
  if (!COMPATIBLE_PAIR_KEYS.has(pairKey(primary, companion))) return null;
  const has = (left: string, right: string): boolean => pairKey(primary, companion) === pairKey(left, right);
  const range = (name: string): string => `${ref(name)}2:${ref(name)}6`;
  const { rows, values, quantities, targetGroup, targetStatus } = dataset as {
    rows: any[]; values: any[]; quantities: any[]; targetGroup: string; targetStatus: string;
  };
  const sum = values.reduce((total, value) => total + value, 0);
  const groupValues = rows.filter((row) => row.Group === targetGroup).map((row) => row.Value);
  const groupStatusValues = rows.filter((row) => row.Group === targetGroup && row.Status === targetStatus).map((row) => row.Value);
  const sumProduct = values.reduce((total, value, index) => total + value * quantities[index], 0);
  const roundAggregate = (aggregateName: string, aggregateFormula: string, aggregateValue: number): readonly [string, unknown, string] => {
    if (companion === "ROUND" || primary === "ROUND") return [`=ROUND(${aggregateFormula},1)`, Math.round(aggregateValue * 10) / 10, `${aggregateName}を求め、小数第1位まで四捨五入してください。`];
    if (companion === "ROUNDUP" || primary === "ROUNDUP") return [`=ROUNDUP(${aggregateFormula},0)`, Math.ceil(aggregateValue), `${aggregateName}を求め、整数へ切り上げてください。`];
    if (companion === "ROUNDDOWN" || primary === "ROUNDDOWN") return [`=ROUNDDOWN(${aggregateFormula},0)`, Math.floor(aggregateValue), `${aggregateName}を求め、整数へ切り捨ててください。`];
    return [`=CEILING(${aggregateFormula},10)`, Math.ceil(aggregateValue / 10) * 10, `${aggregateName}を求め、10の倍数へ切り上げてください。`];
  };

  if (["ROUND", "ROUNDUP", "ROUNDDOWN", "CEILING"].some((name) => has("SUM", name))) return roundAggregate("Value の合計", `SUM(${range("Value")})`, sum);
  if (["ROUND", "ROUNDUP", "ROUNDDOWN"].some((name) => has("AVERAGE", name))) return roundAggregate("Value の平均", `AVERAGE(${range("Value")})`, sum / values.length);
  if (["ROUND", "ROUNDUP", "ROUNDDOWN", "CEILING"].some((name) => has("SUMIF", name))) return roundAggregate(`${targetGroup} の Value 合計`, `SUMIF(${range("Group")},"${targetGroup}",${range("Value")})`, groupValues.reduce((a, b) => a + b, 0));
  if (["ROUND", "ROUNDUP", "ROUNDDOWN", "CEILING"].some((name) => has("SUMIFS", name))) return roundAggregate(`${targetGroup} かつ ${targetStatus} の Value 合計`, `SUMIFS(${range("Value")},${range("Group")},"${targetGroup}",${range("Status")},"${targetStatus}")`, groupStatusValues.reduce((a, b) => a + b, 0));
  if (["ROUND", "ROUNDUP", "ROUNDDOWN"].some((name) => has("AVERAGEIF", name))) return roundAggregate(`${targetGroup} の Value 平均`, `AVERAGEIF(${range("Group")},"${targetGroup}",${range("Value")})`, groupValues.reduce((a, b) => a + b, 0) / groupValues.length);
  if (["ROUND", "ROUNDUP", "ROUNDDOWN", "CEILING"].some((name) => has("SUMPRODUCT", name))) return roundAggregate("Value と Qty の積の合計", `SUMPRODUCT(${range("Value")},${range("Qty")})`, sumProduct);

  if (has("MAX", "XLOOKUP")) return [`=XLOOKUP(MAX(${range("Value")}),${range("Value")},${range("Code")})`, rows[values.indexOf(Math.max(...values))].Code, "Value が最大の行にある Code を返してください。"];
  if (has("MIN", "XLOOKUP")) return [`=XLOOKUP(MIN(${range("Value")}),${range("Value")},${range("Code")})`, rows[values.indexOf(Math.min(...values))].Code, "Value が最小の行にある Code を返してください。"];
  if (has("MAX", "IF")) return [`=IF(MAX(${range("Value")})>=40,"High","Normal")`, Math.max(...values) >= 40 ? "High" : "Normal", "Value の最大値が40以上なら High、それ以外は Normal と表示してください。"];
  if (has("MIN", "IF")) return [`=IF(MIN(${range("Value")})<10,"Review","Normal")`, Math.min(...values) < 10 ? "Review" : "Normal", "Value の最小値が10未満なら Review、それ以外は Normal と表示してください。"];
  if (has("IF", "AND")) return [`=IF(AND(${ref("Value")}2>=15,${ref("Qty")}2=2),"OK","CHECK")`, values[0] >= 15 ? "OK" : "CHECK", "1行目で Value が15以上、かつ Qty が2なら OK、それ以外は CHECK と表示してください。"];
  if (has("IF", "OR")) return [`=IF(OR(${ref("Status")}2="${targetStatus}",${ref("Qty")}2>=5),"Action","Wait")`, "Action", `1行目で Status が ${targetStatus}、または Qty が5以上なら Action、それ以外は Wait と表示してください。`];
  if (has("IF", "LEN") || has("IFS", "LEN")) return has("IFS", "LEN")
    ? [`=IFS(LEN(${ref("Text")}2)>=10,"Long",TRUE,"Short")`, rows[0].Text.length >= 10 ? "Long" : "Short", "1行目の Text が10文字以上なら Long、それ以外は Short と表示してください。"]
    : [`=IF(LEN(${ref("Text")}2)>=10,"Long","Short")`, rows[0].Text.length >= 10 ? "Long" : "Short", "1行目の Text が10文字以上なら Long、それ以外は Short と表示してください。"];
  if (has("IFERROR", "XLOOKUP")) return [`=IFERROR(XLOOKUP("MISSING",${range("Code")},${range("Name")}),"Not found")`, "Not found", "存在しない Code を検索し、見つからない場合は Not found と表示してください。"];
  if (has("COUNT", "IF")) return [`=IF(COUNT(${range("Value")})=5,"Complete","Check")`, "Complete", "Value の数値セルが5個なら Complete、それ以外は Check と表示してください。"];
  if (has("COUNTA", "IF")) return [`=IF(COUNTA(${range("Mixed")})>=3,"Ready","Check")`, "Ready", "Mixed の入力済みセルが3個以上なら Ready、それ以外は Check と表示してください。"];
  if (has("COUNTIF", "IF")) return [`=IF(COUNTIF(${range("Status")},"${targetStatus}")>=3,"Busy","Normal")`, "Busy", `Status が ${targetStatus} の行を数え、3件以上なら Busy、それ以外は Normal と表示してください。`];
  if (has("COUNTIFS", "IF")) return [`=IF(COUNTIFS(${range("Group")},"${targetGroup}",${range("Status")},"${targetStatus}")>=2,"Match","Review")`, "Match", `Group が ${targetGroup} かつ Status が ${targetStatus} の行を数え、2件以上なら Match、それ以外は Review と表示してください。`];
  if (has("MAXIFS", "XLOOKUP")) { const target = Math.max(...groupValues); return [`=XLOOKUP(MAXIFS(${range("Value")},${range("Group")},"${targetGroup}"),${range("Value")},${range("Code")})`, rows.find((row) => row.Value === target).Code, `${targetGroup} の行で Value が最大となる Code を返してください。`]; }
  if (has("MINIFS", "XLOOKUP")) { const target = Math.min(...groupValues); return [`=XLOOKUP(MINIFS(${range("Value")},${range("Group")},"${targetGroup}"),${range("Value")},${range("Code")})`, rows.find((row) => row.Value === target).Code, `${targetGroup} の行で Value が最小となる Code を返してください。`]; }
  if (has("LEFT", "UPPER")) return [`=UPPER(LEFT(${ref("Text")}2,5))`, rows[0].Text.slice(0, 5).toUpperCase(), "1行目の Text の左5文字を取り出し、大文字にしてください。"];
  if (has("LEFT", "LOWER")) return [`=LOWER(LEFT(${ref("Text")}2,5))`, rows[0].Text.slice(0, 5).toLowerCase(), "1行目の Text の左5文字を取り出し、小文字にしてください。"];
  if (has("RIGHT", "UPPER")) return [`=UPPER(RIGHT(${ref("Text")}2,4))`, rows[0].Text.slice(-4).toUpperCase(), "1行目の Text の右4文字を取り出し、大文字にしてください。"];
  if (has("RIGHT", "LOWER")) return [`=LOWER(RIGHT(${ref("Text")}2,4))`, rows[0].Text.slice(-4).toLowerCase(), "1行目の Text の右4文字を取り出し、小文字にしてください。"];
  if (has("MID", "UPPER")) return [`=UPPER(MID(${ref("Text")}2,7,4))`, rows[0].Text.slice(6, 10).toUpperCase(), "1行目の Text の7文字目から4文字を取り出し、大文字にしてください。"];
  if (has("MID", "LOWER")) return [`=LOWER(MID(${ref("Text")}2,7,4))`, rows[0].Text.slice(6, 10).toLowerCase(), "1行目の Text の7文字目から4文字を取り出し、小文字にしてください。"];
  if (has("PROPER", "SUBSTITUTE")) { const replaced = rows[0].Text.replaceAll("-", " "); return [`=PROPER(SUBSTITUTE(${ref("Text")}2,"-"," "))`, replaced.replace(/\b\w/g, (value: string) => value.toUpperCase()), "1行目の Text のハイフンを空白へ置換し、各単語の先頭を大文字にしてください。"]; }
  if (has("UPPER", "SUBSTITUTE")) return [`=UPPER(SUBSTITUTE(${ref("Text")}2,"-","_"))`, rows[0].Text.replaceAll("-", "_").toUpperCase(), "1行目の Text のハイフンをアンダースコアへ置換し、全体を大文字にしてください。"];
  if (has("XLOOKUP", "UPPER")) return [`=UPPER(XLOOKUP("${rows[3].Code}",${range("Code")},${range("Name")}))`, rows[3].Name.toUpperCase(), "指定した Code の Name を検索し、大文字で返してください。"];
  if (has("XLOOKUP", "LOWER")) return [`=LOWER(XLOOKUP("${rows[3].Code}",${range("Code")},${range("Name")}))`, rows[3].Name.toLowerCase(), "指定した Code の Name を検索し、小文字で返してください。"];
  if (has("RIGHT", "VALUE")) return [`=VALUE(RIGHT(${ref("Mixed")}2,1))`, Number(String(rows[0].Mixed).slice(-1)), "1行目の Mixed の右端1文字を取り出し、計算に使える数値へ変換してください。"];
  if (has("IFERROR", "VALUE")) return [`=IFERROR(VALUE(${ref("Mixed")}4),0)`, 0, "3行目の Mixed を数値へ変換し、変換できない場合は 0 を返してください。"];
  if (has("IF", "MOD")) return [`=IF(MOD(${ref("Value")}2,2)=0,"Even","Odd")`, values[0] % 2 === 0 ? "Even" : "Odd", "1行目の Value を2で割った余りを調べ、偶数なら Even、奇数なら Odd と表示してください。"];
  if (has("TEXT", "XLOOKUP")) return [`=TEXT(XLOOKUP("${rows[3].Code}",${range("Code")},${range("Value")}),"0000")`, String(rows[3].Value).padStart(4, "0"), "指定した Code の Value を検索し、先頭を0で埋めた4桁の文字列に変換してください。"];
  if (has("VALUE", "MOD")) return [`=MOD(VALUE(${ref("Mixed")}2),2)`, Number(rows[0].Mixed) % 2, "1行目の Mixed を数値へ変換し、2で割った余りを求めてください。"];
  if (["ROUND", "ROUNDUP", "ROUNDDOWN"].some((name) => has("ABS", name))) { const base = values[0] / 7; return roundAggregate("0 から1行目の Value を引いた絶対値を7で割った値", `ABS(0-${ref("Value")}2)/7`, base); }
  if (has("FILTER", "SORT")) { const result = rows.filter((row) => row.Group === targetGroup).map((row) => row.Code).sort(); return [`=SORT(FILTER(${range("Code")},${range("Group")}="${targetGroup}"))`, result, `${targetGroup} の Code だけを抽出し、昇順に並べてください。`]; }
  if (has("FILTER", "UNIQUE")) { const result = [...new Set(rows.filter((row) => row.Status === targetStatus).map((row) => row.Group))]; return [`=UNIQUE(FILTER(${range("Group")},${range("Status")}="${targetStatus}"))`, result, `${targetStatus} の行から重複しない Group 一覧を返してください。`]; }
  if (has("SORT", "UNIQUE")) { const result = [...new Set(rows.map((row) => row.Group))].sort(); return [`=SORT(UNIQUE(${range("Group")}))`, result, "Group の重複を除き、昇順に並べてください。"]; }
  if (has("YEAR", "IF")) return [`=IF(YEAR(${ref("Date")}2)>=2026,"Current","Past")`, "Current", "1行目の Date の年が2026以上なら Current、それ以外は Past と表示してください。"];
  if (has("MONTH", "IF")) { const month = Number(rows[0].Date.slice(5, 7)); return [`=IF(MONTH(${ref("Date")}2)<=6,"H1","H2")`, month <= 6 ? "H1" : "H2", "1行目の Date が上半期なら H1、それ以外は H2 と表示してください。"]; }
  if (has("DAY", "IF")) { const day = Number(rows[0].Date.slice(8, 10)); return [`=IF(DAY(${ref("Date")}2)<=15,"Early","Late")`, day <= 15 ? "Early" : "Late", "1行目の Date の日が15日以前なら Early、それ以外は Late と表示してください。"]; }
  return null;
}

export function createTripleCombinationDefinition(
  functions: readonly string[],
  ref: (name: string) => string,
  dataset: any,
): readonly [string, unknown, string] | null {
  if (!Array.isArray(functions) || !COMPATIBLE_TRIPLE_KEYS.has(tripleKey(functions))) return null;
  const has = (...names: string[]): boolean => tripleKey(functions) === tripleKey(names);
  const range = (name: string): string => `${ref(name)}2:${ref(name)}6`;
  const { rows, values, targetGroup, targetStatus } = dataset as {
    rows: any[]; values: any[]; targetGroup: string; targetStatus: string;
  };

  if (has("MAX", "XLOOKUP", "UPPER")) {
    const row = rows[values.indexOf(Math.max(...values))];
    return [`=UPPER(XLOOKUP(MAX(${range("Value")}),${range("Value")},${range("Code")}))`, row.Code.toUpperCase(), "Value が最大の行にある Code を検索し、大文字で返してください。"];
  }
  if (has("MIN", "XLOOKUP", "LOWER")) {
    const row = rows[values.indexOf(Math.min(...values))];
    return [`=LOWER(XLOOKUP(MIN(${range("Value")}),${range("Value")},${range("Code")}))`, row.Code.toLowerCase(), "Value が最小の行にある Code を検索し、小文字で返してください。"];
  }
  if (has("SUM", "ROUND", "IF")) { const rounded = Math.round(values.reduce((total, value) => total + value, 0)); return [`=IF(ROUND(SUM(${range("Value")}),0)>=100,"High","Normal")`, rounded >= 100 ? "High" : "Normal", "Value の合計を整数へ四捨五入し、100以上なら High、それ以外は Normal と表示してください。"]; }
  if (has("AVERAGE", "ROUND", "IF")) { const rounded = Math.round(values.reduce((total, value) => total + value, 0) / values.length); return [`=IF(ROUND(AVERAGE(${range("Value")}),0)>=20,"High","Normal")`, rounded >= 20 ? "High" : "Normal", "Value の平均を整数へ四捨五入し、20以上なら High、それ以外は Normal と表示してください。"]; }
  if (has("SUMIF", "ROUND", "IF")) { const rounded = Math.round(rows.filter((row) => row.Group === targetGroup).reduce((total, row) => total + row.Value, 0)); return [`=IF(ROUND(SUMIF(${range("Group")} ,"${targetGroup}",${range("Value")}),0)>=50,"High","Normal")`, rounded >= 50 ? "High" : "Normal", `${targetGroup} の Value 合計を整数へ四捨五入し、50以上なら High、それ以外は Normal と表示してください。`]; }
  if (has("COUNTIF", "IF", "OR")) { const count = rows.filter((row) => row.Status === targetStatus).length; return [`=IF(OR(COUNTIF(${range("Status")},"${targetStatus}")>=3,${ref("Qty")}2>=5),"Action","Wait")`, count >= 3 || rows[0].Qty >= 5 ? "Action" : "Wait", `${targetStatus} が3件以上、または1行目の Qty が5以上なら Action、それ以外は Wait と表示してください。`]; }
  if (has("LEFT", "SUBSTITUTE", "UPPER")) { const value = rows[0].Text.replaceAll("-", "_").slice(0, 8).toUpperCase(); return [`=UPPER(LEFT(SUBSTITUTE(${ref("Text")}2,"-","_"),8))`, value, "1行目の Text のハイフンを置換し、左8文字を大文字で返してください。"]; }
  if (has("IFERROR", "XLOOKUP", "UPPER")) return [`=IFERROR(UPPER(XLOOKUP("MISSING",${range("Code")},${range("Name")})),"NOT FOUND")`, "NOT FOUND", "Code を検索して Name を大文字で返し、見つからない場合は NOT FOUND と表示してください。"];
  if (has("FILTER", "UNIQUE", "SORT")) { const result = [...new Set(rows.filter((row) => row.Status === targetStatus).map((row) => row.Group))].sort(); return [`=SORT(UNIQUE(FILTER(${range("Group")},${range("Status")}="${targetStatus}")))`, result, `${targetStatus} の Group を抽出し、重複を除いて昇順に並べてください。`]; }
  if (has("IF", "YEAR", "MONTH")) { const year = Number(rows[0].Date.slice(0, 4)); const month = Number(rows[0].Date.slice(5, 7)); return [`=IF(MONTH(${ref("Date")}2)<=6,YEAR(${ref("Date")}2),YEAR(${ref("Date")}2)+1)`, month <= 6 ? year : year + 1, "1行目の Date を年度として判定し、1月から6月は同年、7月以降は翌年を返してください。"]; }
  if (has("IFERROR", "VALUE", "RIGHT")) return [`=IFERROR(VALUE(RIGHT(${ref("Mixed")}2,1)),0)`, Number(String(rows[0].Mixed).slice(-1)), "1行目の Mixed の右端1文字を数値へ変換し、変換できない場合は 0 を返してください。"];
  if (has("IF", "MOD", "VALUE")) return [`=IF(MOD(VALUE(${ref("Mixed")}2),2)=0,"Even","Odd")`, Number(rows[0].Mixed) % 2 === 0 ? "Even" : "Odd", "1行目の Mixed を数値へ変換して偶数か奇数かを判定し、Even または Odd と表示してください。"];
  return null;
}

export function listCompatibleFunctionPairs(): string[][] {
  return COMPATIBLE_PAIRS.map((pair) => [...pair]);
}

export function listCompatibleFunctionTriples(): string[][] {
  return COMPATIBLE_TRIPLES.map((functions) => [...functions]);
}
