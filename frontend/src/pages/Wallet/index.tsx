import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Clock,
  Eye,
  FileKey2,
  HardDrive,
  KeyRound,
  Lock,
  Plus,
  ScrollText,
  Server,
} from "lucide-react";
import { api, TxDetails, TxView } from "../../lib/api";
import { formatGwei, formatInt, formatLax, sameAddress, shortHex } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { STAGGER, useStagger } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useAgo, useLang, useT } from "../../i18n";
import { Counter } from "../../components/ui/Counter";
import { Panel, Section } from "../../components/ui/Panel";
import { IconBadge } from "../../components/ui/IconBadge";
import { Pill } from "../../components/ui/Pill";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { BrandMark } from "../../components/ui/BrandMark";
import { BackupModal } from "./AccountForms";
import { useSummary } from "./common";
import { GlowCard } from "../../components/ui/GlowCard";
import { PAGE_WIDE } from "../../lib/layout";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { GroupedAddress } from "../../components/ui/AccountParts";
import { RevealPhraseModal } from "./Phrase";
import { Detail, DetailCard, Unfold } from "../Overview/parts";
import { useContacts } from "../../lib/contacts";
import { PendingRequests } from "../Offline/Requests";

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
  // A wallet without its password shows only the welcome, until it has one
  if (!wallet.info.hasPassword) return <Locked existing={wallet.info.needsSetup} />;
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
  const [reveal, setReveal] = useState(false);
  // The activity row opened to its details, by hash, and the details read
  // so far (or why they couldn't be). A row opens once its details are in,
  // so it unfolds to its full height in one motion.
  const [opened, setOpened] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TxDetails | string>>({});
  const load = (hash: string) =>
    api
      .txDetails(hash)
      .then((d) => setDetails((m) => ({ ...m, [hash]: d })))
      .catch((e: unknown) => setDetails((m) => ({ ...m, [hash]: e instanceof Error ? e.message : String(e) })));
  const toggle = (hash: string) => {
    if (opened === hash) setOpened(null);
    else load(hash).then(() => setOpened(hash));
  };

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

  // The opened one read again as it lands in a block
  const openedBlock = activity.find((a) => a.hash === opened)?.block;
  useEffect(() => {
    if (opened && openedBlock) load(opened);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, openedBlock]);

  if (!account || !info) return null;
  const label = accountLabel(account, info.accounts, t);
  const balanceKnown = !!view?.balanceWei;
  const outgoing = view?.pending.filter((tx) => sameAddress(tx.from, view.address)).length ?? 0;

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      {!account.backedUp &&
        (account.fromSeed ? (
          <Notice
            tone="warn"
            title={t("wallet.phrase.missingTitle")}
            action={
              <button type="button" className="btn btn-secondary" onClick={() => setReveal(true)}>
                <ScrollText className="size-3.5" />
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
              <button type="button" className="btn btn-secondary" onClick={() => setBackup(true)}>
                <FileKey2 className="size-3.5" />
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

      <Section
        title={t("wallet.activity")}
        aside={view && t("wallet.activityWindow", { from: formatInt(view.scannedFrom) })}
      >
        <Panel className="overflow-hidden">
          {activity.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
              <IconBadge icon={ScrollText} size="lg" />
              <p>{!running ? t("wallet.activityOffline") : view ? t("wallet.activityEmpty") : "…"}</p>
            </div>
          ) : (
            <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
              {activity.map((a) => (
                <motion.li variants={STAGGER.item} key={`${a.pending}-${a.hash}`}>
                  <button
                    type="button"
                    onClick={() => toggle(a.hash)}
                    aria-expanded={opened === a.hash}
                    className={`flex h-16 w-full items-center gap-3.5 px-4 text-left transition-colors hover:bg-hover ${opened === a.hash ? "bg-hover" : ""}`}
                  >
                    <ActivityIcon kind={a.kind} pending={a.pending} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-medium">
                        {t(`wallet.kind.${a.kind}`)}
                        {a.pending && <Pill tone="info">{t("wallet.pending")}</Pill>}
                      </div>
                      <div className="truncate text-sm text-muted-foreground tabular-nums">
                        {a.pending ? t("wallet.inPool") : t("wallet.inBlock", { block: formatInt(a.block) })}
                        {a.kind !== "self" && (
                          <>
                            {" · "}
                            {a.kind === "out" ? t("wallet.row.to") : t("wallet.row.from")}{" "}
                            <Counterparty address={a.other} />
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className={`font-semibold ${a.kind === "in" ? "text-good-ink" : ""}`}>
                        {a.kind === "in" ? "+" : a.kind === "out" ? "−" : ""}
                        {formatLax(a.amountWei, 6)} <span className="font-normal text-muted-foreground">LAX</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {a.pending ? t("wallet.unconfirmed") : ago(a.time, now)}
                      </div>
                    </div>
                    <ChevronRight
                      className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${opened === a.hash ? "rotate-90" : ""}`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {opened === a.hash && (
                      <Unfold>
                        <ActivityDetails d={details[a.hash]} head={view?.headBlock ?? 0} />
                      </Unfold>
                    )}
                  </AnimatePresence>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </Panel>
      </Section>

      <RevealPhraseModal open={reveal} onClose={() => setReveal(false)} seedId={account.seedId || null} />
      <BackupModal open={backup} onClose={() => setBackup(false)} account={account} label={label} />
    </div>
  );
}

/** ActivityDetails is an opened activity row: everything the node knows of the transaction. */
function ActivityDetails({ d, head }: { d: TxDetails | string | undefined; head: number }) {
  const t = useT();
  const { lang } = useLang();

  // Indented to the row's text: its padding, the badge and the gap after it
  const inset = "pr-4 pl-[70px]";
  if (!d || typeof d === "string") {
    return (
      <DetailCard inset={inset}>
        <p className="text-sm text-critical-ink">{d}</p>
      </DetailCard>
    );
  }

  const pending = d.status === "pending";
  const confirmations = pending || head < d.block ? 0 : head - d.block + 1;
  const used = d.gasLimit > 0 ? Math.round((d.gasUsed / d.gasLimit) * 100) : 0;
  return (
    <DetailCard inset={inset}>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <Pill tone={pending ? "info" : d.status === "failed" ? "critical" : "good"}>
          {t(`wallet.tx.status.${d.status}`)}
        </Pill>
        {!pending && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {t(confirmations === 1 ? "wallet.tx.confirmation" : "wallet.tx.confirmations", {
              n: formatInt(confirmations),
            })}
          </span>
        )}
      </div>
      <dl className="space-y-2.5">
        <Detail label={t("mempool.hash")} value={d.hash} copy />
        {!pending && (
          <>
            <Detail
              label={t("wallet.tx.block")}
              value={`${formatInt(d.block)} · ${t("wallet.tx.position", { n: formatInt(d.index) })}`}
            />
            <Detail
              label={t("wallet.tx.time")}
              value={new Date(d.timestamp * 1000).toLocaleString(lang, { dateStyle: "medium", timeStyle: "medium" })}
            />
          </>
        )}
        <Detail label={t("mempool.from")} value={d.from} copy />
        <Detail label={t("mempool.to")} value={d.to || t("mempool.creation")} copy={!!d.to} />
        {d.contractAddress && <Detail label={t("wallet.tx.contract")} value={d.contractAddress} copy />}
        <Detail label={t("mempool.value")} value={`${formatLax(d.valueWei, 18)} LAX`} />
        <Detail label={pending ? t("mempool.maxFee") : t("wallet.tx.fee")} value={`${formatLax(d.feeWei, 18)} LAX`} />
        <Detail label={t("mempool.gasPrice")} value={formatGwei(d.gasPriceWei)} />
        <Detail
          label={t("wallet.tx.gas")}
          value={pending ? formatInt(d.gasLimit) : `${formatInt(d.gasUsed)} / ${formatInt(d.gasLimit)} (${used}%)`}
        />
        <Detail label={t("mempool.nonce")} value={String(d.nonce)} />
        {!pending && <Detail label={t("wallet.tx.events")} value={formatInt(d.logs)} />}
        <Detail label={t("mempool.size")} value={t("mempool.bytes", { n: formatInt(d.sizeBytes) })} />
        {!pending && <Detail label={t("wallet.tx.blockHash")} value={d.blockHash} copy />}
        <div className="grid grid-cols-[120px_1fr_auto] items-start gap-3">
          <dt className="text-sm text-muted-foreground">{t("mempool.data")}</dt>
          {d.input === "0x" ? (
            <dd className="text-sm">{t("peers.none")}</dd>
          ) : (
            <dd className="selectable max-h-28 overflow-y-auto font-mono text-sm break-all">{d.input}</dd>
          )}
          {d.input !== "0x" ? <CopyButton value={d.input} className="-my-1" /> : <span />}
        </div>
      </dl>
    </DetailCard>
  );
}

/**
 * Counterparty is the other side of an activity row: one of the wallet's
 * own accounts or a contact by name, any other address shortened, or a
 * contract creation, which has none.
 */
function Counterparty({ address }: { address: string }) {
  const t = useT();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  if (!address) return <>{t("mempool.creation")}</>;
  const own = info?.accounts.find((x) => sameAddress(x.address, address));
  if (own) return <span className="text-foreground/80">{accountLabel(own, info!.accounts, t)}</span>;
  const contact = byAddress(address);
  if (contact) return <span className="text-foreground/80">{contact.name}</span>;
  return <span className="font-mono">{shortHex(address, 8, 6)}</span>;
}

function ActivityIcon({ kind, pending }: { kind: Activity["kind"]; pending: boolean }) {
  return (
    <IconBadge
      icon={pending ? Clock : kind === "in" ? ArrowDownLeft : ArrowUpRight}
      tone={pending ? "info" : kind === "in" ? "good" : "neutral"}
    />
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
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-5 py-10">
      <BrandMark size={56} />
      <div className="flex max-w-lg flex-col items-center gap-2 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">{t("wallet.welcome.title")}</h2>
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
      <button type="button" className="btn btn-ghost" onClick={() => navigate("/accounts/watch")}>
        <Eye className="size-4" />
        {t("offline.watch.welcome")}
      </button>
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
      className="glass group flex items-start gap-3.5 p-5 text-left transition-colors"
    >
      <IconBadge icon={Icon} tone={primary ? "brand" : "neutral"} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

/**
 * Locked is the app before the wallet has its password: what the app is,
 * and the one way on, Get started, which sets the password. Nothing else
 * of the wallet shows until then. A wallet that has keys but no password
 * yet (from an earlier build) gets the same, worded for it.
 */
function Locked({ existing }: { existing: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const stagger = useStagger();
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 px-5 py-10">
      <motion.div {...stagger} className="flex w-full max-w-2xl flex-col items-center gap-8">
        <motion.div variants={STAGGER.item}>
          <BrandMark size={56} />
        </motion.div>
        <motion.div variants={STAGGER.item} className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">{t("wallet.locked.title")}</h2>
          <p className="max-w-lg text-muted-foreground">
            {existing ? t("wallet.locked.existing") : t("wallet.locked.desc")}
          </p>
        </motion.div>
        <motion.ul variants={STAGGER.item} className="grid w-full gap-5 sm:grid-cols-3">
          <Point icon={Server} title={t("wallet.locked.node")} desc={t("wallet.locked.nodeDesc")} />
          <Point icon={HardDrive} title={t("wallet.locked.keys")} desc={t("wallet.locked.keysDesc")} />
          <Point icon={Lock} title={t("wallet.locked.password")} desc={t("wallet.locked.passwordDesc")} />
        </motion.ul>
        <motion.div variants={STAGGER.item} className="flex flex-col items-center gap-2">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate("/setup")} autoFocus>
            {t("wallet.locked.cta")}
            <ArrowRight className="size-4" />
          </button>
          <span className="text-sm text-muted-foreground">{t("wallet.locked.ctaHint")}</span>
        </motion.div>
      </motion.div>
    </div>
  );
}

function Point({ icon: Icon, title, desc }: { icon: typeof Lock; title: string; desc: string }) {
  return (
    <li className="flex flex-col items-center gap-2 text-center">
      <IconBadge icon={Icon} tone="brand" className="ring-1 ring-brand/25" />
      <span className="font-medium">{title}</span>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </li>
  );
}
