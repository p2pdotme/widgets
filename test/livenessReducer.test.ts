import { describe, it, expect } from "vitest";
import { reducer, INITIAL } from "../src/core/order-machine";
import { P2PError } from "../src/core/errors";

// Focused coverage of the anti-sybil liveness state machine (verify-once +
// screening-flag trigger). The pure gate math lives in liveness.test.ts; this
// locks in the reducer transitions the rework depends on.
describe("liveness reducer transitions", () => {
  it("starts loading + not-cleared (button holds until the verify-once read lands)", () => {
    expect(INITIAL.livenessGate).toBe("loading");
    expect(INITIAL.livenessCleared).toBe(false);
  });

  it("LIVENESS_OFF → cleared, ungated (no config)", () => {
    const s = reducer(INITIAL, { type: "LIVENESS_OFF" });
    expect(s.livenessGate).toBe("ok");
    expect(s.livenessCleared).toBe(true);
  });

  it("LIVENESS_STATUS records cleared and releases the button (loading → ok), never gates", () => {
    const cleared = reducer(INITIAL, { type: "LIVENESS_STATUS", cleared: true });
    expect(cleared.livenessGate).toBe("ok");
    expect(cleared.livenessCleared).toBe(true);

    const notCleared = reducer(INITIAL, { type: "LIVENESS_STATUS", cleared: false });
    // Not-cleared must NOT blanket-gate — the screening flag is the trigger.
    expect(notCleared.livenessGate).toBe("ok");
    expect(notCleared.livenessCleared).toBe(false);
  });

  it("LIVENESS_REQUIRED resets phase 'placing' → 'checkout' so the block can render", () => {
    // Reproduces the latent bug: the screening flag fires after PLACING, and
    // the block only renders on phase === 'checkout'.
    const placing = reducer(INITIAL, { type: "PLACING" });
    expect(placing.phase).toBe("placing");
    const gated = reducer(placing, { type: "LIVENESS_REQUIRED" });
    expect(gated.phase).toBe("checkout");
    expect(gated.livenessGate).toBe("required");
    expect(gated.error).toBeNull();
  });

  it("verify flow: VERIFYING → VERIFIED clears the user and reopens the form", () => {
    const gated = reducer(reducer(INITIAL, { type: "PLACING" }), { type: "LIVENESS_REQUIRED" });
    const verifying = reducer(gated, { type: "LIVENESS_VERIFYING" });
    expect(verifying.livenessGate).toBe("verifying");
    const verified = reducer(verifying, { type: "LIVENESS_VERIFIED" });
    expect(verified.livenessGate).toBe("ok");
    expect(verified.livenessCleared).toBe(true); // retry now bypasses the screening flag
  });

  it("verify failure returns to the block with an error, staying on the form", () => {
    const gated = reducer(reducer(INITIAL, { type: "PLACING" }), { type: "LIVENESS_REQUIRED" });
    const err = new P2PError({
      code: "UNKNOWN",
      category: "unknown",
      userMessage: "nope",
    });
    const failed = reducer(gated, { type: "LIVENESS_VERIFY_FAILED", error: err });
    expect(failed.phase).toBe("checkout");
    expect(failed.livenessGate).toBe("required");
    expect(failed.livenessError).toBe(err);
    expect(failed.livenessCleared).toBe(false); // still not cleared
  });
});
