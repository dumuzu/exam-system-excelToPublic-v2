import assert from "node:assert/strict";
import test from "node:test";

import { evaluateExcelFormula } from "../src/core/safe-formula-engine.ts";
import { listCompatibleFunctionPairs, listCompatibleFunctionTriples } from "../src/core/function-combination-library.ts";
import { FORMULA_FUNCTIONS, generateQuestionInstance } from "../src/core/paper-question-factory.ts";

function evaluateGenerated(instance: any) {
  return evaluateExcelFormula({
    formula: instance.answerKey.allowedFormula,
    table: instance.studentPayload.table,
  });
}

test("safe formula engine evaluates every generated single-function formula", () => {
  for (const functionName of FORMULA_FUNCTIONS) {
    const instance: any = generateQuestionInstance({
      examCode: "ENGINE-SINGLE",
      studentNumber: "S0001",
      question: { id: `single-${functionName}`, functionName, mode: "formula" },
    });
    const result: any = evaluateGenerated(instance);
    assert.equal(result.ok, true, `${functionName}: ${result.errorCode ?? "unknown error"}`);
    assert.deepEqual(result.value, instance.answerKey.expectedValue, functionName);
    assert.equal(result.functions.has(functionName), true, functionName);
  }
});

test("safe formula engine evaluates every advertised two-function combination", () => {
  for (const [primary, companion] of listCompatibleFunctionPairs()) {
    const instance: any = generateQuestionInstance({
      examCode: "ENGINE-COMBO",
      studentNumber: "S0001",
      question: { id: `combo-${primary}-${companion}`, functionName: primary, companionFunction: companion, mode: "formula" },
    });
    const result: any = evaluateGenerated(instance);
    assert.equal(result.ok, true, `${primary}+${companion}: ${result.errorCode ?? "unknown error"}`);
    assert.deepEqual(result.value, instance.answerKey.expectedValue, `${primary}+${companion}`);
    assert.equal(result.functions.has(primary), true, primary);
    assert.equal(result.functions.has(companion), true, companion);
  }
});

test("safe formula engine evaluates every advertised three-function combination", () => {
  for (const functions of listCompatibleFunctionTriples()) {
    const [primary, ...companions] = functions;
    const instance: any = generateQuestionInstance({
      examCode: "ENGINE-TRIPLE",
      studentNumber: "S0001",
      question: { id: `triple-${functions.join("-")}`, functionName: primary, tripleCandidates: [companions], mode: "formula" },
    });
    const result: any = evaluateGenerated(instance);
    assert.equal(result.ok, true, `${functions.join("+")}: ${result.errorCode ?? "unknown error"}`);
    assert.deepEqual(result.value, instance.answerKey.expectedValue, functions.join("+"));
    for (const functionName of functions) assert.equal(result.functions.has(functionName), true, functionName);
  }
});

test("safe formula engine accepts equivalent references and common operators", () => {
  const table: any = { columns: ["Item", "Value"], rows: [{ Item: "A", Value: 10 }, { Item: "B", Value: 20 }] };
  assert.equal(evaluateExcelFormula({ formula: " = SUM( $B$2 : B$5 ) ", table }).value, 30);
  assert.equal(evaluateExcelFormula({ formula: "=IF((B2+B3)/2>=15,\"OK\",\"NO\")", table }).value, "OK");
  assert.equal(evaluateExcelFormula({ formula: "=\"A\"&\"B\"", table }).value, "AB");
  assert.equal(evaluateExcelFormula({ formula: "＝ｓｕｍ（Ｂ２：Ｂ３）", table }).value, 30);
});

test("safe formula engine keeps decimal arithmetic exact and uses Excel rounding", () => {
  const table: any = { columns: ["Price", "Qty"], rows: [{ Price: 0.1, Qty: 3 }, { Price: 0.2, Qty: 2 }] };
  const addition: any = evaluateExcelFormula({ formula: "=0.1+0.2", table });
  assert.equal(addition.value, 0.3);
  assert.equal(addition.exactValue, "0.3");
  assert.equal(evaluateExcelFormula({ formula: "=ROUND(2.675,2)", table }).exactValue, "2.68");
  assert.equal(evaluateExcelFormula({ formula: "=SUMPRODUCT(A2:A3,B2:B3)", table }).exactValue, "0.7");
});

test("safe formula engine converts localized numeric text with VALUE", () => {
  const table: any = { columns: ["Numeric Text"], rows: [{ "Numeric Text": "１,２３４.５０" }] };

  assert.equal(evaluateExcelFormula({ formula: "=VALUE(A2)", table }).exactValue, "1234.5");
  assert.equal(evaluateExcelFormula({ formula: "=VALUE(\"12.5%\")", table }).exactValue, "0.125");
  assert.equal(evaluateExcelFormula({ formula: "=VALUE(\"not a number\")", table }).errorCode, "NUMBER_REQUIRED");
});

test("safe formula engine evaluates MOD with Excel divisor-sign behavior", () => {
  const table: any = { columns: ["Value"], rows: [{ Value: 17 }] };

  assert.equal(evaluateExcelFormula({ formula: "=MOD(A2,5)", table }).value, 2);
  assert.equal(evaluateExcelFormula({ formula: "=MOD(-3,2)", table }).value, 1);
  assert.equal(evaluateExcelFormula({ formula: "=MOD(3,-2)", table }).value, -1);
  assert.equal(evaluateExcelFormula({ formula: "=MOD(A2,0)", table }).errorCode, "DIVISION_BY_ZERO");
});

test("safe formula engine supports a bounded set of common TEXT formats", () => {
  const table: any = { columns: ["Value", "Date"], rows: [{ Value: 42, Date: "2026-07-15" }] };

  assert.equal(evaluateExcelFormula({ formula: "=TEXT(A2,\"0000\")", table }).value, "0042");
  assert.equal(evaluateExcelFormula({ formula: "=TEXT(12.345,\"0.00\")", table }).value, "12.35");
  assert.equal(evaluateExcelFormula({ formula: "=TEXT(12345.6,\"#,##0.00\")", table }).value, "12,345.60");
  assert.equal(evaluateExcelFormula({ formula: "=TEXT(B2,\"yyyy/mm/dd\")", table }).value, "2026/07/15");
  assert.equal(evaluateExcelFormula({ formula: "=TEXT(A2,\"unsupported\")", table }).errorCode, "UNSUPPORTED_TEXT_FORMAT");
});

test("safe formula engine resolves declared names and table-scoped whole columns", () => {
  const table: any = {
    columns: ["Code", "Group", "Sales"],
    rows: [
      { Code: "P-1", Group: "East", Sales: 10.5 },
      { Code: "P-2", Group: "West", Sales: 20.25 },
      { Code: "P-3", Group: "East", Sales: 30.75 },
    ],
    namedRanges: { SalesValues: "C2:C4", EastGroups: "B2:B4" },
  };

  assert.equal(evaluateExcelFormula({ formula: "=SUM(SalesValues)", table }).exactValue, "61.5");
  assert.equal(evaluateExcelFormula({ formula: "=COUNT(C:C)", table }).value, 3);
  assert.equal(evaluateExcelFormula({ formula: "=COUNTIF(EastGroups,\"East\")", table }).value, 2);
  assert.equal(evaluateExcelFormula({ formula: "=SUM(UnknownName)", table }).errorCode, "UNKNOWN_NAME");
});

test("safe formula engine evaluates bounded dynamic arrays and declared spill ranges", () => {
  const table: any = {
    columns: ["Product", "Group", "Sales"],
    rows: [
      { Product: "P-1", Group: "East", Sales: 10 },
      { Product: "P-2", Group: "West", Sales: 20 },
      { Product: "P-3", Group: "East", Sales: 30 },
      { Product: "P-4", Group: "West", Sales: 40 },
    ],
    spillRanges: { A2: "C2:C3" },
  };

  assert.deepEqual(
    evaluateExcelFormula({ formula: "=FILTER(A2:C5,B2:B5=\"East\")", table }).value,
    [["P-1", "East", 10], ["P-3", "East", 30]],
  );
  assert.deepEqual(evaluateExcelFormula({ formula: "=SORT(UNIQUE(B2:B5))", table }).value, ["East", "West"]);
  assert.equal(evaluateExcelFormula({ formula: "=SUM(FILTER(C2:C5,B2:B5=\"East\"))", table }).value, 40);
  assert.equal(evaluateExcelFormula({ formula: "=SUM(A2#)", table }).value, 30);
  assert.equal(evaluateExcelFormula({ formula: "=SUM(B2#)", table }).errorCode, "UNKNOWN_SPILL_RANGE");
});

test("safe formula engine evaluates ISO and Excel-serial date functions deterministically", () => {
  const table: any = {
    columns: ["OrderDate", "SerialDate"],
    rows: [{ OrderDate: "2026-07-13", SerialDate: 45292 }],
  };

  assert.equal(evaluateExcelFormula({ formula: "=YEAR(A2)", table }).value, 2026);
  assert.equal(evaluateExcelFormula({ formula: "=MONTH(A2)", table }).value, 7);
  assert.equal(evaluateExcelFormula({ formula: "=DAY(A2)", table }).value, 13);
  assert.equal(evaluateExcelFormula({ formula: "=YEAR(B2)", table }).value, 2024);
  assert.equal(evaluateExcelFormula({ formula: "=MONTH(\"2026-02-30\")", table }).errorCode, "INVALID_DATE");
});

test("safe formula engine rejects code execution, unsupported functions and resource abuse", () => {
  const table: any = { columns: ["Value"], rows: [{ Value: 1 }] };
  for (const formula of [
    "=process.exit()",
    "=CONSTRUCTOR(1)",
    "=SUM(A2:A1000000)",
    "=IFERROR(SUM(A2:A1000000),0)",
    "=2^1000000",
    "=(-1)^0.5",
    "=1E999999",
    `=${"(".repeat(80)}1${")".repeat(80)}`,
  ]) {
    const result: any = evaluateExcelFormula({ formula, table });
    assert.equal(result.ok, false, formula);
    assert.equal(result.value, null, formula);
  }
});
