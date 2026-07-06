import { test } from "node:test";
import assert from "node:assert";
import { computeLivenessGate, livenessCreditExemption } from "./liveness.ts";

test("no liveness config → never gates (other integrations unaffected)", () => {
  assert.equal(computeLivenessGate(null, false), "ok");
  assert.equal(computeLivenessGate({ required: true, verified: false }, false), "ok");
});

test("config set but status not yet read → loading", () => {
  assert.equal(computeLivenessGate(null, true), "loading");
});

test("gate off on-chain → ok regardless of verification", () => {
  assert.equal(computeLivenessGate({ required: false, verified: false }, true), "ok");
  assert.equal(computeLivenessGate({ required: false, verified: true }, true), "ok");
});

test("gate on + already verified → ok (verify once)", () => {
  assert.equal(computeLivenessGate({ required: true, verified: true }, true), "ok");
});

test("gate on + not verified → required", () => {
  assert.equal(computeLivenessGate({ required: true, verified: false }, true), "required");
});

// ─── livenessCreditExemption (two-integrator migration) ─────────────

test("exemption off → always enforce, ignoring credit", () => {
  assert.equal(livenessCreditExemption(false, null), "enforce");
  assert.equal(livenessCreditExemption(false, 0n), "enforce");
  assert.equal(livenessCreditExemption(false, 5_000_000n), "enforce");
});

test("exemption on + credit still loading → wait (never decide on stale zero)", () => {
  assert.equal(livenessCreditExemption(true, null), "wait");
});

test("exemption on + credit > 0 → exempt (old integrator, no liveness)", () => {
  assert.equal(livenessCreditExemption(true, 1n), "exempt");
  assert.equal(livenessCreditExemption(true, 5_000_000n), "exempt");
});

test("exemption on + zero credit → enforce (new integrator gate applies)", () => {
  assert.equal(livenessCreditExemption(true, 0n), "enforce");
});
