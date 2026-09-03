import assert from "node:assert/strict";
import test from "node:test";

import {
  getFullscreenElement,
  isFullscreenAvailable,
  observeFullscreenChanges,
  requestFullscreen,
} from "../src/client/exam/fullscreen-compatibility.ts";

test("the exam can enter and observe fullscreen through Safari's WebKit-prefixed API", async () => {
  const events: any = [];
  const documentRef: any = {
    webkitFullscreenEnabled: true,
    webkitFullscreenElement: null,
    addEventListener(name: any, listener: any) { events.push(["add", name, listener]); },
    removeEventListener(name: any, listener: any) { events.push(["remove", name, listener]); },
  };
  const element: any = {
    async webkitRequestFullscreen() { documentRef.webkitFullscreenElement = element; },
  };

  assert.equal(isFullscreenAvailable(documentRef, element), true);
  assert.equal(await requestFullscreen(element), true);
  assert.equal(getFullscreenElement(documentRef), element);

  const listener: any = () => {};
  const stopObserving: any = observeFullscreenChanges(documentRef, listener);
  assert.deepEqual(events[0], ["add", "webkitfullscreenchange", listener]);
  stopObserving();
  assert.deepEqual(events[1], ["remove", "webkitfullscreenchange", listener]);
});

test("the standard fullscreen API remains preferred when both forms exist", async () => {
  const calls: any = [];
  const element: any = {
    async requestFullscreen() { calls.push("standard"); },
    async webkitRequestFullscreen() { calls.push("webkit"); },
  };
  const documentRef: any = {
    fullscreenEnabled: true,
    fullscreenElement: element,
    webkitFullscreenEnabled: true,
    webkitFullscreenElement: null,
    addEventListener(name: any) { calls.push(name); },
    removeEventListener() {},
  };

  assert.equal(isFullscreenAvailable(documentRef, element), true);
  assert.equal(await requestFullscreen(element), true);
  assert.equal(getFullscreenElement(documentRef), element);
  observeFullscreenChanges(documentRef, () => {});
  assert.deepEqual(calls, ["standard", "fullscreenchange"]);
});
