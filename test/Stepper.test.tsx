import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Stepper } from "../src/ui/components";
import { NO_ACTIVE_STEP } from "../src/core/stepper";

// The stepper marks the current step by making its circle solid (the accent
// background) and its label semibold. Asserting on the rendered circles is the
// only way to catch the reported bug: `stepIndex = 0` on a cancelled order
// rendered "Matching" exactly as if the order were still being matched.
const circles = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>(".p2p-stepper-cell > div")];
const filled = (c: HTMLElement) =>
  circles(c).filter(d => d.style.background && d.style.background !== "none" &&
    !d.style.border.includes("1px solid"));

describe("Stepper", () => {
  it("marks exactly one step current while the order is live", () => {
    const { container } = render(<Stepper stepIndex={0} />);
    expect(filled(container)).toHaveLength(1);
    expect(circles(container)[0].textContent).toBe("1");
  });

  it("ticks off everything behind the current step", () => {
    const { container } = render(<Stepper stepIndex={2} />);
    expect(circles(container).map(d => d.textContent)).toEqual(["✓", "✓", "3"]);
  });

  // THE BUG: an "Order cancelled" body under a lit "1 Matching" step.
  it("marks NO step current once the order has stopped", () => {
    const { container } = render(<Stepper stepIndex={NO_ACTIVE_STEP} />);
    expect(filled(container)).toHaveLength(0);
    expect(circles(container).map(d => d.textContent)).toEqual(["1", "2", "3"]);
  });
});
