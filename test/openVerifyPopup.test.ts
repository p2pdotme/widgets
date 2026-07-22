import { afterEach, describe, expect, it, vi } from "vitest";
import { openVerifyPopup } from "../src/core/liveness";

// The deployed liveness wizard, when opened in a popup, hands the result back by
// postMessaging { type, code, state } to its opener (see liveness-web
// `handback.ts`) — it does NOT navigate the popup to `redirect_uri?code`. These
// tests lock in that the SDK receives that message (origin + state checked), so
// the popup flow actually returns instead of hanging until timeout.

const WIDGET = "https://liveness-web.example/embed?handoff=abc";
const WIDGET_ORIGIN = "https://liveness-web.example";
const RETURN = "https://app.example";

function stubPopup() {
  const popup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    location: { href: WIDGET }, // stays on the wizard origin (never redirects)
  };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  return popup;
}

function post(data: unknown, origin = WIDGET_ORIGIN) {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

describe("openVerifyPopup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves the code from a verify:complete postMessage (origin + state match) and closes the popup", async () => {
    const popup = stubPopup();
    const p = openVerifyPopup(WIDGET, RETURN, "st-1");
    post({ type: "verify:complete", code: "CODE123", state: "st-1" });
    await expect(p).resolves.toBe("CODE123");
    expect(popup.close).toHaveBeenCalled();
  });

  it("ignores a verify:complete from a foreign origin", async () => {
    stubPopup();
    const p = openVerifyPopup(WIDGET, RETURN, "st-1");
    post({ type: "verify:complete", code: "EVIL", state: "st-1" }, "https://evil.example");
    post({ type: "verify:complete", code: "GOOD", state: "st-1" });
    await expect(p).resolves.toBe("GOOD");
  });

  it("ignores a verify:complete with a mismatched state (CSRF guard)", async () => {
    stubPopup();
    const p = openVerifyPopup(WIDGET, RETURN, "st-1");
    post({ type: "verify:complete", code: "WRONG", state: "other-state" });
    post({ type: "verify:complete", code: "RIGHT", state: "st-1" });
    await expect(p).resolves.toBe("RIGHT");
  });

  it("resolves null on a verify:error", async () => {
    stubPopup();
    const p = openVerifyPopup(WIDGET, RETURN, "st-1");
    post({ type: "verify:error", error: "liveness_failed", state: "st-1" });
    await expect(p).resolves.toBeNull();
  });

  it("resolves null when the popup is blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openVerifyPopup(WIDGET, RETURN, "st-1")).resolves.toBeNull();
  });
});
