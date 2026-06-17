import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { buildUpiQuery, UPI_APPS } from "../core/upi";
import { isIOS, isAndroid } from "../core/platform";
import { color, radius, S } from "./theme";
import { UPI_APP_LOGOS } from "./upi-app-icons";

export interface UpiPayProps {
  /** Decrypted counterparty VPA. */
  vpa: string;
  /** 2-decimal amount string, e.g. "125.00". */
  amount: string;
  /** Order id, used as the note + reference. */
  orderId: string;
  /** Payee name shown in the UPI app; from the host productName. */
  payeeName?: string;
  /** Fired when a UPI app link is tapped (mobile), so the host can nudge "I've paid". */
  onAppLaunch?: () => void;
}

const linkStyle: React.CSSProperties = {
  ...S.primaryBtn,
  display: "block",
  textAlign: "center",
  textDecoration: "none",
};

// A logo "tile" for the per-app grid. The official brand logos are designed for
// a light background, so the tile stays white on every integrator theme to keep
// them legible; only the border + radius follow the theme. The logo scales to
// fit (object-contain), so nothing can overflow regardless of logo width.
const logoTileStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: 46,
  padding: "0 14px",
  boxSizing: "border-box",
  background: "#ffffff",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  cursor: "pointer",
};

const logoImgStyle: React.CSSProperties = {
  maxHeight: 18,
  maxWidth: "100%",
  objectFit: "contain",
  display: "block",
};

/**
 * The INR payment surface on the accepted screen. iOS gets explicit per-app
 * buttons (no scheme chooser on iOS); Android gets the generic intent link
 * (system chooser); desktop gets a client-side QR. The copy-VPA row above this
 * component is the universal fallback and is unaffected.
 */
export function UpiPay({ vpa, amount, orderId, payeeName, onAppLaunch }: UpiPayProps) {
  const q = buildUpiQuery({
    pa: vpa,
    pn: payeeName ?? "P2P Payment",
    am: amount,
    tn: `Order ${orderId}`,
    tr: orderId,
  });

  if (isIOS()) {
    // No scheme chooser on iOS -> explicit per-app buttons, laid out 2x2 so
    // four apps stay within a short iPhone / Android viewport. Each tile shows
    // the app's official logo; the copy-VPA row above is the universal fallback.
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
        {UPI_APPS.map((a) => {
          const logo = UPI_APP_LOGOS[a.id];
          return (
            <a
              key={a.id}
              href={a.href(q)}
              onClick={onAppLaunch}
              style={logoTileStyle}
              aria-label={`Pay with ${a.label}`}
            >
              {logo ? (
                <img src={logo.src} alt={logo.alt} style={logoImgStyle} />
              ) : (
                <span>{a.label}</span>
              )}
            </a>
          );
        })}
      </div>
    );
  }

  if (isAndroid()) {
    return (
      <a href={`upi://pay?${q}`} onClick={onAppLaunch} style={{ ...linkStyle, marginTop: 16 }}>
        Pay with UPI app
      </a>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
      <div style={{ padding: 12, background: "#fff", borderRadius: radius.md, border: `1px solid ${color.border}` }}>
        <QRCodeSVG value={`upi://pay?${q}`} size={180} level="L" />
      </div>
    </div>
  );
}
