import { test } from "node:test";
import assert from "node:assert";
import { computeLivenessGate } from "./liveness.ts";

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

test("gate on + not verified → not cleared (\"required\")", () => {
  assert.equal(computeLivenessGate({ required: true, verified: false }, true), "required");
});

// The order machine reads `=== "ok"` as "cleared" (verify-once): a cleared
// user bypasses a screening `liveliness_required` response; a non-cleared
// (not-yet-verified, gate-on) user does not. It never blanket-gates on
// "required" — the fraud engine's suspect-scoped flag is the prompt trigger.
test("cleared (=== \"ok\") ⟺ gate off OR already verified", () => {
  assert.equal(computeLivenessGate({ required: false, verified: false }, true) === "ok", true);
  assert.equal(computeLivenessGate({ required: true, verified: true }, true) === "ok", true);
  assert.equal(computeLivenessGate({ required: true, verified: false }, true) === "ok", false);
  assert.equal(computeLivenessGate(null, false) === "ok", true); // no config → cleared
});
