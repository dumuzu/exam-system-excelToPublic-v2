import assert from "node:assert/strict";
import test from "node:test";

import { uniqueBlueprintsInLockOrder } from "../src/server/student-exam-repository.ts";

test("concurrent room preparation acquires blueprint locks in one deterministic order", () => {
  const firstRoom: any = uniqueBlueprintsInLockOrder([
    { blueprintKey: "z-last", room: 1 },
    { blueprintKey: "a-first", room: 1 },
    { blueprintKey: "m-middle", room: 1 },
    { blueprintKey: "a-first", room: 1, duplicate: true },
  ]);
  const secondRoom: any = uniqueBlueprintsInLockOrder([
    { blueprintKey: "m-middle", room: 2 },
    { blueprintKey: "z-last", room: 2 },
    { blueprintKey: "a-first", room: 2 },
  ]);

  assert.deepEqual(firstRoom.map((item: any) => item.blueprintKey), ["a-first", "m-middle", "z-last"]);
  assert.deepEqual(secondRoom.map((item: any) => item.blueprintKey), firstRoom.map((item: any) => item.blueprintKey));
});
