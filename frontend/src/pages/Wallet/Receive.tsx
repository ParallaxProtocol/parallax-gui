import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { api, walletError, type WalletAccount } from "../../lib/api";
import { DEVICE_NAME } from "../../components/hardware/Device";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Address } from "./common";
import { GlowCard } from "../../components/ui/GlowCard";
import { PAGE_WIDE } from "../../lib/layout";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { QRCode } from "../../components/ui/QRCode";

/**
 * ReceivePage shows where to send LAX to the selected account: its address
 * in full, to copy, and as a QR code for a phone's wallet to scan. A
 * hardware wallet's account can be shown on its device too, to check the
 * address there before sharing it.
 */
export default function ReceivePage() {
  const t = useT();
  const { info, account } = useWallet();
  if (!info) return null;
  if (!account) {
    return (
      <div className={`p-5 ${PAGE_WIDE}`}>
        <Notice
          tone="info"
          action={
            <Link to="/" className="btn btn-tinted">
              {t("wallet.welcome.cta")}
            </Link>
          }
        >
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
      {account.hardware && <VerifyOnDevice key={account.address} account={account} />}
      <Notice tone="info">{t("wallet.receive.network")}</Notice>
    </div>
  );
}

/**
 * VerifyOnDevice shows a hardware wallet account's address on its device,
 * for the user to compare with the one on the page: what the computer
 * shows could have been tampered with, what the device shows can't.
 */
function VerifyOnDevice({ account }: { account: WalletAccount }) {
  const t = useT();
  const device = DEVICE_NAME[account.hardware || "ledger"];
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDone(false), [account.address]);
  const verify = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.hardwareShowAddress(account.address);
      setDone(true);
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Notice
        tone="info"
        action={
          <button type="button" className="btn btn-tinted" disabled={busy} onClick={verify}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {t("hardware.verify.cta", { device })}
          </button>
        }
      >
        {busy
          ? t("hardware.verify.busy", { device })
          : done
            ? t("hardware.verify.done", { device })
            : t("hardware.verify.desc", { device })}
      </Notice>
      {error && <Notice tone="critical">{error}</Notice>}
    </>
  );
}
