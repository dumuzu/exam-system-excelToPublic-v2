const readings = new Map([
  ["四捨五入", "ししゃごにゅう"], ["絶対値", "ぜったいち"], ["最大値", "さいだいち"], ["最小値", "さいしょうち"],
  ["切り上げ", "きりあげ"], ["切り捨て", "きりすて"], ["取り出して", "とりだして"], ["文字列", "もじれつ"],
  ["条件", "じょうけん"], ["数値", "すうち"], ["合計", "ごうけい"], ["平均", "へいきん"], ["検索", "けんさく"],
  ["置換", "ちかん"], ["判定", "はんてい"], ["表示", "ひょうじ"], ["空白", "くうはく"], ["倍数", "ばいすう"],
  ["小数", "しょうすう"], ["行数", "ぎょうすう"], ["以上", "いじょう"], ["以外", "いがい"], ["左端", "ひだりはし"],
  ["右端", "みぎはし"], ["求めて", "もとめて"], ["割った", "わった"], ["整数", "せいすう"], ["範囲", "はんい"],
  ["並べ替えて", "ならべかえて"], ["入力済み", "にゅうりょくずみ"], ["取り除き", "とりのぞき"],
  ["確認", "かくにん"], ["指示", "しじ"], ["従って", "したがって"], ["結果", "けっか"], ["対象", "たいしょう"],
  ["抽出", "ちゅうしゅつ"], ["一覧", "いちらん"], ["昇順", "しょうじゅん"], ["重複", "ちょうふく"], ["関数", "かんすう"],
  ["先頭", "せんとう"], ["単語", "たんご"], ["年度", "ねんど"], ["残った", "のこった"],
  ["最初", "さいしょ"], ["行目", "ぎょうめ"], ["件目", "けんめ"],
]);
const terms = [...readings.keys()].sort((left, right) => right.length - left.length);

export interface JapaneseReadingToken {
  text: string;
  reading?: string;
}

function appendPlain(tokens: JapaneseReadingToken[], text: string): void {
  const previous = tokens.at(-1);
  if (previous && !previous.reading) previous.text += text;
  else tokens.push({ text });
}

export function createJapaneseReadingTokens(value: unknown): JapaneseReadingToken[] {
  const text = String(value ?? ""); const tokens: JapaneseReadingToken[] = []; const seen = new Set<string>(); let index = 0;
  while (index < text.length) {
    const term = terms.find((candidate) => text.startsWith(candidate, index));
    if (!term) { appendPlain(tokens, text[index] ?? ""); index += 1; continue; }
    if (seen.has(term)) appendPlain(tokens, term);
    else { tokens.push({ text: term, reading: readings.get(term)! }); seen.add(term); }
    index += term.length;
  }
  return tokens;
}

export function renderJapaneseWithReadings(element: Element, value: unknown): void {
  const fragment = document.createDocumentFragment();
  for (const token of createJapaneseReadingTokens(value)) {
    if (!token.reading) { fragment.append(token.text); continue; }
    const ruby = document.createElement("ruby"); ruby.append(token.text); const rt = document.createElement("rt"); rt.textContent = token.reading; ruby.append(rt); fragment.append(ruby);
  }
  element.replaceChildren(fragment);
}

export { readings as JAPANESE_READING_DICTIONARY };
