import { test } from "node:test";
import assert from "node:assert";
import { NO_ACTIVE_STEP, isTerminalFailure, checkoutStepIndex, cashoutStepIndex } from "./stepper.ts";

// The reported bug: "Order cancelled" with step 1 "Matching" still lit.
test("a cancelled order is not in a step", () => {
  assert.equal(isTerminalFailure("cancelled"), true);
});

// Same tracker renders for `error` once an order id is known, and it had the
// same fall-through to 0.
test("an errored order is not in a step", () => {
  assert.equal(isTerminalFailure("error"), true);
});

test("completed is terminal but does mark a step", () => {
  assert.equal(isTerminalFailure("completed"), false);
});

for (const phase of ["checkout", "form", "placing", "placed", "accepted", "encrypting", "paid"]) {
  test(`${phase} still resolves to a real step`, () => {
    assert.equal(isTerminalFailure(phase), false);
  });
}

// Stepper marks `done` with `stepIndex > i` and `active` with `stepIndex === i`.
// The sentinel has to lose both comparisons for every index, or a cancelled
// order would light a step again.
test("the sentinel marks no step done and none active", () => {
  for (const i of [0, 1, 2]) {
    assert.equal(NO_ACTIVE_STEP > i, false);
    assert.equal(NO_ACTIVE_STEP === i, false);
  }
});

// THE REPORTED BUG, as the exact value each widget hands the Stepper. Before the
// fix both chains ended in `: 0`, so these two returned 0 — step 1, "Matching" —
// on an order that had already been cancelled.
test("checkout: a cancelled order marks no step", () => {
  assert.equal(checkoutStepIndex("cancelled"), NO_ACTIVE_STEP);
});

test("cashout: a cancelled order marks no step", () => {
  assert.equal(cashoutStepIndex("cancelled"), NO_ACTIVE_STEP);
});

// The same tracker renders for `error` once an order id is known.
test("checkout: an errored order marks no step", () => {
  assert.equal(checkoutStepIndex("error"), NO_ACTIVE_STEP);
});

test("cashout: an errored order marks no step", () => {
  assert.equal(cashoutStepIndex("error"), NO_ACTIVE_STEP);
});

// Everything the fix must NOT have changed.
test("checkout: the live phases keep their steps", () => {
  assert.deepEqual(
    ["checkout", "placing", "placed", "accepted", "paid", "completed"].map(checkoutStepIndex),
    [0, 0, 0, 1, 2, 3],
  );
});

test("cashout: the live phases keep their steps, encrypting alongside accepted", () => {
  assert.deepEqual(
    ["form", "placing", "placed", "accepted", "encrypting", "paid", "completed"].map(cashoutStepIndex),
    [0, 0, 0, 1, 1, 2, 3],
  );
});
