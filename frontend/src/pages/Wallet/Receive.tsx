import { useMemo } from "react";
import { Link } from "react-router-dom";
import qrcode from "qrcode-generator";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Panel, Section } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Address } from "./common";

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
      <div className="p-5">
        <Notice tone="info" action={<Link to="/" className="btn btn-secondary">{t("wallet.welcome.cta")}</Link>}>
          {t("wallet.noAccount")}
        </Notice>
      </div>
    );
  }
  return (
    <div className="flex max-w-3xl flex-col gap-6 p-5">
      <Section title={accountLabel(account, info.accounts, t)}>
        <Panel className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-start">
          <QRCode value={account.address} label={t("wallet.receive.qr")} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h3 className="font-medium">{t("wallet.receive.title")}</h3>
            <Address value={account.address} className="text-[15px] leading-relaxed" />
            <div>
              <CopyButton value={account.address} label />
            </div>
            <p className="text-sm text-muted-foreground">{t("wallet.receive.desc")}</p>
          </div>
        </Panel>
        <Notice tone="info">{t("wallet.receive.network")}</Notice>
      </Section>
    </div>
  );
}

/**
 * QRCode draws value as a QR code: dark modules on white whatever the
 * theme, as scanners expect, with the standard four-module quiet zone.
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
      className="size-44 shrink-0 rounded-md border border-border"
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
