import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Download,
  Eye,
  HardDrive,
  KeyRound,
  Lock,
  Plus,
  Server,
} from "lucide-react";
import { api } from "../../lib/api";
import { formatInt, formatLax, sameAddress, shortHex } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { STAGGER, useStagger } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Counter } from "../../components/ui/Counter";
import { Pill } from "../../components/ui/Pill";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { BackupModal } from "./AccountForms";
import { useSummary } from "./common";
import { GlowCard } from "../../components/ui/GlowCard";
import { PAGE_WIDE } from "../../lib/layout";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { GroupedAddress } from "../../components/ui/AccountParts";
import { RevealPhraseModal } from "./Phrase";
import { PendingRequests } from "../Offline/Requests";
import { PendingSection, RecentActivity } from "./Activity";

/**
 * WalletPage is the app's home: the selected account's balance, the way
 * to send and receive, and its activity, all read from the local node.
 * With no account yet the window is EmptyWallet's instead.
 */
export default function WalletPage() {
  const wallet = useWallet();
  if (!wallet.info) return null;
  // A wallet without its password is the greeting's (Hello), shown in the app's place
  if (!wallet.info.hasPassword) return null;
  // With no account the window is EmptyWallet's (App's Shell), not a page's
  return wallet.account ? <Overview /> : null;
}

/**
 * DamagedNotice tells what of the wallet's was found damaged as it opened
 * (backend/sealed.go): set aside, or taken from its last good copy. The
 * keys and the recovery phrases aren't among it.
 */
function DamagedNotice() {
  const t = useT();
  const { info, refresh } = useWallet();
  const damaged = info?.damaged ?? [];
  if (damaged.length === 0) return null;
  return (
    <Notice
      tone="warn"
      title={t("wallet.damaged.title")}
      action={
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            api
              .walletDismissDamaged()
              .then(refresh)
              .catch(() => {})
          }
        >
          {t("common.done")}
        </button>
      }
    >
      {t("wallet.damaged.desc", { what: damaged.map((d) => t(`wallet.damaged.${d}`)).join(", ") })}
    </Notice>
  );
}

function Overview() {
  const t = useT();
  const stagger = useStagger();
  const now = useNow(5000);
  const { info, account } = useWallet();
  const { view, err, running, refresh } = useSummary(account?.address);
  const [backup, setBackup] = useState(false);
  const [reveal, setReveal] = useState(false);
  if (!account || !info) return null;
  const label = accountLabel(account, info.accounts, t);
  const balanceKnown = !!view?.balanceWei;
  const outgoing = view?.pending.filter((tx) => sameAddress(tx.from, view.address)).length ?? 0;

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <DamagedNotice />
      {!account.backedUp &&
        (account.fromSeed ? (
          <Notice
            tone="warn"
            title={t("wallet.phrase.missingTitle")}
            action={
              <button type="button" className="btn btn-tinted" onClick={() => setReveal(true)}>
                {t("wallet.phrase.showConfirm")}
              </button>
            }
          >
            {t("wallet.phrase.missingDesc")}
          </Notice>
        ) : (
          <Notice
            tone="warn"
            title={t("wallet.backup.missingTitle")}
            action={
              <button type="button" className="btn btn-tinted" onClick={() => setBackup(true)}>
                {t("wallet.backup.cta")}
              </button>
            }
          >
            {t("wallet.backup.missingDesc")}
          </Notice>
        ))}

      {/* The account's card: who it is, what it holds, and the two things to do with it */}
      <GlowCard {...stagger} aria-label={label}>
        <div className="relative flex flex-col gap-6">
          <motion.div variants={STAGGER.item} className="flex items-center gap-3">
            <AddressAvatar address={account.address} size={36} />
            {/* The full address where the card has room for it, shortened where it hasn't */}
            <div className="@container flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate font-semibold">{label}</span>
                {account.watchOnly && (
                  <Tooltip content={t("offline.watchOnly.desc")}>
                    <Pill tone="neutral">{t("offline.watchOnly")}</Pill>
                  </Tooltip>
                )}
              </span>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <span className="hidden @md:inline">
                  <GroupedAddress address={account.address} />
                </span>
                <Tooltip content={account.address} mono>
                  <span className="font-mono @md:hidden">{shortHex(account.address, 8, 6)}</span>
                </Tooltip>
                <CopyButton value={account.address} className="-my-1" />
              </span>
            </div>
            {view && view.pending.length > 0 && (
              <Tooltip content={outgoing > 0 ? t("wallet.waitingOut", { n: outgoing }) : t("wallet.waitingDesc")}>
                <Pill tone="info" className="h-7 gap-1.5 px-3 text-sm tabular-nums">
                  <Clock className="size-3.5" />
                  {t("wallet.waiting")} · {formatInt(view.pending.length)}
                </Pill>
              </Tooltip>
            )}
          </motion.div>

          <motion.div variants={STAGGER.item} className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">{t("wallet.balance")}</span>
            <span className="flex items-baseline gap-2.5">
              <span className="bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] bg-clip-text text-6xl font-semibold tracking-tight text-transparent tabular-nums">
                {balanceKnown ? (
                  <Counter value={Number(formatLax(view!.balanceWei, 4))} format={(v) => formatAmount(v)} />
                ) : (
                  "—"
                )}
              </span>
              <span className="text-2xl font-medium text-muted-foreground">LAX</span>
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {!running
                ? t("wallet.balanceOffline")
                : !view
                  ? "…"
                  : balanceKnown
                    ? t("wallet.balanceAt", { block: formatInt(view.headBlock) })
                    : t("wallet.balanceSyncing")}
            </span>
          </motion.div>

          <motion.div variants={STAGGER.item} className="flex flex-wrap gap-3">
            <Link to="/send" className="btn btn-primary btn-lg min-w-40">
              <ArrowUpRight className="size-4" />
              {t("wallet.send")}
            </Link>
            <Link to="/receive" className="btn btn-secondary btn-lg min-w-40">
              <ArrowDownLeft className="size-4" />
              {t("wallet.receive")}
            </Link>
          </motion.div>
        </div>
      </GlowCard>

      {!running && <Notice tone="info">{t("wallet.nodeOff")}</Notice>}
      {err && <Notice tone="critical">{err}</Notice>}

      <PendingRequests />

      <PendingSection view={view} refresh={refresh} now={now} />
      <RecentActivity view={view} running={running} now={now} />

      <RevealPhraseModal open={reveal} onClose={() => setReveal(false)} seedId={account.seedId || null} />
      <BackupModal open={backup} onClose={() => setBackup(false)} account={account} label={label} />
    </div>
  );
}

/** Up to four decimals, without trailing zeros, as formatLax shows a balance. */
function formatAmount(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false });
}
