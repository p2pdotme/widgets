import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { buildUpiQuery, UPI_APPS } from "../core/upi";
import { isIOS, isAndroid } from "../core/platform";
import { color, radius, S } from "./theme";

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
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {UPI_APPS.map((a) => (
          <a key={a.id} href={a.href(q)} onClick={onAppLaunch} style={linkStyle}>
            Pay with {a.label}
          </a>
        ))}
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
