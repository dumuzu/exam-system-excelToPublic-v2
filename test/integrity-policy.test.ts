import assert from "node:assert/strict";
import test from "node:test";

import { excelAssessmentAdapter } from "../src/assessment-types/excel/index.ts";
import {
  BROWSER_THREE_STRIKE_POLICY_ID,
  browserThreeStrikeIntegrityPolicy,
  normalizeBrowserIntegritySignal,
  validateBrowserPreflight,
} from "../src/core/integrity-policy.ts";
import { textAssessmentAdapter } from "../test-support/text-assessment-adapter.ts";

const validPreflight: any = {
  secureContext: true,
  fullscreen: true,
  localStorage: true,
  visibility: true,
  network: true,
  browserSupported: true,
  browserFamily: "chrome",
  browserVersion: 140,
};

test("browser preflight is normalized independently of an assessment type", () => {
  assert.deepEqual(validateBrowserPreflight(validPreflight), { ok: true, value: validPreflight });
  const invalid: any = validateBrowserPreflight({ ...validPreflight, network: false });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors[0].code, "BROWSER_PREFLIGHT_FAILED");
  assert.deepEqual(invalid.errors[0].details.failedCapabilities, ["network"]);
});

test("fullscreen, focus, and clipboard signals share one warning, suspension, and audit policy", () => {
  const sourceEvents: any = ["copy_blocked", "page_hidden", "fullscreen_exit"];
  let state: any = { violationCount: 0, suspended: false };
  const decisions: any = sourceEvents.map((eventType: any, index: any) => {
    const signal: any = normalizeBrowserIntegritySignal({
      eventType,
      observedAt: `2026-08-26T00:00:0${index + 1}.000Z`,
    });
    assert.equal(signal.ok, true);
    const decision: any = browserThreeStrikeIntegrityPolicy.evaluate({ mode: "exam", state, signal: signal.value });
    state = decision.state;
    return decision;
  });

  assert.deepEqual(decisions.map((decision: any) => decision.actions), [
    ["record", "warn"],
    ["record", "warn"],
    ["record", "suspend"],
  ]);
  assert.deepEqual(decisions.map((decision: any) => decision.auditEvent.decision), ["warned", "warned", "suspended"]);
  assert.equal(decisions[2].auditEvent.violationOrdinal, 3);
  assert.deepEqual(state, { violationCount: 3, suspended: true });
});

test("classroom assignment mode does not silently inherit formal-exam monitoring", () => {
  const signal: any = normalizeBrowserIntegritySignal({ eventType: "paste_blocked", observedAt: "2026-08-26T00:00:00.000Z" });
  assert.equal(signal.ok, true);
  const decision: any = browserThreeStrikeIntegrityPolicy.evaluate({
    mode: "assignment",
    state: { violationCount: 0, suspended: false },
    signal: signal.value,
  });
  assert.deepEqual(decision, {
    state: { violationCount: 0, suspended: false },
    actions: [],
    auditEvent: null,
  });
});

test("Excel and a non-Excel assessment declare compatibility with the same integrity policy", () => {
  const signal: any = normalizeBrowserIntegritySignal({ eventType: "page_hidden", observedAt: "2026-08-26T00:00:00.000Z" });
  assert.equal(signal.ok, true);
  for (const adapter of [excelAssessmentAdapter, textAssessmentAdapter]) {
    assert.equal(adapter.descriptor.compatibleIntegrityPolicyIds.includes(BROWSER_THREE_STRIKE_POLICY_ID), true);
    const decision: any = browserThreeStrikeIntegrityPolicy.evaluate({
      mode: "exam",
      state: { violationCount: 0, suspended: false },
      signal: signal.value,
    });
    assert.equal(decision.auditEvent.policyId, BROWSER_THREE_STRIKE_POLICY_ID);
    assert.equal(decision.auditEvent.decision, "warned");
  }
  assert.deepEqual(browserThreeStrikeIntegrityPolicy.descriptor.supportedModes, ["exam"]);
});
