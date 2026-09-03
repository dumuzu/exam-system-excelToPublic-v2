import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const examHtmlUrl: any = new URL("../public/exam/index.html", import.meta.url);
const examScriptUrl: any = new URL("../public/exam/exam.js", import.meta.url);
const examCssUrl: any = new URL("../public/exam/exam.css", import.meta.url);

test("student entry always begins with exam code and student number", async () => {
  const [html, script] = await Promise.all([
    readFile(examHtmlUrl, "utf8"),
    readFile(examScriptUrl, "utf8"),
  ]);

  assert.match(html, /id="identity-card"/);
  assert.match(html, /id="exam-code"/);
  assert.match(html, /id="student-number"/);
  assert.match(html, /id="terminalEntryCard" hidden/);
  assert.match(script, /identityForm\.addEventListener\("submit"[\s\S]*request\("\/api\/student\/verify"/);
  assert.match(script, /studentState\.terminationCollecting[\s\S]{0,500}request\("\/api\/student\/attempt"\)/);
});

test("teacher-admission polling is staggered and never overlaps requests", async () => {
  const script: any = await readFile(examScriptUrl, "utf8");

  assert.match(script, /ADMISSION_POLL_BASE_MILLISECONDS = 5_000/);
  assert.match(script, /ADMISSION_POLL_JITTER_MILLISECONDS = 2_000/);
  assert.match(script, /studentState\.admissionTimer = setTimeout\(async \(\) =>/);
  assert.match(script, /scheduleAdmissionPoll\(\);\s*}, admissionPollDelay\(\)\);/);
  assert.doesNotMatch(script, /studentState\.admissionTimer = setInterval/);
});

test("the formal-exam preflight advertises supported macOS Safari and uses the fullscreen compatibility layer", async () => {
  const script: any = await readFile(examScriptUrl, "utf8");

  assert.match(script, /macOS Safari 16\.4\+/);
  assert.match(script, /from "\.\/fullscreen-compatibility\.js"/);
  assert.doesNotMatch(script, /document\.documentElement\.requestFullscreen\(/);
});

test("exam workspace uses the reduced desktop scale without browser zoom", async () => {
  const css: any = await readFile(examCssUrl, "utf8");
  assert.match(css, /font-size: clamp\(16px, \.7vw, 18px\)/);
  assert.match(css, /\.questionCard \{ width: min\(94vw, 2000px\)/);
  assert.match(css, /\.sheet th, \.sheet td \{ height: 44px; min-width: 140px/);
});

test("formula workspace shows function hints and hides named-range internals", async () => {
  const [html, script] = await Promise.all([
    readFile(examHtmlUrl, "utf8"),
    readFile(examScriptUrl, "utf8"),
  ]);

  assert.match(html, /id="functionCountBadge"/);
  assert.match(html, /id="question-tip"/);
  assert.doesNotMatch(html, /id="named-range-list"/);
  assert.match(script, /compositionLabelJa/);
  assert.doesNotMatch(script, /namedRangeList|Named ranges/);
});

test("worksheet headers are visually distinct from the data grid", async () => {
  const css: any = await readFile(examCssUrl, "utf8");

  assert.match(css, /\.sheet \.columnLetter, \.sheet \.rowNumber, \.sheet \.cornerCell[^}]*color: #fff[^}]*background: #365b52/s);
  assert.match(css, /\.sheet \.fieldHeader[^}]*background: #dfeae6/s);
});
