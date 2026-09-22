// Where the stepper's "you are here" marker goes.
//
// The rule that was missing: an order that has STOPPED is not in a step. Both
// widgets computed the index with a ternary chain ending in `: 0`, so every
// phase they did not name fell through to 0 — and 0 is "Matching", the first
// step. A cancelled order therefore rendered "1 Matching" as the current step
// directly above a body that said "Order cancelled. You were not charged."
// (reported on hype.house, 2026-09-22). `error` with a known order id shows the
// same tracker and had the same fall-through.
//
// `NO_ACTIVE_STEP` is below every index, so `Stepper`'s own `done`/`active`
// comparisons leave all three steps unmarked without needing a new prop: the
// row reads as "none of this is in progress", which is what has happened.

/** Sentinel index: no step is done and none is current. */
export const NO_ACTIVE_STEP = -1;

/**
 * Has the order stopped somewhere that is not success?
 *
 * `completed` is deliberately absent — that is a terminal phase too, but it is
 * the one that legitimately marks a step.
 */
export function isTerminalFailure(phase: string): boolean {
  return phase === "cancelled" || phase === "error";
}

/**
 * Where the CHECKOUT tracker's marker goes for a phase.
 *
 * Lived inline in `Checkout.tsx` as a ternary chain ending in `: 0`, which is
 * why an unnamed phase silently became step 1.
 */
export function checkoutStepIndex(phase: string): number {
  if (isTerminalFailure(phase)) return NO_ACTIVE_STEP;
  if (phase === "completed") return 3;
  if (phase === "paid") return 2;
  if (phase === "accepted") return 1;
  return 0;
}

/** The same for CASHOUT, which has one extra pre-payment phase. */
export function cashoutStepIndex(phase: string): number {
  if (isTerminalFailure(phase)) return NO_ACTIVE_STEP;
  if (phase === "completed") return 3;
  if (phase === "paid") return 2;
  if (phase === "accepted" || phase === "encrypting") return 1;
  return 0;
}
