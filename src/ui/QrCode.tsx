import { useMemo } from "react";
import { qrcodegen } from "../vendor/qrcodegen";

// QR spec minimum quiet zone: 4 modules of white on every side. Real camera
// scans need it even where lenient decoders forgive its absence.
const QUIET_ZONE = 4;

/**
 * Renders `data` as a QR code, entirely locally, as inline SVG. Replaces the
 * old third-party image request so payment payloads never leave the page and
 * the code renders with no external service up.
 */
export function QrCode({ data, size }: { data: string; size: number }) {
  // The paying screen re-renders every second for its countdown; encoding is
  // a few milliseconds, so compute the module path only when the data changes.
  const { dim, path } = useMemo(() => {
    const qr = qrcodegen.QrCode.encodeText(data, qrcodegen.QrCode.Ecc.MEDIUM);
    const parts: string[] = [];
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) {
          parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
        }
      }
    }
    return { dim: qr.size + QUIET_ZONE * 2, path: parts.join("") };
  }, [data]);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      role="img"
      aria-label="QR"
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
