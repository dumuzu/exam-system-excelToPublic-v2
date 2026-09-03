import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSIENT_FOCUS_LOSS_MS,
  createAssessmentNavigationGuard,
  createBrowserIntegritySignal,
  createExamNavigationGuard,
  createTransientFocusGuard,
  shouldBlockHorizontalNavigation,
} from "../src/client/exam/exam-behavior-guard.ts";

class FocusDocument extends EventTarget {
  visibilityState = "visible";
  focused = true;

  hasFocus() {
    return this.focused;
  }
}

test("browser detectors emit subject-independent integrity signals", () => {
  assert.equal(createExamNavigationGuard, createAssessmentNavigationGuard);
  assert.deepEqual(createBrowserIntegritySignal("page_hidden", "2026-08-26T00:00:00.000Z"), {
    kind: "focus_lost",
    sourceEventType: "page_hidden",
    observedAt: "2026-08-26T00:00:00.000Z",
    details: {},
  });
  assert.deepEqual(createBrowserIntegritySignal("paste_blocked", "2026-08-26T00:00:01.000Z"), {
    kind: "clipboard_attempt",
    sourceEventType: "paste_blocked",
    observedAt: "2026-08-26T00:00:01.000Z",
    details: { operation: "paste" },
  });
  assert.throws(() => createBrowserIntegritySignal("unknown", "2026-08-26T00:00:00.000Z"), /UNKNOWN_INTEGRITY_EVENT/);
});

test("brief blur and visibility changes are cancelled before becoming violations", () => {
  const documentRef: any = new FocusDocument();
  const windowRef: any = new EventTarget();
  let pendingCallback: any = null;
  let violationCount: any = 0;
  const guard: any = createTransientFocusGuard({
    documentRef,
    windowRef,
    shouldMonitor: () => true,
    onConfirmedLoss: () => { violationCount += 1; },
    scheduleTimer: (callback: any, delay: any) => {
      assert.equal(delay, TRANSIENT_FOCUS_LOSS_MS);
      pendingCallback = callback;
      return 1;
    },
    cancelTimer: () => { pendingCallback = null; },
  });

  documentRef.visibilityState = "hidden";
  documentRef.focused = false;
  documentRef.dispatchEvent(new Event("visibilitychange"));
  assert.equal(typeof pendingCallback, "function");

  documentRef.visibilityState = "visible";
  documentRef.focused = true;
  documentRef.dispatchEvent(new Event("visibilitychange"));
  assert.equal(pendingCallback, null);
  assert.equal(violationCount, 0);

  windowRef.dispatchEvent(new Event("resize"));
  assert.equal(violationCount, 0);
  guard.stop();
});

test("a sustained loss of visibility is reported once after the grace period", () => {
  const documentRef: any = new FocusDocument();
  const windowRef: any = new EventTarget();
  let pendingCallback: any = null;
  let violationCount: any = 0;
  const guard: any = createTransientFocusGuard({
    documentRef,
    windowRef,
    shouldMonitor: () => true,
    onConfirmedLoss: () => { violationCount += 1; },
    scheduleTimer: (callback: any) => {
      pendingCallback = callback;
      return 1;
    },
    cancelTimer: () => { pendingCallback = null; },
  });

  documentRef.visibilityState = "hidden";
  documentRef.focused = false;
  windowRef.dispatchEvent(new Event("blur"));
  pendingCallback();
  assert.equal(violationCount, 1);
  guard.stop();
});

test("a throttled background timer still reports a long absence when visibility returns", () => {
  const documentRef: any = new FocusDocument();
  const windowRef: any = new EventTarget();
  let pendingCallback: any = null;
  let currentTime: any = 0;
  let violationCount: any = 0;
  const guard: any = createTransientFocusGuard({
    documentRef,
    windowRef,
    shouldMonitor: () => true,
    onConfirmedLoss: () => { violationCount += 1; },
    scheduleTimer: (callback: any) => {
      pendingCallback = callback;
      return 1;
    },
    cancelTimer: () => { pendingCallback = null; },
    now: () => currentTime,
  });

  documentRef.visibilityState = "hidden";
  documentRef.focused = false;
  documentRef.dispatchEvent(new Event("visibilitychange"));
  assert.equal(typeof pendingCallback, "function");

  currentTime = TRANSIENT_FOCUS_LOSS_MS + 2_000;
  documentRef.visibilityState = "visible";
  documentRef.focused = true;
  documentRef.dispatchEvent(new Event("visibilitychange"));
  assert.equal(violationCount, 1);
  assert.equal(pendingCallback, null);
  guard.stop();
});

test("Chromium, Firefox and Safari focus event ordering use the same grace policy", () => {
  const scenarios: any = [
    {
      name: "Chromium",
      lose(documentRef: any, windowRef: any) {
        windowRef.dispatchEvent(new Event("blur"));
        documentRef.visibilityState = "hidden";
        documentRef.dispatchEvent(new Event("visibilitychange"));
      },
      restore(documentRef: any, windowRef: any) {
        documentRef.visibilityState = "visible";
        documentRef.dispatchEvent(new Event("visibilitychange"));
        windowRef.dispatchEvent(new Event("focus"));
      },
    },
    {
      name: "Firefox",
      lose(documentRef: any, windowRef: any) {
        documentRef.visibilityState = "hidden";
        documentRef.dispatchEvent(new Event("visibilitychange"));
        windowRef.dispatchEvent(new Event("blur"));
      },
      restore(documentRef: any, windowRef: any) {
        windowRef.dispatchEvent(new Event("focus"));
        documentRef.visibilityState = "visible";
        documentRef.dispatchEvent(new Event("visibilitychange"));
      },
    },
    {
      name: "Safari",
      lose(_documentRef: any, windowRef: any) {
        windowRef.dispatchEvent(new Event("blur"));
      },
      restore(_documentRef: any, windowRef: any) {
        windowRef.dispatchEvent(new Event("focus"));
      },
    },
  ];

  for (const scenario of scenarios) {
    const documentRef: any = new FocusDocument();
    const windowRef: any = new EventTarget();
    let currentTime: any = 0;
    let violationCount: any = 0;
    const guard: any = createTransientFocusGuard({
      documentRef,
      windowRef,
      shouldMonitor: () => true,
      onConfirmedLoss: () => { violationCount += 1; },
      scheduleTimer: () => 1,
      cancelTimer: () => {},
      now: () => currentTime,
    });

    documentRef.focused = false;
    scenario.lose(documentRef, windowRef);
    currentTime = 250;
    documentRef.focused = true;
    scenario.restore(documentRef, windowRef);
    assert.equal(violationCount, 0, `${scenario.name} short focus loss`);

    currentTime = 5_000;
    documentRef.focused = false;
    scenario.lose(documentRef, windowRef);
    currentTime += TRANSIENT_FOCUS_LOSS_MS + 1;
    documentRef.focused = true;
    scenario.restore(documentRef, windowRef);
    assert.equal(violationCount, 1, `${scenario.name} long focus loss`);
    guard.stop();
  }
});

test("horizontal navigation gestures are blocked without disabling sheet scrolling or pinch zoom", () => {
  const pageTarget: any = { closest: () => null };
  assert.equal(shouldBlockHorizontalNavigation({
    cancelable: true,
    ctrlKey: false,
    deltaX: -80,
    deltaY: 4,
    target: pageTarget,
  }), true);
  assert.equal(shouldBlockHorizontalNavigation({
    cancelable: true,
    ctrlKey: true,
    deltaX: -80,
    deltaY: 4,
    target: pageTarget,
  }), false);

  const scroller: any = { scrollLeft: 100, scrollWidth: 1_000, clientWidth: 400 };
  const sheetTarget: any = { closest: () => scroller };
  assert.equal(shouldBlockHorizontalNavigation({
    cancelable: true,
    ctrlKey: false,
    deltaX: 80,
    deltaY: 4,
    target: sheetTarget,
  }), false);
  scroller.scrollLeft = 600;
  assert.equal(shouldBlockHorizontalNavigation({
    cancelable: true,
    ctrlKey: false,
    deltaX: 80,
    deltaY: 4,
    target: sheetTarget,
  }), true);
});

test("browser back keeps an active answer sheet open without reporting a violation", () => {
  const documentRef: any = new EventTarget();
  const windowRef: any = new EventTarget();
  const pushedStates: any = [];
  windowRef.location = { href: "https://example.test/exam/" };
  windowRef.history = {
    state: null,
    pushState: (state: any, _unused: any, url: any) => {
      pushedStates.push({ state, url });
      windowRef.history.state = state;
    },
  };
  let protectedAttempt: any = true;
  let blockedCount: any = 0;
  const guard: any = createExamNavigationGuard({
    documentRef,
    windowRef,
    shouldProtect: () => protectedAttempt,
    onNavigationBlocked: () => { blockedCount += 1; },
  });

  guard.arm();
  windowRef.dispatchEvent(new Event("popstate"));
  assert.equal(pushedStates.length, 2);
  assert.equal(blockedCount, 1);

  protectedAttempt = false;
  windowRef.dispatchEvent(new Event("popstate"));
  assert.equal(pushedStates.length, 2);
  guard.stop();
});

test("history throttling falls back to moving forward instead of breaking the exam page", () => {
  const documentRef: any = new EventTarget();
  const windowRef: any = new EventTarget();
  let pushCount: any = 0;
  let forwardCount: any = 0;
  windowRef.location = { href: "https://example.test/exam/" };
  windowRef.history = {
    state: null,
    pushState() {
      pushCount += 1;
      if (pushCount > 1) throw new DOMException("Too frequent", "SecurityError");
    },
    forward() {
      forwardCount += 1;
    },
  };
  const guard: any = createExamNavigationGuard({
    documentRef,
    windowRef,
    shouldProtect: () => true,
  });

  guard.arm();
  assert.doesNotThrow(() => windowRef.dispatchEvent(new Event("popstate")));
  assert.equal(forwardCount, 1);
  guard.stop();
});
