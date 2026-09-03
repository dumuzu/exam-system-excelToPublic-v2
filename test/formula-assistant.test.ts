import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFunctionCompletion,
  findActiveFunctionHelp,
  getFunctionCompletions,
} from "../src/client/exam/formula-assistant.ts";

test("formula completion suggests supported functions without revealing a required answer", () => {
  const completion: any = getFunctionCompletions("=su", 3);
  assert.equal(completion.query, "SU");
  assert.deepEqual(completion.items.slice(0, 4).map((item: any) => item.name), ["SUM", "SUMIF", "SUMIFS", "SUMPRODUCT"]);
});

test("completion replaces only the active function token and keeps nested formula text", () => {
  assert.deepEqual(applyFunctionCompletion("=IF(A2>0,av", 11, "AVERAGE"), {
    value: "=IF(A2>0,AVERAGE(",
    cursor: 17,
  });
});

test("assistant recognizes full-width formula input and returns bilingual syntax help", () => {
  const completion: any = getFunctionCompletions("＝ｘｌｏ", 4);
  assert.equal(completion.items[0].name, "XLOOKUP");

  const help: any = findActiveFunctionHelp("=IF(A2>0,SUM(A2:A6),0)", 18);
  assert.equal(help.name, "SUM");
  assert.match(help.syntax, /^SUM\(/);
  assert.ok(help.descriptionJa);
  assert.ok(help.descriptionEn);
});

test("plain text does not open formula suggestions", () => {
  assert.deepEqual(getFunctionCompletions("sum", 3).items, []);
});

test("assistant includes course-derived basic conversion and remainder functions", () => {
  for (const functionName of ["VALUE", "MOD", "TEXT"]) {
    const completion: any = getFunctionCompletions(`=${functionName.slice(0, 2)}`);
    assert.equal(completion.items.some((item: any) => item.name === functionName), true, functionName);
  }
});
