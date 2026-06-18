import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { UpiPay } from "../src/ui/UpiPay";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

function setUA(value: string) {
  Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
}

const baseProps = { vpa: "merchant@okhdfc", amount: "125.00", orderId: "169", payeeName: "Acme" };

afterEach(() => vi.restoreAllMocks());

describe("UpiPay", () => {
  it("renders four per-app deep links on iOS, each with the app's official logo", async () => {
    setUA(IPHONE);
    const { container } = render(<UpiPay {...baseProps} />);
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors).toHaveLength(4);
    const hrefs = anchors.map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.startsWith("phonepe://pay?"))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("gpay://upi/pay?"))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("paytmmp://pay?"))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("bhim://upi/pay?"))).toBe(true);
    // before the lazy logo chunk loads, tiles fall back to the text label and
    // taps already work (the <a href> never depends on the logo)
    expect(container.textContent).toContain("PhonePe");
    // logos load lazily (dynamic import) -> each tile then shows its official <img>
    await waitFor(() => expect(container.querySelectorAll("a img")).toHaveLength(4));
    const imgs = Array.from(container.querySelectorAll("a img"));
    expect(imgs.every((i) => (i.getAttribute("src") ?? "").startsWith("data:image/svg+xml"))).toBe(true);
    expect(container.querySelectorAll(".p2p-upi-tile")).toHaveLength(4);
    expect(container.textContent).toContain("Didn't open?");
  });

  it("renders a single generic UPI intent link on Android", () => {
    setUA(ANDROID);
    const { container } = render(<UpiPay {...baseProps} />);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toMatch(/^upi:\/\/pay\?/);
  });

  it("renders a client-side QR (no upi:// anchor) on desktop", async () => {
    setUA(DESKTOP);
    const { container } = render(<UpiPay {...baseProps} />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());
    expect(container.querySelector('a[href^="upi://"]')).toBeNull();
  });

  it("fires onAppLaunch when an app link is tapped", () => {
    setUA(ANDROID);
    const onAppLaunch = vi.fn();
    const { container } = render(<UpiPay {...baseProps} onAppLaunch={onAppLaunch} />);
    container.querySelector("a")!.click();
    expect(onAppLaunch).toHaveBeenCalledOnce();
  });
});
