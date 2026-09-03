import { createHash } from "node:crypto";

const PRODUCTS = ["Office", "Food", "Device", "Service", "Book", "Stationery"];
const DEPARTMENTS = ["Sales", "IT", "HR", "Admin", "Support", "Finance"];

type RandomSource = () => number;

function createSeededRandom(seed: string): RandomSource {
  let state = createHash("sha256").update(seed).digest().readUInt32BE(0) || 1;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffle<Item>(items: readonly Item[], random: RandomSource): Item[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    const replacement = result[swapIndex];
    if (current === undefined || replacement === undefined) continue;
    [result[index], result[swapIndex]] = [replacement, current];
  }
  return result;
}

function spreadsheetColumn(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

/**
 * Generates one immutable starter question for the first SUM blueprint. The
 * seed is deliberately stable: refreshing or resuming creates the exact same
 * table, while another student receives different values and column order.
 */
export function generateSumStarterQuestion({ examCode, studentNumber }: { examCode: string; studentNumber: string }) {
  const random = createSeededRandom(`${examCode}:${studentNumber}:sum-starter:v1`);
  const columns = shuffle(["Product", "Department", "Sales"], random);
  const rows = Array.from({ length: 5 }, (_, index) => ({
    Product: PRODUCTS[(index + Math.floor(random() * PRODUCTS.length)) % PRODUCTS.length] ?? "Office",
    Department: DEPARTMENTS[(index + Math.floor(random() * DEPARTMENTS.length)) % DEPARTMENTS.length] ?? "Sales",
    Sales: 120 + Math.floor(random() * 881),
  }));
  const salesColumn = spreadsheetColumn(columns.indexOf("Sales"));
  const total = rows.reduce((sum, row) => sum + row.Sales, 0);

  return {
    key: "sum-starter-v1",
    functionName: "SUM",
    questionMode: "formula",
    studentPayload: {
      table: { columns, rows },
      promptJa: "「Sales」列の合計（ごうけい）を求めてください。",
      tipJa: "おすすめの関数（かんすう）：SUM",
      answerCell: `${spreadsheetColumn(columns.length)}2`,
    },
    answerKey: {
      allowedFormula: `=SUM(${salesColumn}2:${salesColumn}${rows.length + 1})`,
      expectedValue: total,
    },
    scoringRule: {
      maximumScore: 2.5,
      requiredFunction: "SUM",
      numericEpsilon: 1e-6,
      coreFunctionMissingScore: 1.5,
      version: "sum-starter-v1",
    },
  };
}
