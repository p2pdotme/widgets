// Build NPCI UPI deep links (upi://pay) and per-app variants for the
// INR on-ramp accepted screen. Plain intent only (no signing / no orgid):
// P2P.me counterparties use personal VPAs, so the UPI app shows the normal
// person-to-person screen and reconciliation stays manual + on-chain.

export interface UpiParams {
  /** Payee VPA, e.g. "name@bank". */
  pa: string;
  /** Payee name. Apps display/expect it; sourced from the host productName. */
  pn?: string;
  /** Amount as a 2-decimal string, e.g. "125.00". */
  am: string;
  /** Transaction note, e.g. "Order 169". */
  tn?: string;
  /** Transaction reference, e.g. the order id. */
  tr?: string;
}

/** The shared `pa=...&am=...&cu=INR&...` query string, reused by every scheme. */
export function buildUpiQuery(p: UpiParams): string {
  const q = new URLSearchParams();
  q.set("pa", p.pa);
  // Cap the payee name: UPI apps show only a short name, and a long pn inflates
  // the desktop QR to a denser version that is harder to scan.
  if (p.pn) q.set("pn", p.pn.slice(0, 40));
  q.set("am", p.am);
  q.set("cu", "INR");
  if (p.tn) q.set("tn", p.tn);
  if (p.tr) q.set("tr", p.tr);
  return q.toString();
}

/** Generic UPI intent link. Pops the system chooser on Android; ambiguous on iOS. */
export function buildUpiIntent(p: UpiParams): string {
  return `upi://pay?${buildUpiQuery(p)}`;
}

/**
 * Per-app deep links for iOS, where there is no scheme chooser. Each `href`
 * takes the shared query string from `buildUpiQuery`.
 *
 * NOTE: these scheme prefixes are vendor conventions, not NPCI standard, and
 * vary by app/version. They MUST be validated on a real iPhone before merge —
 * no simulator or device-cloud can do it, since the UPI apps can't be installed
 * there. Documented alternates to try if one fails (from PSP iOS docs —
 * PayU / Cashfree / NTT Data):
 *   phonepe -> `phonepe://upi/pay?`
 *   gpay    -> `tez://upi/pay?`
 *   paytm   -> `paytm://upi/pay?`
 */
export const UPI_APPS = [
  { id: "phonepe", label: "PhonePe", href: (q: string) => `phonepe://pay?${q}` },
  { id: "gpay", label: "Google Pay", href: (q: string) => `gpay://upi/pay?${q}` },
  { id: "paytm", label: "Paytm", href: (q: string) => `paytmmp://pay?${q}` },
  { id: "bhim", label: "BHIM", href: (q: string) => `bhim://upi/pay?${q}` },
] as const;
