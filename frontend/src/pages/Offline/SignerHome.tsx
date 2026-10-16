import { useState } from "react";
import { Link } from "react-router-dom";
import { QrCode, ScanLine, ShieldCheck } from "lucide-react";
import { WalletAccount } from "../../lib/api";
import { shortHex } from "../../lib/format";
import { STAGGER, useStagger } from "../../lib/motion";
import { PAGE_WIDE } from "../../lib/layout";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { motion } from "motion/react";
import { GlowCard } from "../../components/ui/GlowCard";
import { Panel, Section } from "../../components/ui/Panel";
import { CopyButton, EmptySymbol } from "../../components/ui/bits";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { Modal } from "../../components/ui/Modal";
import { QRCode } from "../../components/ui/QRCode";
import { Address } from "../Wallet/common";

/**
 * SignerHome is the offline signer's home: what this computer is for, the
 * way to sign, and its accounts, each with the QR code a wallet online
 * scans to follow it as watch-only.
 */
export default function SignerHome() {
  const t = useT();
  const stagger = useStagger();
  const { info } = useWallet();
  const [shown, setShown] = useState<WalletAccount | null>(null);
  if (!info) return null;
  const accounts = info.accounts.filter((a) => !a.watchOnly);

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <GlowCard>
        <div className="flex flex-col items-center gap-5 py-4 text-center">
          <EmptySymbol icon={ShieldCheck} className="size-12 text-good-ink" />
          <div className="flex max-w-lg flex-col gap-2">
            <h2 className="text-3xl font-semibold tracking-tight">{t("offline.home.title")}</h2>
            <p className="text-muted-foreground">{t("offline.home.desc")}</p>
          </div>
          <Link to="/sign" className="btn btn-primary btn-lg min-w-64">
            <ScanLine className="size-4" />
            {t("offline.home.cta")}
          </Link>
        </div>
      </GlowCard>

      <Section title={t("offline.home.accounts")} count={accounts.length}>
        <Panel className="overflow-hidden">
          {accounts.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">{t("wallet.accounts.empty")}</p>
          ) : (
            <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
              {accounts.map((a) => (
                <motion.li variants={STAGGER.item} key={a.address} className="flex items-center gap-3.5 px-4 py-3">
                  <AddressAvatar address={a.address} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{accountLabel(a, info.accounts, t)}</div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <span className="font-mono">{shortHex(a.address, 12, 10)}</span>
                      <CopyButton value={a.address} className="-my-1" />
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShown(a)}>
                    <QrCode className="size-3.5" />
                    {t("offline.home.showAddress")}
                  </button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </Panel>
        <p className="px-1 text-sm text-muted-foreground">{t("offline.home.watchHint")}</p>
      </Section>

      <Modal
        open={!!shown}
        onClose={() => setShown(null)}
        title={t("offline.home.showAddress")}
        subtitle={shown ? accountLabel(shown, info.accounts, t) : undefined}
        icon={<QrCode className="size-4" />}
      >
        {shown && (
          <div className="flex flex-col items-center gap-4 px-5 pb-6 text-center">
            <div className="rounded-3xl bg-white p-3 ring-1 ring-black/5">
              <QRCode value={shown.address} label={t("wallet.receive.qr")} />
            </div>
            <Address value={shown.address} className="text-[15px] leading-relaxed" />
            <p className="text-sm text-muted-foreground">{t("offline.home.watchHint")}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
