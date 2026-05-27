import { test } from "node:test";
import assert from "node:assert";
import { filterPendingToB2B, keepOnlyB2BPending } from "./b2b-orders.ts";

type Pending = { orderId: string; usdcAmount: bigint };

const retail: Pending = { orderId: "1", usdcAmount: 5_000_000n };
const b2bA: Pending = { orderId: "100", usdcAmount: 7_000_000n };
const b2bB: Pending = { orderId: "101", usdcAmount: 9_000_000n };

// ─── filterPendingToB2B ─────────────────────────────────────────────

test("filterPendingToB2B keeps only orders whose id is in the B2B set", () => {
  const out = filterPendingToB2B([retail, b2bA, b2bB], new Set(["100", "101"]));
  assert.deepStrictEqual(out, [b2bA, b2bB]);
});

test("filterPendingToB2B drops a legacy non-B2B pending order (the stuck-order bug)", () => {
  // A pre-auto-cancellation retail order stuck "pending" forever must not
  // gate a new B2B placement.
  const out = filterPendingToB2B([retail], new Set(["100"]));
  assert.deepStrictEqual(out, []);
});

test("filterPendingToB2B with an empty B2B set drops everything", () => {
  const out = filterPendingToB2B([retail, b2bA], new Set());
  assert.deepStrictEqual(out, []);
});

test("filterPendingToB2B passes through unchanged when B2B-ness is unknown (null)", () => {
  const out = filterPendingToB2B([retail, b2bA], null);
  assert.deepStrictEqual(out, [retail, b2bA]);
});

test("filterPendingToB2B returns a fresh array (no aliasing of the input)", () => {
  const input = [retail, b2bA];
  assert.notStrictEqual(filterPendingToB2B(input, null), input);
});

test("filterPendingToB2B on empty pending is empty", () => {
  assert.deepStrictEqual(filterPendingToB2B([], new Set(["100"])), []);
});

// ─── keepOnlyB2BPending (no-network branches) ───────────────────────

test("keepOnlyB2BPending passes through when no subgraphUrl is configured", async () => {
  const out = await keepOnlyB2BPending([retail, b2bA], undefined, "0xuser");
  assert.deepStrictEqual(out, [retail, b2bA]);
});

test("keepOnlyB2BPending short-circuits empty pending without a network call", async () => {
  const out = await keepOnlyB2BPending([], "https://subgraph.example", "0xuser");
  assert.deepStrictEqual(out, []);
});
