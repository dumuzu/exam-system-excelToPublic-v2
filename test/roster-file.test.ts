import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  MAX_EXAM_REQUEST_BODY_BYTES,
  MAX_ROSTER_FILE_BYTES,
  decodeRosterFile,
  importRosterFiles,
  jsonRequestByteLength,
} from "../src/client/shared/roster/index.ts";
import { importRosterFiles as importAuthoringRosterFiles } from "../src/client/features/exam-authoring/model/rosterImport.ts";
import { parseRosterCsv } from "../src/core/roster-csv.ts";

function fileFromBuffer(name: any, buffer: any) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
  };
}

test("teacher roster reader decodes UTF-16 Excel CSV without JSON expansion artifacts", async () => {
  const csv: any = "student_number,name\r\nS0001,山田 太郎";
  const buffer: any = Buffer.from(`\uFEFF${csv}`, "utf16le");
  const decoded: any = await decodeRosterFile(fileFromBuffer("roster.csv", buffer));

  assert.equal(decoded.encoding, "utf-16le");
  assert.equal(decoded.text, csv);
  assert.equal(decoded.text.includes("\0"), false);
  assert.equal(parseRosterCsv(decoded.text).ok, true);
});

test("a legacy 200-student Shift_JIS roster fits the dedicated upload and request budgets", async () => {
  const lines: any = [Buffer.from("student_number,name\r\n", "ascii")];
  for (let index: any = 1; index <= 200; index += 1) {
    const studentNumber: any = `S${String(index).padStart(4, "0")}${"X".repeat(27)}`;
    const encodedName: any = Buffer.from(Array.from({ length: 100 }, () => [0x8a, 0xbf]).flat());
    lines.push(Buffer.from(`${studentNumber},`, "ascii"), encodedName, Buffer.from("\r\n", "ascii"));
  }
  const buffer: any = Buffer.concat(lines);
  const decoded: any = await decodeRosterFile(fileFromBuffer("roster.CSV", buffer));
  const payload: any = { name: "large roster", rosterCsv: decoded.text };

  assert.equal(buffer.byteLength <= MAX_ROSTER_FILE_BYTES, true);
  assert.equal(decoded.encoding, "shift_jis");
  assert.equal((parseRosterCsv(decoded.text) as any).count, 200);
  assert.equal(jsonRequestByteLength(payload) > 64 * 1024, true);
  assert.equal(jsonRequestByteLength(payload) <= MAX_EXAM_REQUEST_BODY_BYTES, true);
});

test("a 500-student multilingual classroom roster fits the dedicated upload and request budgets", async () => {
  const csv: any = `student_number,name\n${Array.from({ length: 500 }, (_, index) => `C${String(index + 1).padStart(4, "0")},学生 ${index + 1} नारायण`).join("\n")}`;
  const file: any = fileFromBuffer("classroom.csv", Buffer.from(csv, "utf8"));
  const decoded: any = await decodeRosterFile(file);
  const roster: any = parseRosterCsv(decoded.text, { maximumStudents: 500 });
  const payload: any = { name: "Shared classroom", mode: "assignment", selectedFunctions: ["SUM"], rosterCsv: decoded.text };

  assert.equal(roster.ok, true);
  assert.equal(roster.count, 500);
  assert.equal(file.size <= MAX_ROSTER_FILE_BYTES, true);
  assert.equal(jsonRequestByteLength(payload) <= MAX_EXAM_REQUEST_BODY_BYTES, true);
});

test("teacher roster reader decodes Chinese Excel CSV saved as GB18030", async () => {
  const prefix: any = Buffer.from("student_number,name\r\nC001,", "ascii");
  const chineseName: any = Buffer.from([0xd5, 0xc5, 0xce, 0xb0]); // 张伟 in GBK/GB18030
  const decoded: any = await decodeRosterFile(fileFromBuffer("chinese-roster.csv", Buffer.concat([prefix, chineseName])));

  assert.equal(decoded.encoding, "gb18030");
  assert.equal(decoded.text, "student_number,name\r\nC001,张伟");
  assert.deepEqual((parseRosterCsv(decoded.text) as any).students, [{ studentNumber: "C001", name: "张伟" }]);
});

test("roster reader rejects unsupported files before upload", async () => {
  await assert.rejects(
    decodeRosterFile(fileFromBuffer("roster.txt", Buffer.from("S1,Name"))),
    { code: "ROSTER_FILE_EXTENSION_INVALID" },
  );
  await assert.rejects(
    decodeRosterFile(fileFromBuffer("roster.csv", Buffer.from([0x81]))),
    { code: "ROSTER_FILE_ENCODING_UNSUPPORTED" },
  );
});

test("teacher can merge multiple exported CSV rosters while blank spreadsheet regions are discarded", async () => {
  const paddedRows: any = [
    "学籍番号,氏名,,,,",
    "S001,Anita Rai,,,,",
    "S002,陳 明,,,,",
    ...Array.from({ length: 800 }, () => ",,,,,"),
  ];
  const first: any = fileFromBuffer("class-a.csv", Buffer.from(paddedRows.join("\r\n"), "utf8"));
  const second: any = fileFromBuffer(
    "class-b.csv",
    Buffer.from("student_number,name\nS002,陳 明\nS003,Nimal Perera", "utf8"),
  );

  const imported: any = await importRosterFiles([first, second]);

  assert.equal(imported.count, 3);
  assert.equal(imported.duplicateCount, 1);
  assert.deepEqual(imported.students, [
    { studentNumber: "S001", name: "Anita Rai" },
    { studentNumber: "S002", name: "陳 明" },
    { studentNumber: "S003", name: "Nimal Perera" },
  ]);
  assert.deepEqual(imported.previewRows, [
    { studentNumber: "S001", name: "Anita Rai", sourceFiles: ["class-a.csv"] },
    { studentNumber: "S002", name: "陳 明", sourceFiles: ["class-a.csv", "class-b.csv"] },
    { studentNumber: "S003", name: "Nimal Perera", sourceFiles: ["class-b.csv"] },
  ]);
  assert.equal(imported.files.length, 2);
  assert.equal(imported.files[0].studentCount, 2);
  assert.equal(imported.validation.ok, true);
  assert.deepEqual(imported.validation.stages.map((stage: any) => stage.code), [
    "SOURCE_FILES_PARSED",
    "STUDENT_IDENTITIES_UNIQUE",
    "CANONICAL_ROSTER_ROUND_TRIP",
  ]);
  assert.equal(imported.text, [
    "student_number,name",
    "\"S001\",\"Anita Rai\"",
    "\"S002\",\"陳 明\"",
    "\"S003\",\"Nimal Perera\"",
  ].join("\n"));
  assert.equal(Buffer.byteLength(imported.text, "utf8") < first.size, true);
});

test("teacher can import student numbers and names from a legacy Excel attendance workbook", async () => {
  const workbookParser: any = {
    read(bytes: any) {
      assert.equal(bytes instanceof Uint8Array, true);
      return {
        SheetNames: ["講義別出欠"],
        Sheets: {
          講義別出欠: {
            "!ref": "A1:IV1007",
            B5: { v: "学籍番号", t: "s" },
            C5: { v: "氏名", t: "s" },
            B6: { v: "E240001", t: "s" },
            C6: { v: "Kavya Rai", t: "s" },
            D6: { v: "出席", t: "s" },
            B7: { v: "E240002", t: "s" },
            C7: { v: "王 小明", t: "s" },
            D7: { v: "欠席", t: "s" },
          },
        },
      };
    },
  };
  const source: any = fileFromBuffer("attendance.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));

  const imported: any = await importRosterFiles([source], { workbookParser });

  assert.equal(imported.count, 2);
  assert.deepEqual(imported.students, [
    { studentNumber: "E240001", name: "Kavya Rai" },
    { studentNumber: "E240002", name: "王 小明" },
  ]);
  assert.deepEqual(imported.files[0].sheets, [
    { name: "講義別出欠", studentCount: 2 },
  ]);
  assert.equal(imported.text, [
    "student_number,name",
    "\"E240001\",\"Kavya Rai\"",
    "\"E240002\",\"王 小明\"",
  ].join("\n"));
  assert.doesNotMatch(imported.text, /出席|欠席/);
});

test("the pinned workbook parser reads real BIFF8 attendance bytes through the public importer", async () => {
  const sheet: any = XLSX.utils.aoa_to_sheet([
    ["科目", "表計算演習"],
    [],
    [],
    [],
    ["No.", "学籍番号", "氏名", "出欠"],
    [1, "E240011", "Maya Gurung", "出席"],
    [2, "E240012", "李 美玲", "欠席"],
  ]);
  const workbook: any = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "講義別出欠");
  const bytes: any = XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
  const source: any = fileFromBuffer("school-attendance.xls", bytes);

  const imported: any = await importRosterFiles([source], { workbookParser: XLSX });

  assert.equal(imported.count, 2);
  assert.deepEqual(imported.students, [
    { studentNumber: "E240011", name: "Maya Gurung" },
    { studentNumber: "E240012", name: "李 美玲" },
  ]);
});

test("the authoring importer snapshots a live file selection before the input is cleared", async () => {
  const sheet: any = XLSX.utils.aoa_to_sheet([
    ["学籍番号", "氏名", "出欠"],
    ["E240021", "Maya Gurung", "出席"],
    ["E240022", "李 美玲", "欠席"],
  ]);
  const workbook: any = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "講義別出欠");
  const bytes: any = XLSX.write(workbook, { type: "buffer", bookType: "biff8" });
  const source: any = fileFromBuffer("school-attendance.xls", bytes);
  let selectedFiles: any[] = [source];
  const liveFileList: any = Object.defineProperties({}, {
    0: { get: () => selectedFiles[0] },
    length: { get: () => selectedFiles.length },
  });

  const importing = importAuthoringRosterFiles(liveFileList, 200);
  selectedFiles = [];

  const imported: any = await importing;
  assert.equal(imported.count, 2);
});

test("multi-class roster import blocks conflicting names for the same student number", async () => {
  const first: any = fileFromBuffer(
    "class-a.csv",
    Buffer.from("student_number,name\nS001,Anita Rai", "utf8"),
  );
  const second: any = fileFromBuffer(
    "class-b.csv",
    Buffer.from("学籍番号,氏名\nS001,Anita Roy", "utf8"),
  );

  await assert.rejects(
    importRosterFiles([first, second]),
    {
      code: "ROSTER_NAME_CONFLICT",
      studentNumber: "S001",
    },
  );
});
