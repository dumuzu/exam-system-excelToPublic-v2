import assert from "node:assert/strict";
import test from "node:test";

import { detectSupportedBrowser } from "../src/client/exam/browser-compatibility.ts";

const cases: any = [
  ["chrome", 109, "Mozilla/5.0 Chrome/109.0.0.0 Safari/537.36"],
  ["edge", 109, "Mozilla/5.0 Chrome/109.0.0.0 Safari/537.36 Edg/109.0.1518.78"],
  ["firefox", 115, "Mozilla/5.0 Gecko/20100101 Firefox/115.0"],
];

test("macOS Safari 16.4 can enter a formal exam", () => {
  const userAgent: any = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15";

  assert.deepEqual(detectSupportedBrowser(userAgent), {
    family: "safari",
    version: 16.4,
    minimumVersion: 16.4,
    supported: true,
  });
});

test("older macOS Safari and mobile Safari remain outside the formal-exam support matrix", () => {
  const oldMacSafari: any = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Safari/605.1.15";
  const mobileSafari: any = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  assert.deepEqual(detectSupportedBrowser(oldMacSafari), {
    family: "safari",
    version: 16.3,
    minimumVersion: 16.4,
    supported: false,
  });
  assert.equal(detectSupportedBrowser(mobileSafari).supported, false);
});

test("Chrome on macOS is not misclassified as Safari", () => {
  const userAgent: any = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  assert.equal(detectSupportedBrowser(userAgent).family, "chrome");
});

for (const [family, version, userAgent] of cases) {
  test(`${family} ${version} is supported`, () => {
    assert.deepEqual(detectSupportedBrowser(userAgent), {
      family,
      version,
      minimumVersion: version,
      supported: true,
    });
  });
}

test("Edge is not misclassified as Chrome", () => {
  assert.equal(detectSupportedBrowser(cases[1][2]).family, "edge");
});

test("older and unknown browsers are rejected", () => {
  assert.equal(detectSupportedBrowser("Mozilla/5.0 Chrome/108.0.0.0 Safari/537.36").supported, false);
  assert.equal(detectSupportedBrowser("Mozilla/5.0 Firefox/114.0").supported, false);
  assert.deepEqual(detectSupportedBrowser("custom-browser"), {
    family: "unknown",
    version: null,
    minimumVersion: null,
    supported: false,
  });
});
