import React, { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { buildUpiQuery, buildUpiIntent, UPI_APPS } from "../core/upi";
import { isIOS, isAndroid } from "../core/platform";
import { color, radius, S } from "./theme";
import type { UpiAppLogo } from "./upi-app-icons";

export interface UpiPayProps {
  /** Decrypted counterparty VPA. */
  vpa: string;
  /** 2-decimal amount string, e.g. "125.00". */
  amount: string;
  /** Order id, used as the note + reference. */
  orderId: string;
  /** Payee name shown in the UPI app; from the host productName (required). */
  payeeName: string;
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
  height: 48,
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

// Shown in a tile until the lazy logo chunk resolves (and if it ever fails).
const logoFallbackStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#1a1a1a",
};

/**
 * The INR payment surface on the accepted screen. iOS gets explicit per-app
 * buttons (no scheme chooser on iOS); Android gets the generic intent link
 * (system chooser); desktop gets a client-side QR. The copy-VPA row above this
 * component is the universal fallback and is unaffected.
 */
export function UpiPay({ vpa, amount, orderId, payeeName, onAppLaunch }: UpiPayProps) {
  const ios = isIOS();
  // The official app logos (~25 KB of data-URI SVGs) are this component's only
  // heavy part and are needed solely on the iOS per-app grid, so load them
  // lazily: the dynamic import keeps them out of the main /checkout chunk for
  // Android, desktop, and non-INR consumers. Until they resolve each tile shows
  // its text label, and taps work throughout (the <a href> never needs the logo).
  const [logos, setLogos] = useState<Record<string, UpiAppLogo> | null>(null);
  useEffect(() => {
    if (!ios) return;
    let alive = true;
    import("./upi-app-icons")
      .then((m) => {
        if (alive) setLogos(m.UPI_APP_LOGOS);
      })
      .catch(() => {
        // Chunk fetch failed (offline / CDN purge after a redeploy): keep the
        // text-label fallback. Taps already work; the logo is decorative.
      });
    return () => {
      alive = false;
    };
  }, [ios]);

  const params = {
    pa: vpa,
    pn: payeeName,
    am: amount,
    tn: `Order ${orderId}`,
    tr: orderId,
  };
  const q = buildUpiQuery(params);
  const intentUrl = buildUpiIntent(params);

  if (ios) {
    // No scheme chooser on iOS -> explicit per-app buttons, laid out 2x2 so
    // four apps stay within a short iPhone / Android viewport. Each tile shows
    // the app's official logo; the copy-VPA row above is the universal fallback.
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
        {UPI_APPS.map((a) => {
          const logo = logos?.[a.id];
          return (
            <a
              key={a.id}
              href={a.href(q)}
              onClick={onAppLaunch}
              rel="noopener noreferrer"
              style={logoTileStyle}
              aria-label={`Pay with ${a.label}`}
            >
              {logo ? (
                <img src={logo.src} alt="" style={logoImgStyle} />
              ) : (
                <span style={logoFallbackStyle}>{a.label}</span>
              )}
            </a>
          );
        })}
      </div>
    );
  }

  if (isAndroid()) {
    return (
      <a href={intentUrl} onClick={onAppLaunch} rel="noopener noreferrer" style={{ ...linkStyle, marginTop: 16 }}>
        Pay with UPI app
      </a>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
      <div style={{ padding: 12, background: "#fff", borderRadius: radius.md, border: `1px solid ${color.border}` }}>
        {/* level="L" is deliberate: an on-screen QR has no damage to recover from,
            so the lowest ECC maximizes capacity -> a lower, easier-to-scan version. */}
        <QRCodeSVG value={intentUrl} size={200} level="L" />
      </div>
    </div>
  );
}
