import assert from "node:assert/strict";
import test from "node:test";
import { parseRosterCsv } from "../src/core/roster-csv.ts";

test("roster CSV accepts English, Japanese or Chinese identity headers and quoted names", () => {
  assert.deepEqual(parseRosterCsv('student_number,name\n20260001,"Anil, K."\n２０２６０００２,Maya K.'), { ok: true, count: 2, students: [{ studentNumber: "20260001", name: "Anil, K." }, { studentNumber: "20260002", name: "Maya K." }] });
  assert.equal(parseRosterCsv("学号,姓名\nN-01,राम").ok, true);
});

test("roster CSV uses the first two columns and repairs question marks used as broken name separators", () => {
  assert.deepEqual(parseRosterCsv("????,??\nE24B3522,Walisappura Dewage?Thushan Chathura Lakshan"), { ok: true, count: 1, students: [{ studentNumber: "E24B3522", name: "Walisappura Dewage Thushan Chathura Lakshan" }] });
  assert.deepEqual(parseRosterCsv("E24B3522,Student One\nE24B3524,Student Two"), { ok: true, count: 2, students: [{ studentNumber: "E24B3522", name: "Student One" }, { studentNumber: "E24B3524", name: "Student Two" }] });
});

test("roster CSV rejects duplicates, malformed rows and oversized lists", () => {
  assert.equal((parseRosterCsv("student_number,name\n1,A\n1,B") as any).errors[0].code, "DUPLICATE_STUDENT_NUMBER");
  assert.equal((parseRosterCsv("name\nA") as any).errors[0].code, "MISSING_REQUIRED_HEADERS");
  assert.equal((parseRosterCsv("student_number,name\n1,A\n2,B", { maximumStudents: 1 }) as any).errors[0].code, "ROSTER_TOO_LARGE");
});

test("roster CSV enforces the production maximum of 200 students", () => {
  const rows: any = Array.from({ length: 201 }, (_, index) => `S${index + 1},Student ${index + 1}`);
  const result: any = parseRosterCsv(`student_number,name\n${rows.join("\n")}`);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors[0], { code: "ROSTER_TOO_LARGE", maximumStudents: 200 });
});
