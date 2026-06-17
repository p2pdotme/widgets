import { test } from "node:test";
import assert from "node:assert";
import { isIOS, isAndroid } from "./platform.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

test("isIOS detects iPhone, rejects Android and desktop", () => {
  assert.strictEqual(isIOS(IPHONE), true);
  assert.strictEqual(isIOS(ANDROID), false);
  assert.strictEqual(isIOS(DESKTOP), false);
});

test("isAndroid detects Android, rejects iPhone", () => {
  assert.strictEqual(isAndroid(ANDROID), true);
  assert.strictEqual(isAndroid(IPHONE), false);
});
