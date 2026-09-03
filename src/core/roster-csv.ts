const HEADER_ALIASES = new Map<string, "studentNumber" | "name">([
  ["student_number", "studentNumber"], ["studentnumber", "studentNumber"], ["student_id", "studentNumber"],
  ["学号", "studentNumber"], ["学生番号", "studentNumber"],
  ["name", "name"], ["student_name", "name"], ["姓名", "name"], ["氏名", "name"],
]);

function parseRows(text: string): { rows: string[][]; error?: never } | { error: string; rows?: never } {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(field); field = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = "";
    } else field += character;
  }
  if (quoted) return { error: "UNCLOSED_QUOTE" };
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  return { rows };
}

function normalizeRosterName(value: unknown): string {
  let name = String(value ?? "").normalize("NFKC").replaceAll(/\s+/g, " ").trim();
  if (name.includes("?") && /\p{L}/u.test(name.replaceAll("?", ""))) name = name.replaceAll(/\?+/g, " ").replaceAll(/\s+/g, " ").trim();
  return name;
}

export interface RosterStudent {
  readonly studentNumber: string;
  readonly name: string;
}

export interface RosterError {
  readonly code: string;
  readonly line?: number;
  readonly studentNumber?: string;
  readonly maximumStudents?: number;
}

export type RosterParseResult =
  | { readonly ok: true; readonly students: RosterStudent[]; readonly count: number }
  | { readonly ok: false; readonly errors: RosterError[] };

export function parseRosterCsv(csvText: unknown, { maximumStudents = 200 }: { maximumStudents?: number } = {}): RosterParseResult {
  if (typeof csvText !== "string" || !csvText.trim()) return { ok: false, errors: [{ code: "EMPTY_ROSTER" }] };
  const parsed = parseRows(csvText.replace(/^\uFEFF/, ""));
  if ("error" in parsed) return { ok: false, errors: [{ code: parsed.error }] };
  const [headerRow, ...rowsAfterFirst] = parsed.rows;
  if (!headerRow) return { ok: false, errors: [{ code: "EMPTY_ROSTER" }] };
  const headers = headerRow.map((value) => HEADER_ALIASES.get(value.trim().toLowerCase()) ?? null);
  const recognisedStudentNumberIndex = headers.indexOf("studentNumber"); const recognisedNameIndex = headers.indexOf("name");
  const firstRowLooksLikeStudent = /^[A-Za-z0-9-]{1,32}$/.test(headerRow[0]?.normalize("NFKC").trim() ?? "") && Boolean(headerRow[1]?.trim());
  let studentNumberIndex: number; let nameIndex: number; let dataRows: string[][]; let firstDataLine: number;
  if (recognisedStudentNumberIndex >= 0 && recognisedNameIndex >= 0) {
    studentNumberIndex = recognisedStudentNumberIndex; nameIndex = recognisedNameIndex; dataRows = rowsAfterFirst; firstDataLine = 2;
  } else if (headerRow.length >= 2 && firstRowLooksLikeStudent) {
    studentNumberIndex = 0; nameIndex = 1; dataRows = parsed.rows; firstDataLine = 1;
  } else if (headerRow.length >= 2) {
    studentNumberIndex = 0; nameIndex = 1; dataRows = rowsAfterFirst; firstDataLine = 2;
  } else return { ok: false, errors: [{ code: "MISSING_REQUIRED_HEADERS" }] };
  if (dataRows.length > maximumStudents) return { ok: false, errors: [{ code: "ROSTER_TOO_LARGE", maximumStudents }] };
  const students: RosterStudent[] = []; const errors: RosterError[] = []; const seen = new Set<string>();
  dataRows.forEach((values, index) => {
    const line = index + firstDataLine; const studentNumber = (values[studentNumberIndex] ?? "").normalize("NFKC").trim(); const name = normalizeRosterName(values[nameIndex]);
    if (!/^[A-Za-z0-9-]{1,32}$/.test(studentNumber) || !name || name.length > 100) errors.push({ code: "INVALID_ROSTER_ROW", line });
    else if (seen.has(studentNumber)) errors.push({ code: "DUPLICATE_STUDENT_NUMBER", line, studentNumber });
    else { seen.add(studentNumber); students.push({ studentNumber, name }); }
  });
  if (!students.length && !errors.length) errors.push({ code: "EMPTY_ROSTER" });
  return errors.length ? { ok: false, errors } : { ok: true, students, count: students.length };
}
