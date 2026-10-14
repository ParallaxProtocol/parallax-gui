import { useState } from "react";
import { ArrowDown, Check, Download } from "lucide-react";
import { OfflineTx, saveSigningDoc } from "../../lib/api";
import { formatGwei, formatInt, formatUnits, sameAddress, shortHex } from "../../lib/format";
import { useContacts } from "../../lib/contacts";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { GlowCard } from "../ui/GlowCard";
import { Property, Rows } from "../ui/Panel";
import { CopyButton } from "../ui/bits";
import { AddressAvatar } from "../ui/AddressAvatar";
import { QRCode } from "../ui/QRCode";
import { Address } from "../../pages/Wallet/common";

const LAX_DECIMALS = 18;

/** The network a chain ID names, for the review screens. */
export function networkName(chainId: number, t: (k: string) => string): string {
  if (chainId === 2110) return "Parallax";
  if (chainId === 1337) return t("offline.devChain");
  return `#${chainId}`;
}

/**
 * Fingerprint is a request's short id, as both screens show it for the
 * user to see they are signing the request they made.
 */
export function Fingerprint({ value, large }: { value: string; large?: boolean }) {
  return (
    <span className={`font-mono font-semibold tracking-[0.18em] tabular-nums ${large ? "text-2xl" : "text-sm"}`}>
      {value}
    </span>
  );
}

/**
 * DocCard shows a signing document to carry to the other computer: as a
 * QR code for its camera, with the fingerprint to compare, and as a file
 * to save or text to copy.
 */
export function DocCard({
  doc,
  fingerprint,
  fileName,
  title,
  desc,
}: {
  doc: string;
  fingerprint: string;
  fileName: string;
  title: string;
  desc: string;
}) {
  return (
    <GlowCard>
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="max-w-md text-muted-foreground">{desc}</p>
        </div>
        <DocBody doc={doc} fingerprint={fingerprint} fileName={fileName} />
      </div>
    </GlowCard>
  );
}

/** DocBody is a DocCard's content, for a dialog: the QR code, the fingerprint, and saving or copying it. */
export function DocBody({
  doc,
  fingerprint,
  fileName,
  qrClassName = "size-80",
}: {
  doc: string;
  fingerprint: string;
  fileName: string;
  qrClassName?: string;
}) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="rounded-3xl bg-white p-3 shadow-[0_12px_40px_-12px_rgb(0_0_0/45%)] ring-1 ring-black/5">
        <QRCode value={doc} label={t("offline.qrLabel")} className={qrClassName} />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm text-muted-foreground">{t("offline.fingerprint")}</span>
        <Fingerprint value={fingerprint} large />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={async () => setSaved(await saveSigningDoc(fileName, doc).catch(() => false))}
        >
          {saved ? <Check className="size-4" /> : <Download className="size-4" />}
          {saved ? t("offline.saved") : t("offline.saveFile")}
        </button>
        <CopyButton value={doc} label />
      </div>
    </div>
  );
}

/**
 * TxSummary is a transfer as both sides review it: the amount, who it goes
 * to (named from this computer's own address book or accounts), and every
 * figure that will be signed.
 */
export function TxSummary({ tx, feeLabel }: { tx: OfflineTx; feeLabel?: string }) {
  const t = useT();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const accounts = info?.accounts ?? [];
  const own = (a: string) => accounts.find((x) => sameAddress(x.address, a));
  const fromAcc = own(tx.from);
  const toAcc = own(tx.to);
  const contact = byAddress(tx.to);
  const toName = toAcc ? accountLabel(toAcc, accounts, t) : contact?.name;

  return (
    <div className="flex flex-col gap-5">
      <GlowCard>
        <div className="flex flex-col items-center gap-5 py-2 text-center">
          <span className="flex items-baseline gap-2.5">
            <span className="bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] bg-clip-text text-6xl font-semibold tracking-tight text-transparent tabular-nums">
              {formatUnits(tx.valueWei, LAX_DECIMALS)}
            </span>
            <span className="text-3xl font-medium text-muted-foreground">LAX</span>
          </span>
          <div className="flex w-full max-w-md flex-col items-center gap-2">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowDown className="size-3.5" />
              {t("wallet.send.to")}
            </span>
            {toName ? (
              <span className="flex items-center gap-3.5 rounded-2xl bg-muted px-5 py-3.5">
                <AddressAvatar address={tx.to} size={40} />
                <span className="flex min-w-0 flex-col items-start">
                  <span className="max-w-full truncate text-2xl font-semibold tracking-tight">{toName}</span>
                  <span className="selectable font-mono text-sm text-muted-foreground">{shortHex(tx.to, 10, 8)}</span>
                </span>
              </span>
            ) : (
              <>
                <span className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
                  <AddressAvatar address={tx.to} size={28} />
                  <Address value={tx.to} className="text-left text-[15px] leading-relaxed" />
                </span>
                <span className="text-sm text-muted-foreground">{t("wallet.review.checkAddress")}</span>
              </>
            )}
          </div>
        </div>
      </GlowCard>

      <Rows as="dl">
        <Property label={t("wallet.send.from")}>
          <AddressAvatar address={tx.from} size={20} />
          <span className="truncate">{fromAcc ? accountLabel(fromAcc, accounts, t) : shortHex(tx.from, 8, 6)}</span>
        </Property>
        <Property label={feeLabel ?? t("offline.maxFee")}>
          <span>
            {formatUnits(tx.maxFeeWei, LAX_DECIMALS)} LAX
            <span className="ml-2 text-sm text-muted-foreground">
              {t("wallet.review.feeDetail", { gas: formatInt(tx.gasLimit), price: formatGwei(tx.gasPriceWei) })}
            </span>
          </span>
        </Property>
        <Property label={t("wallet.review.total")}>
          <span className="font-semibold text-foreground">{formatUnits(tx.totalWei, LAX_DECIMALS)} LAX</span>
        </Property>
        <Property label={t("mempool.nonce")}>{formatInt(tx.nonce)}</Property>
        <Property label={t("offline.network")}>{networkName(tx.chainId, t)}</Property>
        {tx.memo && (
          <Property label={t("offline.memo")}>
            <span className="selectable truncate">{tx.memo}</span>
          </Property>
        )}
        <Property label={t("offline.fingerprint")}>
          <Fingerprint value={tx.fingerprint} />
        </Property>
      </Rows>
    </div>
  );
}
