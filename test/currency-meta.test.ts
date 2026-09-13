import { describe, it, expect } from "vitest";
import {
  resolveCurrencyMeta,
  paymentMethodDisplayFor,
} from "../src/core/currency-meta";

describe("currency-meta labels", () => {
  it("NGN compound labels match user-app's English strings", () => {
    const meta = resolveCurrencyMeta({ symbol: "NGN" });
    expect(meta.compoundFields?.map((f) => f.label)).toEqual([
      "Account Number",
      "Bank Name",
      "Account Name",
    ]);
  });

  it("VEN compound labels match user-app's English strings", () => {
    const meta = resolveCurrencyMeta({ symbol: "VEN" });
    expect(meta.compoundFields?.map((f) => f.label)).toEqual([
      "Phone Number",
      "Cédula/RIF",
      "Bank",
    ]);
  });

  it("every catalog compound field resolves to a label with no raw i18n token", () => {
    for (const symbol of ["VEN", "NGN", "CUP", "ECU", "PHP", "PEN"]) {
      const meta = resolveCurrencyMeta({ symbol });
      expect(meta.compoundFields && meta.compoundFields.length > 1).toBe(true);
      for (const f of meta.compoundFields!) {
        expect(f.label.includes("_"), `${symbol}.${f.key} label "${f.label}" looks like a raw token`).toBe(false);
        expect(f.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("payment methods render display names, not protocol tokens", () => {
    expect(resolveCurrencyMeta({ symbol: "VEN" }).paymentMethodDisplay).toBe("Pago Móvil");
    expect(resolveCurrencyMeta({ symbol: "NGN" }).paymentMethodDisplay).toBe("NIP");
    expect(resolveCurrencyMeta({ symbol: "CUP" }).paymentMethodDisplay).toBe("Transfermóvil");
    expect(resolveCurrencyMeta({ symbol: "PEN" }).paymentMethodDisplay).toBe("Yape / Plin / CCI");
    expect(resolveCurrencyMeta({ symbol: "BOB" }).paymentMethodDisplay).toBe("QR Simple");
    expect(paymentMethodDisplayFor("BANK_TRANSFER")).toBe("Bank Transfer");
    expect(paymentMethodDisplayFor("SOME_NEW_RAIL")).toBe("Some New Rail");
    expect(paymentMethodDisplayFor("PIX")).toBe("PIX");
  });

  it("VEN is no longer tagged alpha by the catalog", () => {
    expect(resolveCurrencyMeta({ symbol: "VEN" }).isAlpha).toBe(false);
  });
});
