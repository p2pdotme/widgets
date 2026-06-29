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

test("gate on + not verified → required", () => {
  assert.equal(computeLivenessGate({ required: true, verified: false }, true), "required");
});
