/** 将教师选择的多个名册文件合并为规范名册，原始工作簿只在浏览器内解析。 */
export const MAX_ROSTER_FILE_BYTES: any = 128 * 1024;
export const MAX_EXAM_REQUEST_BODY_BYTES: any = 256 * 1024;
export const MAX_ROSTER_SOURCE_FILE_BYTES: any = 2 * 1024 * 1024;
export const MAX_ROSTER_SOURCE_FILES: any = 30;
export const MAX_ROSTER_SOURCE_TOTAL_BYTES: any = 20 * 1024 * 1024;

export class RosterFileError extends Error {
  [legacyKey: string]: any;
  declare code: string;
  declare isRosterError: boolean;
  constructor(code: any, details = {}) {
    super(code);
    this.name = "RosterFileError";
    this.code = code;
    this.isRosterError = true;
    Object.assign(this, details);
  }
}

function startsWith(bytes: any, prefix: any) {
  return prefix.every((value: any, index: any) => bytes[index] === value);
}

function inferUtf16Encoding(bytes: any) {
  const sampleLength: any = Math.min(bytes.length - (bytes.length % 2), 512);
  if (sampleLength < 8) return null;
  let evenNulls: any = 0;
  let oddNulls: any = 0;
  for (let index: any = 0; index < sampleLength; index += 2) {
    if (bytes[index] === 0) evenNulls += 1;
    if (bytes[index + 1] === 0) oddNulls += 1;
  }
  const pairCount: any = sampleLength / 2;
  if (oddNulls / pairCount >= 0.3 && evenNulls / pairCount <= 0.05) return "utf-16le";
  if (evenNulls / pairCount >= 0.3 && oddNulls / pairCount <= 0.05) return "utf-16be";
  return null;
}

function decode(bytes: any, encoding: any) {
  const text: any = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new RosterFileError("ROSTER_FILE_ENCODING_UNSUPPORTED");
  return text;
}

function legacyDecodeScore(text: any) {
  let score: any = 0;
  const header: any = text.split(/\r?\n/, 1)[0]?.normalize("NFKC").toLowerCase() ?? "";
  if (/(student_number|studentnumber|student_id|学生番号|学号)/.test(header)) score += 20;
  if (/(name|student_name|氏名|姓名)/.test(header)) score += 20;
  score -= (text.match(/[\uFF61-\uFF9F]/g)?.length ?? 0) * 5;
  score -= (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g)?.length ?? 0) * 20;
  score -= (text.match(/[\uE000-\uF8FF]/g)?.length ?? 0) * 10;
  return score;
}

function decodeLegacyCsv(bytes: any) {
  const candidates: any = [];
  for (const encoding of ["shift_jis", "gb18030"]) {
    try {
      const text: any = decode(bytes, encoding);
      candidates.push({ text, encoding, score: legacyDecodeScore(text) });
    } catch (error: any) {
      if (!(error instanceof TypeError) && !(error instanceof RosterFileError)) throw error;
    }
  }
  return candidates.sort((left: any, right: any) => right.score - left.score)[0] ?? null;
}

function decodeRosterBytes(bytes: any) {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return { text: decode(bytes, "utf-8"), encoding: "utf-8" };
  if (startsWith(bytes, [0xff, 0xfe])) return { text: decode(bytes, "utf-16le"), encoding: "utf-16le" };
  if (startsWith(bytes, [0xfe, 0xff])) return { text: decode(bytes, "utf-16be"), encoding: "utf-16be" };

  const inferredUtf16: any = inferUtf16Encoding(bytes);
  if (inferredUtf16) return { text: decode(bytes, inferredUtf16), encoding: inferredUtf16 };

  try {
    return { text: decode(bytes, "utf-8"), encoding: "utf-8" };
  } catch (error: any) {
    if (!(error instanceof TypeError) && !(error instanceof RosterFileError)) throw error;
  }
  const legacy: any = decodeLegacyCsv(bytes);
  if (legacy) return { text: legacy.text, encoding: legacy.encoding };
  throw new RosterFileError("ROSTER_FILE_ENCODING_UNSUPPORTED");
}

export async function decodeRosterFile(file: any) {
  if (!file) throw new RosterFileError("ROSTER_FILE_REQUIRED");
  if (!/\.csv$/i.test(file.name ?? "")) throw new RosterFileError("ROSTER_FILE_EXTENSION_INVALID");
  if (!Number.isFinite(file.size) || file.size <= 0) throw new RosterFileError("ROSTER_FILE_EMPTY");
  if (file.size > MAX_ROSTER_FILE_BYTES) throw new RosterFileError("ROSTER_FILE_TOO_LARGE");
  if (typeof file.arrayBuffer !== "function") throw new RosterFileError("ROSTER_FILE_ENCODING_UNSUPPORTED");

  const bytes: any = new Uint8Array(await file.arrayBuffer());
  return { ...decodeRosterBytes(bytes), originalByteLength: bytes.byteLength };
}

const HEADER_ALIASES: any = new Map([
  ["student_number", "studentNumber"], ["studentnumber", "studentNumber"], ["student_id", "studentNumber"],
  ["学号", "studentNumber"], ["学生番号", "studentNumber"], ["学籍番号", "studentNumber"],
  ["name", "name"], ["student_name", "name"], ["姓名", "name"], ["氏名", "name"], ["学生氏名", "name"],
]);

function parseCsvRows(text: any) {
  const rows: any = [];
  let row: any = [];
  let field: any = "";
  let quoted: any = false;
  for (let index: any = 0; index < text.length; index += 1) {
    const character: any = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") {
      row.push(field);
      field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value: any) => String(value).trim())) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new RosterFileError("UNCLOSED_QUOTE");
  row.push(field);
  if (row.some((value: any) => String(value).trim())) rows.push(row);
  return rows;
}

function normaliseHeader(value: any) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}

function normaliseStudentNumber(value: any) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normaliseRosterName(value: any) {
  let name: any = String(value ?? "").normalize("NFKC").replaceAll(/\s+/g, " ").trim();
  if (name.includes("?") && /\p{L}/u.test(name.replaceAll("?", ""))) {
    name = name.replaceAll(/\?+/g, " ").replaceAll(/\s+/g, " ").trim();
  }
  return name;
}

function findRosterHeaders(rows: any) {
  for (let rowIndex: any = 0; rowIndex < rows.length; rowIndex += 1) {
    const headers: any = rows[rowIndex].map((value: any) => HEADER_ALIASES.get(normaliseHeader(value)) ?? null);
    const studentNumberIndex: any = headers.indexOf("studentNumber");
    const nameIndex: any = headers.indexOf("name");
    if (studentNumberIndex >= 0 && nameIndex >= 0) {
      return { rowIndex, studentNumberIndex, nameIndex };
    }
  }
  return null;
}

function extractRosterRows(rows: any, source: any) {
  if (!rows.length) throw new RosterFileError("ROSTER_FILE_EMPTY", { source });
  const headers: any = findRosterHeaders(rows);
  const firstRowLooksLikeStudent: any = /^[A-Za-z0-9-]{1,32}$/.test(normaliseStudentNumber(rows[0]?.[0]))
    && Boolean(normaliseRosterName(rows[0]?.[1]));
  const layout: any = headers ?? {
    rowIndex: firstRowLooksLikeStudent ? -1 : 0,
    studentNumberIndex: 0,
    nameIndex: 1,
  };
  const students: any = [];
  const invalidRows: any = [];
  for (let rowIndex: any = layout.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const values: any = rows[rowIndex];
    const studentNumber: any = normaliseStudentNumber(values[layout.studentNumberIndex]);
    const name: any = normaliseRosterName(values[layout.nameIndex]);
    if (!studentNumber && !name) continue;
    if (!/^[A-Za-z0-9-]{1,32}$/.test(studentNumber) || !name || name.length > 100) {
      invalidRows.push(rowIndex + 1);
      continue;
    }
    students.push({ studentNumber, name, source, row: rowIndex + 1 });
  }
  if (invalidRows.length) {
    throw new RosterFileError("INVALID_ROSTER_ROW", {
      source,
      row: invalidRows[0],
      invalidRowCount: invalidRows.length,
    });
  }
  if (!students.length) throw new RosterFileError("EMPTY_ROSTER", { source });
  return students;
}

function csvCell(value: any) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function serialiseRoster(students: any) {
  return [
    "student_number,name",
    ...students.map(({ studentNumber, name }: any) => `${csvCell(studentNumber)},${csvCell(name)}`),
  ].join("\n");
}

function validateCanonicalRosterRoundTrip(text: any, expectedStudents: any) {
  const parsed: any = extractRosterRows(
    parseCsvRows(text),
    { fileName: "canonical-roster.csv", sheetName: null },
  ).map(({ studentNumber, name }: any) => ({ studentNumber, name }));
  if (parsed.length !== expectedStudents.length) {
    throw new RosterFileError("ROSTER_ROUND_TRIP_FAILED");
  }
  for (let index: any = 0; index < expectedStudents.length; index += 1) {
    if (parsed[index].studentNumber !== expectedStudents[index].studentNumber
      || parsed[index].name !== expectedStudents[index].name) {
      throw new RosterFileError("ROSTER_ROUND_TRIP_FAILED");
    }
  }
}

async function readSourceFile(file: any) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new RosterFileError("ROSTER_FILE_ENCODING_UNSUPPORTED");
  }
  const bytes: any = new Uint8Array(await file.arrayBuffer());
  return { bytes, ...decodeRosterBytes(bytes) };
}

function decodeCellAddress(address: any) {
  const matched: any = /^\$?([A-Z]+)\$?(\d+)$/i.exec(address);
  if (!matched) return null;
  let column: any = 0;
  for (const character of matched[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { column: column - 1, row: Number(matched[2]) - 1 };
}

function encodeColumn(column: any) {
  let value: any = column + 1;
  let label: any = "";
  while (value > 0) {
    const remainder: any = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function workbookCellText(cell: any) {
  if (!cell) return "";
  const value: any = cell.w ?? cell.v ?? "";
  return String(value);
}

function findWorksheetLayout(sheet: any) {
  const rows: any = new Map();
  let maximumRow: any = -1;
  for (const address of Object.keys(sheet ?? {})) {
    if (address.startsWith("!")) continue;
    const coordinate: any = decodeCellAddress(address);
    if (!coordinate) continue;
    maximumRow = Math.max(maximumRow, coordinate.row);
    const alias: any = HEADER_ALIASES.get(normaliseHeader(workbookCellText(sheet[address])));
    if (!alias) continue;
    const row: any = rows.get(coordinate.row) ?? {};
    if (alias === "studentNumber") row.studentNumberIndex = coordinate.column;
    if (alias === "name") row.nameIndex = coordinate.column;
    rows.set(coordinate.row, row);
  }
  const header: any = [...rows.entries()]
    .filter(([, value]) => Number.isInteger(value.studentNumberIndex) && Number.isInteger(value.nameIndex))
    .sort(([left], [right]) => left - right)[0];
  if (!header) return null;
  return {
    headerRow: header[0],
    studentNumberIndex: header[1].studentNumberIndex,
    nameIndex: header[1].nameIndex,
    maximumRow,
  };
}

function extractRosterWorksheet(sheet: any, source: any) {
  const layout: any = findWorksheetLayout(sheet);
  if (!layout) return null;
  const rows: any = [];
  let consecutiveBlankRows: any = 0;
  for (let row: any = layout.headerRow + 1; row <= layout.maximumRow; row += 1) {
    const studentNumber: any = normaliseStudentNumber(
      workbookCellText(sheet[`${encodeColumn(layout.studentNumberIndex)}${row + 1}`]),
    );
    const name: any = normaliseRosterName(
      workbookCellText(sheet[`${encodeColumn(layout.nameIndex)}${row + 1}`]),
    );
    if (!studentNumber && !name) {
      consecutiveBlankRows += 1;
      if (rows.length && consecutiveBlankRows >= 20) break;
      continue;
    }
    consecutiveBlankRows = 0;
    if (!/^[A-Za-z0-9-]{1,32}$/.test(studentNumber) || !name || name.length > 100) {
      throw new RosterFileError("INVALID_ROSTER_ROW", { source, row: row + 1 });
    }
    rows.push({ studentNumber, name, source, row: row + 1 });
  }
  return rows;
}

function isVisibleWorksheet(workbook: any, index: any) {
  return Number(workbook?.Workbook?.Sheets?.[index]?.Hidden ?? 0) === 0;
}

function extractRosterWorkbook(workbook: any, fileName: any) {
  const students: any = [];
  const sheets: any = [];
  for (const [index, sheetName] of (workbook?.SheetNames ?? []).entries()) {
    if (!isVisibleWorksheet(workbook, index)) continue;
    const source: any = { fileName, sheetName };
    const extracted: any = extractRosterWorksheet(workbook.Sheets?.[sheetName], source);
    if (!extracted) continue;
    students.push(...extracted);
    sheets.push({ name: sheetName, studentCount: extracted.length });
  }
  if (!sheets.length) throw new RosterFileError("ROSTER_HEADERS_NOT_FOUND", { source: { fileName } });
  if (!students.length) throw new RosterFileError("EMPTY_ROSTER", { source: { fileName } });
  return { students, sheets };
}

/** 输出经过校验的两列名册，避免原始工作簿跨越服务端信任边界。 */
export async function importRosterFiles(files: any, { maximumStudents = 500, workbookParser = null }: any = {}) {
  const sourceFiles: any = Array.from(files ?? []);
  if (!sourceFiles.length) throw new RosterFileError("ROSTER_FILE_REQUIRED");
  if (sourceFiles.length > MAX_ROSTER_SOURCE_FILES) {
    throw new RosterFileError("ROSTER_FILE_COUNT_EXCEEDED", { maximumFiles: MAX_ROSTER_SOURCE_FILES });
  }
  const totalBytes: any = sourceFiles.reduce((sum: any, file: any) => sum + (Number(file?.size) || 0), 0);
  if (totalBytes > MAX_ROSTER_SOURCE_TOTAL_BYTES) {
    throw new RosterFileError("ROSTER_SOURCE_TOTAL_TOO_LARGE");
  }

  const extracted: any = [];
  const fileSummaries: any = [];
  for (const file of sourceFiles) {
    if (!Number.isFinite(file?.size) || file.size <= 0) {
      throw new RosterFileError("ROSTER_FILE_EMPTY", { source: file?.name ?? "" });
    }
    if (file.size > MAX_ROSTER_SOURCE_FILE_BYTES) {
      throw new RosterFileError("ROSTER_FILE_TOO_LARGE", { source: file.name });
    }
    const extension: any = /\.([^.]+)$/.exec(file.name ?? "")?.[1]?.toLowerCase() ?? "";
    if (!["csv", "xls", "xlsx"].includes(extension)) {
      throw new RosterFileError("ROSTER_FILE_EXTENSION_INVALID", { source: file.name });
    }
    if (extension === "csv") {
      const decoded: any = await readSourceFile(file);
      const students: any = extractRosterRows(parseCsvRows(decoded.text), { fileName: file.name, sheetName: null });
      extracted.push(...students);
      fileSummaries.push({
        name: file.name,
        studentCount: students.length,
        sheetCount: 1,
        sheets: [{ name: "CSV", studentCount: students.length }],
        encoding: decoded.encoding,
        originalByteLength: decoded.bytes.byteLength,
      });
    } else {
      const bytes: any = new Uint8Array(await file.arrayBuffer());
      if (!workbookParser?.read) {
        throw new RosterFileError("ROSTER_WORKBOOK_PARSER_UNAVAILABLE", { source: file.name });
      }
      const parser: any = workbookParser;
      let workbook;
      try {
        workbook = parser.read(bytes, {
          type: "array",
          cellDates: false,
          cellText: true,
          bookVBA: false,
        });
      } catch (error: any) {
        throw new RosterFileError("ROSTER_FILE_PARSE_FAILED", { source: file.name, cause: error });
      }
      const imported: any = extractRosterWorkbook(workbook, file.name);
      extracted.push(...imported.students);
      fileSummaries.push({
        name: file.name,
        studentCount: imported.students.length,
        sheetCount: imported.sheets.length,
        sheets: imported.sheets,
        encoding: null,
        originalByteLength: bytes.byteLength,
      });
    }
  }

  const students: any = [];
  const byStudentNumber: any = new Map();
  let duplicateCount: any = 0;
  for (const item of extracted) {
    const key: any = item.studentNumber.toUpperCase();
    const existing: any = byStudentNumber.get(key);
    if (!existing) {
      const student: any = { studentNumber: item.studentNumber, name: item.name };
      byStudentNumber.set(key, {
        student,
        source: item.source,
        row: item.row,
        sourceFiles: new Set([item.source?.fileName].filter(Boolean)),
      });
      students.push(student);
    } else if (existing.student.name === item.name) {
      duplicateCount += 1;
      if (item.source?.fileName) existing.sourceFiles.add(item.source.fileName);
    } else {
      throw new RosterFileError("ROSTER_NAME_CONFLICT", {
        studentNumber: item.studentNumber,
        source: item.source,
        previousSource: existing.source,
      });
    }
  }
  if (students.length > maximumStudents) {
    throw new RosterFileError("ROSTER_TOO_LARGE", { maximumStudents, count: students.length });
  }
  const text: any = serialiseRoster(students);
  if (new TextEncoder().encode(text).byteLength > MAX_ROSTER_FILE_BYTES) {
    throw new RosterFileError("ROSTER_NORMALIZED_TOO_LARGE");
  }
  validateCanonicalRosterRoundTrip(text, students);
  const previewRows: any = students.map((student: any) => {
    const imported: any = byStudentNumber.get(student.studentNumber.toUpperCase());
    return {
      ...student,
      sourceFiles: [...(imported?.sourceFiles ?? [])],
    };
  });
  return {
    text,
    students,
    previewRows,
    count: students.length,
    duplicateCount,
    files: fileSummaries,
    sourceFileCount: sourceFiles.length,
    originalByteLength: totalBytes,
    validation: {
      ok: true,
      stages: [
        { code: "SOURCE_FILES_PARSED", count: sourceFiles.length },
        { code: "STUDENT_IDENTITIES_UNIQUE", count: students.length },
        { code: "CANONICAL_ROSTER_ROUND_TRIP", count: students.length },
      ],
    },
  };
}

export function jsonRequestByteLength(value: any) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
