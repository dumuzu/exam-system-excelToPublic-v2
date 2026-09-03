import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getCapacityPolicyFromEnvironment,
  normalizeCapacityPolicy,
} from "../src/server/capacity-policy.ts";
import { InMemoryExamHistoryRepository } from "../src/server/exam-history-repository.ts";

test("capacity policy accepts bounded environment settings and falls back safely for malformed values", () => {
  const configured: any = getCapacityPolicyFromEnvironment({
    DATABASE_POOL_MAX: "6",
    HISTORY_LIST_LIMIT: "50",
    IN_MEMORY_HISTORY_RECORD_LIMIT: "150",
    MAX_REQUEST_BODY_KB: "96",
    MAX_ROSTER_REQUEST_BODY_KB: "160",
    MAX_AUTHORING_REQUEST_BODY_KB: "3072",
    MAX_SUBMISSION_REQUEST_BODY_KB: "1024",
    LOGIN_RATE_LIMIT: "8",
    LOGIN_RATE_WINDOW_SECONDS: "300",
    LOGIN_RATE_TRACKED_KEY_LIMIT: "2000",
  });

  assert.deepEqual(configured, {
    databasePoolMax: 6,
    historyListLimit: 50,
    inMemoryHistoryRecordLimit: 150,
    maxRequestBodyBytes: 96 * 1024,
    maxRosterRequestBodyBytes: 160 * 1024,
    maxAuthoringRequestBodyBytes: 3072 * 1024,
    maxSubmissionRequestBodyBytes: 1024 * 1024,
    loginRateLimit: 8,
    loginRateWindowMilliseconds: 300 * 1000,
    loginRateTrackedKeyLimit: 2000,
  });

  const fallback: any = getCapacityPolicyFromEnvironment({
    DATABASE_POOL_MAX: "999",
    HISTORY_LIST_LIMIT: "not-a-number",
    IN_MEMORY_HISTORY_RECORD_LIMIT: "9999",
    MAX_REQUEST_BODY_KB: "1",
    MAX_ROSTER_REQUEST_BODY_KB: "999",
    MAX_AUTHORING_REQUEST_BODY_KB: "99999",
    MAX_SUBMISSION_REQUEST_BODY_KB: "1",
    LOGIN_RATE_LIMIT: "0",
    LOGIN_RATE_WINDOW_SECONDS: "99999",
    LOGIN_RATE_TRACKED_KEY_LIMIT: "1",
  });

  assert.deepEqual(fallback, {
    databasePoolMax: 4,
    historyListLimit: 100,
    inMemoryHistoryRecordLimit: 200,
    maxRequestBodyBytes: 64 * 1024,
    maxRosterRequestBodyBytes: 256 * 1024,
    maxAuthoringRequestBodyBytes: 4 * 1024 * 1024,
    maxSubmissionRequestBodyBytes: 1280 * 1024,
    loginRateLimit: 5,
    loginRateWindowMilliseconds: 15 * 60 * 1000,
    loginRateTrackedKeyLimit: 1000,
  });
});

test("normalised injected capacity policies cannot disable safety limits", () => {
  const policy: any = normalizeCapacityPolicy({
    databasePoolMax: 6,
    historyListLimit: 3,
    inMemoryHistoryRecordLimit: 4,
    maxRequestBodyBytes: undefined,
    maxRosterRequestBodyBytes: undefined,
    maxAuthoringRequestBodyBytes: undefined,
    maxSubmissionRequestBodyBytes: undefined,
    loginRateLimit: -1,
    loginRateWindowMilliseconds: "bad",
    loginRateTrackedKeyLimit: 99_999,
  });

  assert.deepEqual(policy, {
    databasePoolMax: 6,
    historyListLimit: 3,
    inMemoryHistoryRecordLimit: 4,
    maxRequestBodyBytes: 64 * 1024,
    maxRosterRequestBodyBytes: 256 * 1024,
    maxAuthoringRequestBodyBytes: 4 * 1024 * 1024,
    maxSubmissionRequestBodyBytes: 1280 * 1024,
    loginRateLimit: 5,
    loginRateWindowMilliseconds: 15 * 60 * 1000,
    loginRateTrackedKeyLimit: 1000,
  });
  assert.equal(Object.isFrozen(policy), true);
});

test("every PostgreSQL repository receives the same bounded pool policy", async () => {
  const [serverSource, accountSource] = await Promise.all([
    readFile(new URL("../src/server/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/server/teacher-account-repository.ts", import.meta.url), "utf8"),
  ]);
  assert.match(serverSource, /createTeacherAccountRepository\(\{[\s\S]*capacityPolicy: effectiveCapacityPolicy/);
  assert.match(accountSource, /normalizeCapacityPolicy\(\{ databasePoolMax \}\)/);
  assert.doesNotMatch(accountSource, /max:\s*5,/);
});

test("history adapters bound both the returned list and temporary in-memory retention", async () => {
  const repository: any = new InMemoryExamHistoryRepository({
    historyListLimit: 2,
    inMemoryHistoryRecordLimit: 2,
  });
  const configuration: any = {
    mode: "exam",
    assignmentOptions: {},
    selectedFunctions: ["SUM"],
    plan: { version: 2 },
    createdBy: "admin",
  };

  const first: any = await repository.save({ name: "first", ...configuration });
  const second: any = await repository.save({ name: "second", ...configuration });
  const third: any = await repository.save({ name: "third", ...configuration });

  const history: any = await repository.list();
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry: any) => entry.name), ["third", "second"]);
  assert.equal(await repository.get(first.id), null);
  assert.equal((await repository.get(second.id))?.name, "second");
  assert.equal((await repository.get(third.id))?.name, "third");
});
