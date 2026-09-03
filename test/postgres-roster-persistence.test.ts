import assert from "node:assert/strict";
import test from "node:test";

import { persistExamRoster } from "../src/server/postgres-roster-persistence.ts";

function scriptedClient(responses: any) {
  const calls: any = [];
  return {
    calls,
    async query(sql: any, parameters: any) {
      calls.push({ sql, parameters });
      const response: any = responses.shift();
      if (!response) throw new Error(`Unexpected query: ${sql}`);
      return response;
    },
  };
}

test("publishing a new roster snapshots the current official name even when the global student name changed", async () => {
  const client: any = scriptedClient([
    {
      rowCount: 1,
      rows: [{ id: "student-1", student_number: "S001", name: "Current Official Name" }],
    },
    { rowCount: 1, rows: [] },
    {
      rowCount: 1,
      rows: [{ student_number: "S001", roster_name: "Current Official Name" }],
    },
  ]);

  const result: any = await persistExamRoster(client, {
    examId: "exam-1",
    roster: [{ studentNumber: "S001", name: "Current Official Name" }],
    createId: () => "student-candidate",
  });

  assert.equal(result.ok, true);
  assert.equal(result.studentCount, 1);
  assert.deepEqual(result.stages.map((stage: any) => stage.code), [
    "ROSTER_IDENTITIES_PERSISTED",
    "ROSTER_SNAPSHOT_WRITTEN",
    "ROSTER_POSTCONDITION_VERIFIED",
  ]);
  assert.match(client.calls[0].sql, /ON CONFLICT \(student_number\) DO UPDATE/);
  assert.match(client.calls[0].sql, /name_native=EXCLUDED[.]name_native/);
  assert.match(client.calls[1].sql, /INSERT INTO exam_roster \(exam_id,student_id,roster_name\)/);
  assert.deepEqual(client.calls[1].parameters, ["exam-1", "student-1", "Current Official Name"]);
});

test("publication aborts when the persisted roster snapshot does not exactly match the normalized input", async () => {
  const client: any = scriptedClient([
    {
      rowCount: 1,
      rows: [{ id: "student-1", student_number: "S001", name: "Current Official Name" }],
    },
    { rowCount: 1, rows: [] },
    {
      rowCount: 1,
      rows: [{ student_number: "S001", roster_name: "Different Name" }],
    },
  ]);

  await assert.rejects(
    persistExamRoster(client, {
      examId: "exam-1",
      roster: [{ studentNumber: "S001", name: "Current Official Name" }],
      createId: () => "student-candidate",
    }),
    { code: "ROSTER_POSTCONDITION_FAILED" },
  );
});
