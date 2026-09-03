import assert from "node:assert/strict";
import test from "node:test";

import { createBusinessDataset, listBusinessScenarioKeys } from "../src/core/business-scenario-library.ts";
import {
  createCombinationDefinition,
  createTripleCombinationDefinition,
  getCompatibleCompanions,
  getCompatibleTriples,
  listCompatibleFunctionPairs,
  listCompatibleFunctionTriples,
} from "../src/core/function-combination-library.ts";

test("combination library owns every advertised compatible pair", () => {
  const dataset: any = createBusinessDataset({ random: () => 0, offset: 2 });
  const fields: any = ["Code", "Name", "Group", "Value", "Qty", "Text", "Status", "Mixed"];
  const ref: any = (name: any) => String.fromCharCode(65 + fields.indexOf(name));
  const pairs: any = listCompatibleFunctionPairs();

  assert.equal(pairs.length >= 45, true);
  for (const [primary, companion] of pairs) {
    const definition: any = createCombinationDefinition(primary, companion, ref, dataset);
    const reversed: any = createCombinationDefinition(companion, primary, ref, dataset);
    assert.equal(Array.isArray(definition), true, `${primary} + ${companion} must have a definition`);
    assert.equal(Array.isArray(reversed), true, `${companion} + ${primary} must have a definition`);
    assert.equal(definition.length, 3);
    assert.match(definition[0], new RegExp(primary, "i"));
    assert.match(definition[0], new RegExp(companion, "i"));
  }
});

test("compatible companion lookup never advertises an unsupported pair", () => {
  const selected: any = ["SUM", "ROUND", "ROUNDUP", "XLOOKUP", "UPPER", "LOWER"];
  assert.deepEqual(getCompatibleCompanions(selected, "SUM"), ["ROUND", "ROUNDUP"]);
  assert.deepEqual(getCompatibleCompanions(selected, "XLOOKUP"), ["UPPER", "LOWER"]);
});

test("course-derived basic functions participate in practical pair templates", () => {
  const pairKeys: any = new Set(listCompatibleFunctionPairs().map((pair) => [...pair].sort().join(":")));

  for (const pair of [
    ["RIGHT", "VALUE"],
    ["IFERROR", "VALUE"],
    ["IF", "MOD"],
    ["TEXT", "XLOOKUP"],
    ["VALUE", "MOD"],
  ]) {
    assert.equal(pairKeys.has([...pair].sort().join(":")), true, pair.join(" + "));
  }
});

test("combination library owns every advertised three-function template", () => {
  const dataset: any = createBusinessDataset({ random: () => 0, offset: 2 });
  const fields: any = ["Code", "Name", "Group", "Value", "Qty", "Text", "Status", "Mixed", "Date"];
  const ref: any = (name: any) => String.fromCharCode(65 + fields.indexOf(name));
  const triples: any = listCompatibleFunctionTriples();

  assert.equal(triples.length >= 8, true);
  for (const functions of triples) {
    const definition: any = createTripleCombinationDefinition(functions, ref, dataset);
    assert.equal(Array.isArray(definition), true, functions.join(" + "));
    assert.equal(definition.length, 3);
    for (const functionName of functions) assert.match(definition[0], new RegExp(functionName, "i"));
  }
  assert.equal(getCompatibleTriples(["MAX", "XLOOKUP", "UPPER", "SUM"], "MAX").length, 1);
});

test("course-derived basic functions participate in three-function templates", () => {
  const tripleKeys: any = new Set(listCompatibleFunctionTriples().map((functions) => [...functions].sort().join(":")));

  assert.equal(tripleKeys.has(["IFERROR", "VALUE", "RIGHT"].sort().join(":")), true);
  assert.equal(tripleKeys.has(["IF", "MOD", "VALUE"].sort().join(":")), true);
});

test("business scenario library provides five English-table contexts", () => {
  const keys: any = listBusinessScenarioKeys();
  const generated: any = [0, 0.2, 0.4, 0.6, 0.8].map((value) => createBusinessDataset({ random: () => value }).key);
  assert.deepEqual(generated, keys);
  assert.equal(new Set(keys).size, 5);
});
