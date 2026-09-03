import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PostgreSQL exam deletion removes cross-referenced grade rows before attempts", async () => {
  const source: any = await readFile(
    new URL("../src/server/student-exam-repository.ts", import.meta.url),
    "utf8",
  );
  const method: any = source.slice(source.indexOf("async deleteExam({ examCode"));
  const gradeDeletion: any = method.indexOf("DELETE FROM grade_results");
  const attemptDeletion: any = method.indexOf("DELETE FROM attempts WHERE exam_id=$1");

  assert.ok(gradeDeletion >= 0, "grade results must be deleted explicitly");
  assert.ok(gradeDeletion < attemptDeletion, "grade results must be deleted before attempts cascade question instances");
});

test("PostgreSQL exam deletion clears termination failures before their restricted attempts", async () => {
  const source: any = await readFile(
    new URL("../src/server/student-exam-repository.ts", import.meta.url),
    "utf8",
  );
  const postgresMethod: any = source.slice(source.lastIndexOf("async deleteExam({ examCode"));
  const failureDeletion: any = postgresMethod.indexOf("DELETE FROM exam_termination_failures");
  const attemptDeletion: any = postgresMethod.indexOf("DELETE FROM attempts WHERE exam_id=$1");

  assert.ok(failureDeletion >= 0, "termination failures must be deleted explicitly");
  assert.ok(failureDeletion < attemptDeletion, "termination failures must be deleted before attempts");
});
