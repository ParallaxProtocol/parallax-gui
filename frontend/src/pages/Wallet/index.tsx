import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Clock, FileKey2, KeyRound, Plus } from "lucide-react";
import { TxView } from "../../lib/api";
import { formatInt, formatLax, sameAddress, shortHex } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { STAGGER, useStagger } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useAgo, useT } from "../../i18n";
import { Counter } from "../../components/ui/Counter";
import { Panel, Section, Stat, StatStrip } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { BrandMark } from "../../components/ui/BrandMark";
import { BackupDrawer } from "./AccountForms";
import { useSummary } from "./common";

type Activity = {
  kind: "in" | "out" | "self";
  pending: boolean;
  block: number;
  time: number;
  amountWei: string;
  other: string;
  hash: string;
};

/**
 * WalletPage is the app's home: the selected account's balance, the way
 * to send and receive, and its activity, all read from the local node.
 * With no accounts yet it offers to make or import one.
 */
export default function WalletPage() {
  const wallet = useWallet();
  if (!wallet.info) return null;
  return wallet.account ? <Overview /> : <Welcome />;
}

function Overview() {
  const t = useT();
  const stagger = useStagger();
  const ago = useAgo();
  const now = useNow(5000);
  const { info, account } = useWallet();
  const { view, err, running } = useSummary(account?.address);
  const [backup, setBackup] = useState(false);

  const activity = useMemo<Activity[]>(() => {
    if (!view) return [];
    const row = (tx: TxView, pending: boolean): Activity => {
      const fromMe = sameAddress(tx.from, view.address);
      const toMe = sameAddress(tx.to, view.address);
      const kind = fromMe && toMe ? "self" : fromMe ? "out" : "in";
      return {
        kind,
        pending,
        block: tx.block,
        time: tx.timestamp,
        amountWei: tx.valueWei,
        other: (fromMe ? tx.to : tx.from) || "",
        hash: tx.hash,
      };
    };
    // The backend lists confirmed ones newest first; waiting ones go on top
    return [...view.pending.map((tx) => row(tx, true)), ...view.transactions.slice(0, 25).map((tx) => row(tx, false))];
  }, [view]);

  if (!account || !info) return null;
  const label = accountLabel(account, info.accounts, t);
  const balanceKnown = !!view?.balanceWei;
  const outgoing = view?.pending.filter((tx) => sameAddress(tx.from, view.address)).length ?? 0;

  return (
    <div className="flex flex-col gap-6 p-5">
      {!account.backedUp && (
        <Notice
          tone="warn"
          title={t("wallet.backup.missingTitle")}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => setBackup(true)}>
              <FileKey2 className="size-3.5" />
              {t("wallet.backup.cta")}
            </button>
          }
        >
          {t("wallet.backup.missingDesc")}
        </Notice>
      )}

      <Section
        title={label}
        aside={
          <>
            <Tooltip content={account.address} mono>
              <span className="font-mono">{shortHex(account.address, 10, 8)}</span>
            </Tooltip>
            <CopyButton value={account.address} />
          </>
        }
      >
        {!running && <Notice tone="info">{t("wallet.nodeOff")}</Notice>}
        {err && <Notice tone="critical">{err}</Notice>}

        <StatStrip columns="2fr 1fr">
          <Stat
            label={t("wallet.balance")}
            value={
              balanceKnown ? (
                <Counter value={Number(formatLax(view!.balanceWei, 4))} format={(v) => formatAmount(v)} />
              ) : (
                "—"
              )
            }
            unit="LAX"
            detail={
              !running
                ? t("wallet.balanceOffline")
                : !view
                  ? "…"
                  : balanceKnown
                    ? t("wallet.balanceAt", { block: formatInt(view.headBlock) })
                    : t("wallet.balanceSyncing")
            }
          />
          <Stat
            label={t("wallet.waiting")}
            value={view ? formatInt(view.pending.length) : "—"}
            detail={outgoing > 0 ? t("wallet.waitingOut", { n: outgoing }) : t("wallet.waitingDesc")}
          />
        </StatStrip>

        <div className="flex gap-2">
          <Link to="/send" className="btn btn-primary btn-lg">
            <ArrowUpRight className="size-4" />
            {t("wallet.send")}
          </Link>
          <Link to="/receive" className="btn btn-secondary btn-lg">
            <ArrowDownLeft className="size-4" />
            {t("wallet.receive")}
          </Link>
        </div>
      </Section>

      <Section
        title={t("wallet.activity")}
        aside={view && <span className="tabular-nums">{t("wallet.activityWindow", { from: formatInt(view.scannedFrom) })}</span>}
      >
        <Panel className="overflow-hidden">
          {activity.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              {!running ? t("wallet.activityOffline") : view ? t("wallet.activityEmpty") : "…"}
            </p>
          ) : (
            <motion.ul {...stagger}>
              {activity.map((a) => (
                <motion.li
                  variants={STAGGER.item}
                  key={`${a.pending}-${a.hash}`}
                  className="flex h-12 items-center gap-3 px-4 transition-colors even:bg-muted/40 hover:bg-hover"
                >
                  <ActivityIcon kind={a.kind} pending={a.pending} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {t(`wallet.kind.${a.kind}`)}
                      {a.pending && <span className="text-sm text-info-ink">{t("wallet.pending")}</span>}
                    </div>
                    <div className="truncate text-sm text-muted-foreground tabular-nums">
                      {a.pending ? t("wallet.inPool") : t("wallet.inBlock", { block: formatInt(a.block) })}
                      {a.other && a.kind !== "self" && (
                        <>
                          {" · "}
                          <span className="font-mono">{shortHex(a.other, 8, 6)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className={a.kind === "in" ? "text-good-ink" : ""}>
                      {a.kind === "in" ? "+" : a.kind === "out" ? "−" : ""}
                      {formatLax(a.amountWei, 6)} LAX
                    </div>
                    <div className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                      {a.pending ? t("wallet.unconfirmed") : ago(a.time, now)}
                      <CopyButton value={a.hash} className="-my-1 -mr-2" />
                    </div>
                  </div>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </Panel>
      </Section>

      <BackupDrawer open={backup} onClose={() => setBackup(false)} account={account} label={label} />
    </div>
  );
}

function ActivityIcon({ kind, pending }: { kind: Activity["kind"]; pending: boolean }) {
  const Icon = pending ? Clock : kind === "in" ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-full ${
        kind === "in" ? "bg-brand-muted text-brand" : "bg-muted text-muted-foreground"
      }`}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** Up to four decimals, without trailing zeros, as formatLax shows a balance. */
function formatAmount(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false });
}

/** Welcome is the wallet before it holds an account: make one, or bring one. */
function Welcome() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center gap-6 px-5 py-14">
      <BrandMark size={48} />
      <div className="flex max-w-lg flex-col items-center gap-2 text-center">
        <h2 className="text-xl font-semibold">{t("wallet.welcome.title")}</h2>
        <p className="text-muted-foreground">{t("wallet.welcome.desc")}</p>
      </div>
      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        <Choice
          icon={Plus}
          title={t("wallet.welcome.create")}
          desc={t("wallet.welcome.createDesc")}
          onClick={() => navigate("/accounts/new")}
          primary
        />
        <Choice
          icon={KeyRound}
          title={t("wallet.welcome.import")}
          desc={t("wallet.welcome.importDesc")}
          onClick={() => navigate("/accounts/import")}
        />
      </div>
      <p className="max-w-lg text-center text-sm text-muted-foreground">{t("wallet.welcome.local")}</p>
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  desc,
  onClick,
  primary,
}: {
  icon: typeof Plus;
  title: string;
  desc: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-[var(--shadow-panel)] transition-colors hover:border-border-strong hover:bg-hover"
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full ${
          primary ? "bg-brand-muted text-brand" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
