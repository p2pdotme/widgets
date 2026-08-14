import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { resolveLocale } from "../src/i18n/resolveLocale";
import { t, interpolate } from "../src/i18n/t";
import { translateError } from "../src/i18n/errors";
import { createTranslator } from "../src/i18n/t";
import { P2PError } from "../src/core/errors";
import { Checkout } from "../src/widgets/Checkout";

describe("resolveLocale", () => {
  const original = {
    language: navigator.language,
    languages: navigator.languages,
  };

  afterEach(() => {
    Object.defineProperty(navigator, "language", {
      value: original.language,
      configurable: true,
    });
    Object.defineProperty(navigator, "languages", {
      value: original.languages,
      configurable: true,
    });
  });

  it("returns en when nothing matches", () => {
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    Object.defineProperty(navigator, "languages", { value: ["de-DE"], configurable: true });
    expect(resolveLocale()).toBe("en");
  });

  it("honors an explicit preference over navigator", () => {
    Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("pt")).toBe("pt-BR");
  });

  it("maps navigator.language tags", () => {
    Object.defineProperty(navigator, "language", { value: "es-AR", configurable: true });
    Object.defineProperty(navigator, "languages", { value: ["es-AR"], configurable: true });
    expect(resolveLocale()).toBe("es");

    Object.defineProperty(navigator, "language", { value: "pt-PT", configurable: true });
    Object.defineProperty(navigator, "languages", { value: ["pt-PT"], configurable: true });
    expect(resolveLocale()).toBe("pt-BR");
  });
});

describe("t / interpolate", () => {
  it("interpolates params", () => {
    expect(interpolate("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
  });

  it("falls back to English for missing keys in other locales", () => {
    // Known key present in all catalogs
    expect(t("pt-BR", "checkout.payNow")).toBe("Pagar agora");
    expect(t("es", "checkout.payNow")).toBe("Pagar ahora");
    expect(t("en", "checkout.payNow")).toBe("Pay now");
  });

  it("returns the path when the key is unknown", () => {
    expect(t("en", "does.not.exist")).toBe("does.not.exist");
  });
});

describe("translateError", () => {
  const tr = createTranslator("pt-BR");

  it("localizes known codes", () => {
    const err = new P2PError({
      code: "WALLET_USER_REJECTED",
      category: "wallet",
      userMessage: "Transaction was rejected in your wallet. Approve it to continue.",
    });
    expect(translateError(err, tr)).toMatch(/rejeitada/i);
  });

  it("localizes known revert names", () => {
    const err = new P2PError({
      code: "REVERT_KNOWN",
      category: "revert",
      userMessage: "This order has expired. Please start a new one.",
      revertName: "OrderExpired",
    });
    expect(translateError(err, tr)).toMatch(/expirou/i);
  });

  it("localizes via i18nKey when set", () => {
    const err = new P2PError({
      code: "INPUT_INVALID",
      category: "validation",
      userMessage: "english fallback",
      i18nKey: "checkout.rateStillLoading",
    });
    expect(translateError(err, tr)).toMatch(/cotação|carregando/i);
  });
});

describe("Checkout locale prop", () => {
  const USER = "0xe35DccC12404638B4e733881Df6D57D07B5d70E2" as `0x${string}`;
  const stubSigner = {
    address: USER,
    sendTransaction: async () => ({ hash: "0xtx" as `0x${string}` }),
  };

  it("renders pt-BR copy when locale is set", () => {
    render(
      <Checkout
        demo
        mode="inline"
        open
        locale="pt-BR"
        currency="INR"
        productName="Pedido teste"
        usdcAmount={10n * 1_000_000n}
        signer={stubSigner as never}
        placeOrder={async () => ({ orderId: "demo1", txHash: "0xdemo" })}
      />,
    );
    expect(screen.getByRole("button", { name: /Pagar agora|Pagar /i })).toBeTruthy();
  });
});
