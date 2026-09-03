import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryUrl = new URL("../src/server/student-exam-repository.ts", import.meta.url);

test("PostgreSQL submission timestamps use one explicit parameter type", async () => {
  const source = await readFile(repositoryUrl, "utf8");
  const statement = source.slice(
    source.indexOf("INSERT INTO submissions"),
    source.indexOf("const gradeParameters"),
  );

  assert.match(statement, /\$5::text/);
  assert.match(statement, /\$6::timestamptz/);
  assert.doesNotMatch(statement, /THEN \$6 ELSE/);
});
