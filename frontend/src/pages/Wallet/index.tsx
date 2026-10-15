import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Ban,
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
  Zap,
} from "lucide-react";
import { api, ReplaceKind, TxDetails, TxView } from "../../lib/api";
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
import { Unfold } from "../Overview/parts";
import { useContacts } from "../../lib/contacts";
import { PendingRequests } from "../Offline/Requests";
import { ReplaceModal } from "./Replace";

type Activity = {
  kind: "in" | "out" | "self";
  /** Nothing sent to the account itself: how a waiting transaction is cancelled. */
  cancel: boolean;
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
  const now = useNow(5000);
  const { info, account } = useWallet();
  const { view, err, running, refresh } = useSummary(account?.address);
  const [backup, setBackup] = useState(false);
  const [replace, setReplace] = useState<{ from: string; hash: string; kind: ReplaceKind } | null>(null);
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
        cancel: kind === "self" && tx.kind === "transfer" && tx.valueWei === "0",
        pending,
        block: tx.block,
        time: tx.timestamp,
        amountWei: tx.valueWei,
        other: (fromMe ? tx.to : tx.from) || "",
        hash: tx.hash,
      };
    };
    // The backend lists confirmed ones newest first
    return [...view.pending.map((tx) => row(tx, true)), ...view.transactions.slice(0, 25).map((tx) => row(tx, false))];
  }, [view]);
  // Waiting ones get a section of their own, above the confirmed
  const waiting = activity.filter((a) => a.pending);
  const confirmed = activity.filter((a) => !a.pending);

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

      {waiting.length > 0 && (
        <Section title={t("wallet.pending")} count={waiting.length}>
          <Panel className="overflow-hidden">
            <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
              {waiting.map((a) => (
                <ActivityRow
                  key={a.hash}
                  a={a}
                  opened={opened === a.hash}
                  onToggle={() => toggle(a.hash)}
                  details={details[a.hash]}
                  head={view?.headBlock ?? 0}
                  now={now}
                  // A hot account's own waiting send can be replaced at its nonce
                  onReplace={
                    a.kind !== "in" && !account.watchOnly
                      ? (kind) => setReplace({ from: account.address, hash: a.hash, kind })
                      : undefined
                  }
                />
              ))}
            </motion.ul>
          </Panel>
        </Section>
      )}

      <Section
        title={t("wallet.activity")}
        aside={view && t("wallet.activityWindow", { from: formatInt(view.scannedFrom) })}
      >
        <Panel className="overflow-hidden">
          {confirmed.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
              <IconBadge icon={ScrollText} size="lg" />
              <p>{!running ? t("wallet.activityOffline") : view ? t("wallet.activityEmpty") : "…"}</p>
            </div>
          ) : (
            <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
              {confirmed.map((a) => (
                <ActivityRow
                  key={a.hash}
                  a={a}
                  opened={opened === a.hash}
                  onToggle={() => toggle(a.hash)}
                  details={details[a.hash]}
                  head={view?.headBlock ?? 0}
                  now={now}
                />
              ))}
            </motion.ul>
          )}
        </Panel>
      </Section>

      <ReplaceModal
        target={replace}
        onClose={() => setReplace(null)}
        onReplaced={(tx) => {
          // An opened transaction follows on to its replacement; a closed one stays closed
          if (replace && opened === replace.hash) load(tx.hash).then(() => setOpened(tx.hash));
          setReplace(null);
          refresh();
        }}
      />
      <RevealPhraseModal open={reveal} onClose={() => setReveal(false)} seedId={account.seedId || null} />
      <BackupModal open={backup} onClose={() => setBackup(false)} account={account} label={label} />
    </div>
  );
}

/**
 * ActivityRow is one transaction of the account's: what it was, with whom,
 * and for how much, opening to its details. One of the account's own still
 * waiting has the ways to speed it up or cancel it beside them.
 */
function ActivityRow({
  a,
  opened,
  onToggle,
  details,
  head,
  now,
  onReplace,
}: {
  a: Activity;
  opened: boolean;
  onToggle: () => void;
  details: TxDetails | string | undefined;
  head: number;
  now: number;
  onReplace?: (kind: ReplaceKind) => void;
}) {
  const t = useT();
  const ago = useAgo();
  const label = useId();
  return (
    <motion.li variants={STAGGER.item}>
      {/* The whole row opens it: a button beneath the row's contents, so
          the buttons to speed up or cancel can sit in the row beside them.
          It lights up wherever on the row the pointer is, those included */}
      <div className="group relative flex h-16 items-center gap-3.5 px-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={opened}
          aria-labelledby={label}
          className={`absolute inset-0 transition-colors group-hover:bg-hover ${opened ? "bg-hover" : ""}`}
        />
        <span className="pointer-events-none relative">
          <ActivityIcon kind={a.kind} pending={a.pending} cancel={a.cancel} />
        </span>
        <div id={label} className="pointer-events-none relative min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">
            {a.cancel ? t(a.pending ? "wallet.kind.cancelling" : "wallet.kind.cancelled") : t(`wallet.kind.${a.kind}`)}
          </div>
          <div className="truncate text-sm text-muted-foreground tabular-nums">
            {a.pending ? t("wallet.inPool") : t("wallet.inBlock", { block: formatInt(a.block) })}
            {a.kind !== "self" && (
              <>
                {" · "}
                {a.kind === "out" ? t("wallet.row.to") : t("wallet.row.from")} <Counterparty address={a.other} />
              </>
            )}
          </div>
        </div>
        {onReplace && (
          <span className="relative flex shrink-0 gap-2">
            <Tooltip content={t("wallet.replace.speedUp")}>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-icon"
                aria-label={t("wallet.replace.speedUp")}
                onClick={() => onReplace("speedUp")}
              >
                <Zap className="size-3.5" />
              </button>
            </Tooltip>
            <Tooltip content={t("wallet.replace.cancel")}>
              <button
                type="button"
                className="btn btn-danger btn-sm btn-icon"
                aria-label={t("wallet.replace.cancel")}
                onClick={() => onReplace("cancel")}
              >
                <Ban className="size-3.5" />
              </button>
            </Tooltip>
          </span>
        )}
        <div className="pointer-events-none relative text-right tabular-nums">
          <div className={`font-semibold ${a.kind === "in" ? "text-good-ink" : ""}`}>
            {a.kind === "in" ? "+" : a.kind === "out" ? "−" : ""}
            {formatLax(a.amountWei, 6)} <span className="font-normal text-muted-foreground">LAX</span>
          </div>
          <div className="text-sm text-muted-foreground">{a.pending ? t("wallet.unconfirmed") : ago(a.time, now)}</div>
        </div>
        <ChevronRight
          className={`pointer-events-none relative size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${opened ? "rotate-90" : ""}`}
        />
      </div>
      <AnimatePresence initial={false}>
        {opened && (
          <Unfold>
            <ActivityDetails d={details} head={head} cancel={a.cancel} />
          </Unfold>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/**
 * ActivityDetails is an opened activity row: everything the node knows of
 * the transaction, in the app's grouped boxes, two columns of them where
 * the window has room. Hashes and addresses are shortened, whole in a
 * tooltip and to copy.
 */
function ActivityDetails({
  d,
  head,
  cancel,
}: {
  d: TxDetails | string | undefined;
  head: number;
  /** A cancellation: its pill is neutral, nothing having gone through. */
  cancel: boolean;
}) {
  const t = useT();
  const { lang } = useLang();

  // Indented to the row's text: its padding, the badge and the gap after it
  const inset = "bg-hover pr-4 pb-4 pl-[70px]";
  if (!d || typeof d === "string") {
    return (
      <div className={inset}>
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-critical-ink">{d}</p>
      </div>
    );
  }

  const pending = d.status === "pending";
  const confirmations = pending || head < d.block ? 0 : head - d.block + 1;
  const used = d.gasLimit > 0 ? Math.round((d.gasUsed / d.gasLimit) * 100) : 0;
  return (
    <div className={`flex flex-col gap-3 ${inset}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {/* Confirmed, the pill counts its confirmations */}
        <Pill
          tone={pending ? "info" : d.status === "failed" ? "critical" : cancel ? "neutral" : "good"}
          className="tabular-nums"
        >
          {d.status === "success"
            ? t(confirmations === 1 ? "wallet.tx.confirmation" : "wallet.tx.confirmations", {
                n: formatInt(confirmations),
              })
            : t(`wallet.tx.status.${d.status}`)}
        </Pill>
        {!pending && (
          <span className="ml-auto text-muted-foreground tabular-nums">
            {new Date(d.timestamp * 1000).toLocaleString(lang, { dateStyle: "medium", timeStyle: "medium" })}
          </span>
        )}
      </div>
      {/* Two columns where there's room, each its boxes stacked, about as
          tall as the other: who and the chain's record of it on the left,
          what it cost and what it carried on the right */}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Facts>
            <Fact label={t("mempool.from")}>
              <Party address={d.from} />
            </Fact>
            <Fact label={t("mempool.to")}>{d.to ? <Party address={d.to} /> : t("mempool.creation")}</Fact>
            {d.contractAddress && (
              <Fact label={t("wallet.tx.contract")}>
                <Party address={d.contractAddress} />
              </Fact>
            )}
          </Facts>
          <Facts>
            <Fact label={t("mempool.hash")}>
              <Hex value={d.hash} />
            </Fact>
            {/* Shown waiting too (as are its events), a dash until it's in a block */}
            <Fact label={t("wallet.tx.block")}>
              {pending ? "—" : `${formatInt(d.block)} · ${t("wallet.tx.position", { n: formatInt(d.index) })}`}
            </Fact>
            <Fact label={t("wallet.tx.blockHash")}>{pending ? "—" : <Hex value={d.blockHash} />}</Fact>
            <Fact label={t("mempool.nonce")}>{formatInt(d.nonce)}</Fact>
            {/* A blank line, so this column ends level with the other */}
            <div aria-hidden className="min-h-10" />
          </Facts>
        </div>
        <div className="flex flex-col gap-3">
          <Facts>
            <Fact label={t("mempool.value")}>{formatLax(d.valueWei, 18)} LAX</Fact>
            <Fact label={pending ? t("mempool.maxFee") : t("wallet.tx.fee")}>{formatLax(d.feeWei, 18)} LAX</Fact>
            <Fact label={t("mempool.gasPrice")}>{formatGwei(d.gasPriceWei)}</Fact>
            <Fact label={t("wallet.tx.gas")}>
              {pending ? formatInt(d.gasLimit) : `${formatInt(d.gasUsed)} / ${formatInt(d.gasLimit)} (${used}%)`}
            </Fact>
          </Facts>
          <Facts>
            <Fact label={t("mempool.size")}>{t("mempool.bytes", { n: formatInt(d.sizeBytes) })}</Fact>
            <Fact label={t("wallet.tx.events")}>{pending ? "—" : formatInt(d.logs)}</Fact>
            <Fact label={t("mempool.data")}>{d.input === "0x" ? t("peers.none") : <Hex value={d.input} />}</Fact>
          </Facts>
        </div>
      </div>
    </div>
  );
}

/** Facts is a group of an opened row's details: a rounded box, its lines on hairlines. */
function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-border/70 rounded-lg bg-muted/60 text-sm">{children}</dl>;
}

/** Fact is one line of Facts: what it is on the left, its value on the right. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
      <dt className="shrink-0">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-muted-foreground tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** Hex is a hash or data, shortened: whole in its tooltip (unless too long to read there), and to copy. */
function Hex({ value }: { value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Tooltip content={value.length <= 258 ? value : null} mono>
        <span className="selectable truncate font-mono">{shortHex(value, 10, 8)}</span>
      </Tooltip>
      <CopyButton value={value} className="-my-1 -mr-2" />
    </span>
  );
}

/** Party is an address of a transaction: its name when the wallet knows one, the address shortened, to copy. */
function Party({ address }: { address: string }) {
  const t = useT();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const own = info?.accounts.find((x) => sameAddress(x.address, address));
  const name = own && info ? accountLabel(own, info.accounts, t) : byAddress(address)?.name;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {name && <span className="truncate text-foreground/80">{name}</span>}
      <span className="flex shrink-0 items-center gap-1">
        <Tooltip content={address} mono>
          <span className="selectable font-mono">{shortHex(address, 6, 4)}</span>
        </Tooltip>
        <CopyButton value={address} className="-my-1 -mr-2" />
      </span>
    </span>
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

function ActivityIcon({ kind, pending, cancel }: { kind: Activity["kind"]; pending: boolean; cancel: boolean }) {
  return (
    <IconBadge
      icon={pending ? Clock : cancel ? Ban : kind === "in" ? ArrowDownLeft : ArrowUpRight}
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
