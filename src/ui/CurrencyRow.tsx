import React from "react";
import type { CurrencyMeta } from "../core/currency-meta";
import { color, radius, font, weight } from "./theme";
import { useT } from "../i18n";

/**
 * Currency row used inside the selector dropdown — both the trigger
 * (currently-selected) and each option. Matches the p2p.me user-app layout:
 * a 40px circular badge with the native symbol, the currency code as
 * primary text (with an optional "Alpha" pill), and "{flag} · {country}"
 * as secondary text underneath.
 */
export function CurrencyRow({ meta }: { meta: CurrencyMeta }) {
  const t = useT();
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: color.accentSoft,
          color: color.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: weight.semibold,
          fontSize: font.lg,
          flexShrink: 0,
        }}
      >
        {meta.symbolNative}
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: font.base, fontWeight: weight.semibold, color: color.text }}>
            {meta.symbol}
          </span>
          {meta.isAlpha && (
            <span
              style={{
                background: color.accentSoft,
                color: color.accent,
                padding: "2px 8px",
                borderRadius: radius.pill,
                fontSize: font.xs,
                fontWeight: weight.semibold,
              }}
            >
              {t("common.alpha")}
            </span>
          )}
        </span>
        {meta.country && (
          <span style={{ fontSize: font.sm, color: color.textMuted, fontWeight: weight.medium }}>
            {meta.flag ? `${meta.flag} · ` : ""}{meta.country}
          </span>
        )}
      </span>
    </span>
  );
}
