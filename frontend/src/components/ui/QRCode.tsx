import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * QRCode draws value as a QR code: dark modules on white whatever the
 * theme, as scanners expect, with the standard four-module quiet zone
 * (inside the white tile it sits on).
 * Medium error correction keeps it readable off a screen at a small size;
 * a longer value (a signing request) wants a larger className.
 */
export function QRCode({ value, label, className = "size-52" }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.isDark(y, x)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
    return { size: n + 8, path: d };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
