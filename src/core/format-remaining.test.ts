import { test } from "node:test";
import assert from "node:assert";
import { formatRemaining } from "./format-remaining.ts";

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

test("formatRemaining: 0s for non-positive input (clamp, never empty)", () => {
  assert.strictEqual(formatRemaining(0), "0s");
  assert.strictEqual(formatRemaining(-1), "0s");
  assert.strictEqual(formatRemaining(-9999), "0s");
});

test("formatRemaining: 0s for non-finite input", () => {
  assert.strictEqual(formatRemaining(Number.NaN), "0s");
  assert.strictEqual(formatRemaining(Number.POSITIVE_INFINITY), "0s");
});

test("formatRemaining: sub-minute durations render in seconds", () => {
  assert.strictEqual(formatRemaining(1 * S), "1s");
  assert.strictEqual(formatRemaining(42 * S), "42s");
  assert.strictEqual(formatRemaining(59 * S + 999), "59s");
});

test("formatRemaining: seconds → minutes boundary renders as 1m", () => {
  assert.strictEqual(formatRemaining(60 * S), "1m");
});

test("formatRemaining: sub-hour durations render in minutes (no seconds)", () => {
  assert.strictEqual(formatRemaining(1 * M), "1m");
  assert.strictEqual(formatRemaining(12 * M), "12m");
  assert.strictEqual(formatRemaining(59 * M + 59 * S), "59m");
});

test("formatRemaining: minutes → hours boundary renders as 1h 0m", () => {
  assert.strictEqual(formatRemaining(60 * M), "1h 0m");
});

test("formatRemaining: sub-day durations render as <h>h <m>m", () => {
  assert.strictEqual(formatRemaining(1 * H + 0 * M), "1h 0m");
  assert.strictEqual(formatRemaining(4 * H + 23 * M), "4h 23m");
  assert.strictEqual(formatRemaining(23 * H + 59 * M), "23h 59m");
});

test("formatRemaining: hours → days boundary renders as 1d 0h", () => {
  assert.strictEqual(formatRemaining(24 * H), "1d 0h");
});

test("formatRemaining: multi-day durations render as <d>d <h>h", () => {
  assert.strictEqual(formatRemaining(1 * D + 0 * H), "1d 0h");
  assert.strictEqual(formatRemaining(2 * D + 4 * H), "2d 4h");
  assert.strictEqual(formatRemaining(7 * D), "7d 0h");
});

test("formatRemaining: truncates partial seconds — 1.999s shows 1s", () => {
  assert.strictEqual(formatRemaining(1001), "1s");
  assert.strictEqual(formatRemaining(1999), "1s");
});
