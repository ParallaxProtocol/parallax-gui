import { useMemo } from "react";
import { Link } from "react-router-dom";
import qrcode from "qrcode-generator";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Address } from "./common";
import { GlowCard } from "../../components/ui/GlowCard";
import { PAGE_WIDE } from "../../lib/layout";
import { AddressAvatar } from "../../components/ui/AddressAvatar";

/**
 * ReceivePage shows where to send LAX to the selected account: its address
 * in full, to copy, and as a QR code for a phone's wallet to scan.
 */
export default function ReceivePage() {
  const t = useT();
  const { info, account } = useWallet();
  if (!info) return null;
  if (!account) {
    return (
      <div className={`p-5 ${PAGE_WIDE}`}>
        <Notice tone="info" action={<Link to="/" className="btn btn-secondary">{t("wallet.welcome.cta")}</Link>}>
          {t("wallet.noAccount")}
        </Notice>
      </div>
    );
  }
  const label = accountLabel(account, info.accounts, t);
  return (
    <div className={`flex flex-col gap-5 p-5 ${PAGE_WIDE}`}>
      {/* The address, to scan or to copy, as the page's one subject */}
      <GlowCard aria-label={t("wallet.receive.title")}>
        <div className="flex flex-col items-center gap-6 py-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <AddressAvatar address={account.address} size={44} />
            <span className="text-lg font-semibold">{label}</span>
            <span className="text-sm text-muted-foreground">{t("wallet.receive.title")}</span>
          </div>
          <div className="rounded-3xl bg-white p-3 shadow-[0_12px_40px_-12px_rgb(0_0_0/45%)] ring-1 ring-black/5">
            <QRCode value={account.address} label={t("wallet.receive.qr")} />
          </div>
          <Address value={account.address} className="max-w-md text-lg leading-relaxed" />
          <CopyButton value={account.address} label className="btn-lg min-w-48" />
          <p className="max-w-md text-muted-foreground">{t("wallet.receive.desc")}</p>
        </div>
      </GlowCard>
      <Notice tone="info">{t("wallet.receive.network")}</Notice>
    </div>
  );
}

/**
 * QRCode draws value as a QR code: dark modules on white whatever the
 * theme, as scanners expect, with the standard four-module quiet zone
 * (inside the white tile it sits on).
 * Medium error correction keeps it readable off a screen at a small size.
 */
function QRCode({ value, label }: { value: string; label: string }) {
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
      className="size-52 shrink-0"
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
