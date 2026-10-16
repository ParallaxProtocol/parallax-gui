import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  Ban,
  CalendarDays,
  ChevronRight,
  Clock,
  History,
  Pickaxe,
  Search,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  onEvent,
  pickHistoryPath,
  walletError,
  type AddressView,
  type HistoryPage,
  type HistoryQuery,
  type HistoryTx,
  type ReplaceKind,
  type TxDetails,
  type TxView,
} from "../../lib/api";
import { formatGwei, formatInt, formatLax, isAddress, sameAddress, shortHex } from "../../lib/format";
import { POPUP, POPUP_ROW, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useContacts } from "../../lib/contacts";
import { useNode } from "../../lib/live";
import { useNodeSwitch } from "../../lib/nodeSwitch";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useAgo, useLang, useT } from "../../i18n";
import { Facts, Fact, Panel, Section } from "../../components/ui/Panel";
import { IconBadge } from "../../components/ui/IconBadge";
import { Pill } from "../../components/ui/Pill";
import { EmptySymbol, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { ActivitySpinner } from "../../components/ui/ActivitySpinner";
import { Segmented } from "../../components/ui/Segmented";
import { SearchField } from "../../components/ui/SearchField";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { usePopup } from "../../components/ui/popup";
import { Hex, Party, Unfold } from "../Overview/parts";
import { NODE_ICON } from "../../components/shell/NodeBar";
import { ReplaceModal } from "./Replace";

export type Activity = {
  /** The row's key, and what opens it: the transaction's hash, or a mined block's. */
  key: string;
  kind: "in" | "out" | "self" | "mined";
  /** Nothing sent to the account itself: how a waiting transaction is cancelled. */
  cancel: boolean;
  pending: boolean;
  failed: boolean;
  block: number;
  /** Its position in the block, for the node to read it there. */
  index: number;
  time: number;
  amountWei: string;
  other: string;
  hash: string;
  /** A mined block's record, all its details: there's no transaction to read. */
  mined?: HistoryTx;
};

/** keyOf is a history item's key: its transaction's hash, or its mined block's. */
const keyOf = (tx: HistoryTx) => tx.hash || `mined:${tx.blockHash}`;

/** isOlder orders history items as the backend does: by block, a block's reward after its transactions. */
function isOlder(a: HistoryTx, b: HistoryTx): boolean {
  if (a.block !== b.block) return a.block < b.block;
  const pos = (x: HistoryTx) => (x.kind === "mined" ? Infinity : x.index);
  return pos(a) < pos(b);
}

/** toActivity is a transaction as a row of the account's: waiting in the pool, or one of its history. */
export function toActivity(tx: TxView | HistoryTx, account: string, pending: boolean): Activity {
  const failed = "failed" in tx && tx.failed;
  if (tx.kind === "mined") {
    const m = tx as HistoryTx;
    return {
      key: keyOf(m),
      kind: "mined",
      cancel: false,
      pending: false,
      failed: false,
      block: m.block,
      index: 0,
      time: m.timestamp,
      amountWei: m.valueWei,
      other: "",
      hash: "",
      mined: m,
    };
  }
  const fromMe = sameAddress(tx.from, account);
  const toMe = sameAddress(tx.to, account);
  const kind = fromMe && toMe ? "self" : fromMe ? "out" : "in";
  return {
    key: tx.hash,
    kind,
    cancel: kind === "self" && tx.kind === "transfer" && tx.valueWei === "0" && !failed,
    pending,
    failed,
    block: tx.block,
    index: "index" in tx ? tx.index : 0,
    time: tx.timestamp,
    amountWei: tx.valueWei,
    other: (fromMe ? tx.to : tx.from) || "",
    hash: tx.hash,
  };
}

/**
 * useTxDetails keeps which row of a list is open and the details read for
 * it (or why they couldn't be). A row opens once its details are in, so it
 * unfolds to its full height in one motion; a mined block's opens at once,
 * its record being all there is. The open one is read again as it lands
 * in a block.
 */
export function useTxDetails(rows: Activity[]) {
  const [opened, setOpened] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TxDetails | string>>({});
  const load = useCallback(
    (hash: string, block = 0, index = 0) =>
      api
        .txDetails(hash, block, index)
        .then((d) => setDetails((m) => ({ ...m, [hash]: d })))
        .catch((e: unknown) => setDetails((m) => ({ ...m, [hash]: e instanceof Error ? e.message : String(e) }))),
    [],
  );
  const open = useCallback(
    (a: Activity) =>
      a.mined ? Promise.resolve(setOpened(a.key)) : load(a.hash, a.block, a.index).then(() => setOpened(a.key)),
    [load],
  );
  const toggle = (a: Activity) => (opened === a.key ? setOpened(null) : open(a));

  const openedRow = rows.find((a) => a.key === opened);
  const openedBlock = openedRow?.block;
  useEffect(() => {
    if (openedRow && !openedRow.mined && openedBlock) load(openedRow.hash, openedBlock, openedRow.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, openedBlock]);

  return { opened, setOpened, details, load, open, toggle };
}

export type HistoryFilter = "all" | "in" | "out" | "mined" | "failed";

/** Where the list starts, when not at the newest: a block, a date's last block, or a transaction found by hash. */
type Jump =
  | { kind: "block"; block: number }
  | { kind: "date"; block: number; date: string }
  | { kind: "tx"; hash: string };

/** What the history shows: a kind of item, the transactions with one address, from a starting point. */
export type HistoryView = { filter: HistoryFilter; with: string; jump: Jump | null };

export const NEWEST: HistoryView = { filter: "all", with: "", jump: null };

const FILTERS: HistoryFilter[] = ["all", "in", "out", "mined", "failed"];

/**
 * viewFromParams reads a view from a page's URL (/history?filter=out&with=…,
 * ?block=…[&date=…], ?tx=…), what isn't one left out; paramsFromView writes
 * it back.
 */
export function viewFromParams(p: URLSearchParams): HistoryView {
  const filter = FILTERS.find((f) => f !== "all" && f === p.get("filter")) ?? "all";
  const w = p.get("with") ?? "";
  const tx = (p.get("tx") ?? "").toLowerCase();
  const block = Number(p.get("block"));
  const date = p.get("date") ?? "";
  const jump: Jump | null = /^0x[0-9a-f]{64}$/.test(tx)
    ? { kind: "tx", hash: tx }
    : Number.isSafeInteger(block) && block > 0
      ? /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? { kind: "date", block, date }
        : { kind: "block", block }
      : null;
  return { filter, with: isAddress(w) ? w : "", jump };
}

export function paramsFromView(v: HistoryView): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.filter !== "all") out.filter = v.filter;
  if (v.with) out.with = v.with;
  if (v.jump?.kind === "tx") out.tx = v.jump.hash;
  else if (v.jump) {
    out.block = String(v.jump.block);
    if (v.jump.kind === "date") out.date = v.jump.date;
  }
  return out;
}

/** The backend query for a view, from its start: a transaction's place once it's been found (cursor). */
function queryOf(address: string, v: HistoryView, cursor = ""): HistoryQuery {
  return {
    address,
    cursor,
    filter: v.filter === "all" ? "" : v.filter,
    with: v.with,
    atBlock: v.jump && v.jump.kind !== "tx" ? v.jump.block : 0,
  };
}

/**
 * useHistory reads the list a view asks for: its first page, read again
 * as blocks come (and every few seconds while the history is indexed, for
 * its progress), and the older pages loaded as the list scrolls. The first
 * page is the whole history down to its last item: an older page's item
 * above that and not in it is one a reorg took off, and one in both is
 * shown where the first page has it.
 */
function useHistory(query: HistoryQuery | null) {
  const node = useNode();
  const running = !!node?.running;
  // While syncing the head moves on every poll: read again only every few hundred blocks then
  const head = node?.syncing ? Math.floor(node.currentBlock / 500) : (node?.currentBlock ?? 0);
  const key = JSON.stringify(query);
  const base = useMemo(() => query, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const [first, setFirst] = useState<{ key: string; page: HistoryPage } | null>(null);
  const [older, setOlder] = useState<{ key: string; items: HistoryTx[]; next: string } | null>(null);
  const [err, setErr] = useState<{ key: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!running || !base) return;
    let alive = true;
    api
      .walletHistory(base)
      .then((page) => {
        if (!alive) return;
        setFirst({ key, page });
        setErr(null);
      })
      .catch((e: unknown) => alive && setErr({ key, text: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [key, base, running, head, tick]);

  const page = running && first?.key === key ? first.page : null;
  const building = !!page && !page.complete && page.indexing;
  useEffect(() => {
    if (!building) return;
    const id = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, [building]);

  const more = older?.key === key ? older : null;
  const list = useMemo(() => {
    if (!page) return { items: [] as HistoryTx[], next: "" };
    if (!more) return { items: page.transactions, next: page.next };
    const last = page.transactions[page.transactions.length - 1];
    const seen = new Set(page.transactions.map(keyOf));
    const kept = page.next && last ? more.items.filter((x) => !seen.has(keyOf(x)) && isOlder(x, last)) : [];
    return { items: [...page.transactions, ...kept], next: more.next };
  }, [page, more]);

  const loadMore = () => {
    if (!base || !page || !list.next || loading) return;
    const at = key;
    const shown = more ? list.items : page.transactions;
    setLoading(true);
    api
      .walletHistory({ ...base, cursor: list.next })
      .then((p) => setOlder({ key: at, items: [...shown, ...p.transactions], next: p.next }))
      .catch((e: unknown) => setErr({ key: at, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  };
  const retry = () => {
    setErr(null);
    if (!page) setTick((n) => n + 1);
    else loadMore();
  };

  return {
    running,
    page,
    items: list.items,
    next: list.next,
    loading,
    err: err?.key === key ? err.text : null,
    loadMore,
    retry,
  };
}

/**
 * useNearEnd calls back while el is within a screen of the view and
 * enabled: so a list loads its next page before it's scrolled to its end,
 * and goes on loading while a short page leaves its end in view.
 */
function useNearEnd(enabled: boolean, cb: () => void) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "0px 0px 600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  const call = useRef(cb);
  call.current = cb;
  useEffect(() => {
    if (near && enabled) call.current();
  }, [near, enabled]);
  return setEl;
}

/** dayOf is a local day's key, and its heading: today, yesterday, a date this year, or one of another. */
function useDay() {
  const t = useT();
  const { lang } = useLang();
  return (time: number, now: number) => {
    const d = new Date(time * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const today = new Date(now);
    const yesterday = new Date(now - 86_400_000);
    const same = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const label = same(d, today)
      ? t("wallet.history.today")
      : same(d, yesterday)
        ? t("wallet.history.yesterday")
        : d.toLocaleDateString(lang, {
            weekday: "long",
            month: "long",
            day: "numeric",
            ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
          });
    return { key, label };
  };
}

/**
 * ActivitySection is the account's history: filtered by kind, searched by
 * counterparty, transaction or block, from a date, exported as CSV; by
 * day, loading on as it's scrolled. The view is the page's to keep (in
 * its URL): onView changes it, replacing the one shown when replace is set.
 */
export function ActivitySection({
  address,
  head,
  now,
  view,
  onView,
  onFoundPending,
  titled = true,
}: {
  address: string;
  head: number;
  now: number;
  view: HistoryView;
  onView: (v: HistoryView, replace?: boolean) => void;
  /** A transaction searched for that's still waiting: the Pending section above opens it. */
  onFoundPending: (hash: string) => void;
  /** Headed Activity, set apart from the Pending section above; untitled under the page's own title alone. */
  titled?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const stagger = useStagger();
  const day = useDay();
  const node = useNode();
  const nodeSwitch = useNodeSwitch();
  const { info } = useWallet();
  const { contacts } = useContacts();
  const [message, setMessage] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => setMessage(null), [address]);

  // A transaction to start at is found first, for its place in the history
  const [found, setFound] = useState<{ hash: string; cursor: string } | null>(null);
  const jumpHash = view.jump?.kind === "tx" ? view.jump.hash : "";
  const resolved = !jumpHash || found?.hash === jumpHash;
  const query = useMemo(
    () => (resolved ? queryOf(address, view, jumpHash ? found!.cursor : "") : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, view, resolved, found],
  );

  const h = useHistory(query);
  const rows = useMemo(() => h.items.map((tx) => toActivity(tx, address, false)), [h.items, address]);
  const tx = useTxDetails(rows);
  const sentinel = useNearEnd(!!h.next && !h.loading && !h.err, h.loadMore);

  const running = !!node?.running;
  useEffect(() => {
    if (!jumpHash || resolved || !running) return;
    let alive = true;
    api
      .walletFindTx(address, jumpHash)
      .then((f) => {
        if (!alive) return;
        if (!f.found || f.pending) {
          onView({ ...view, jump: null }, true);
          if (f.pending) onFoundPending(jumpHash);
          else setMessage({ tone: "info", text: t("wallet.history.notFound") });
          return;
        }
        setFound({ hash: jumpHash, cursor: f.cursor });
        tx.open(toActivity(f.item, address, false));
      })
      .catch((e: unknown) => alive && setMessage({ tone: "critical", text: walletError(e, t) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpHash, resolved, running, address]);

  // Names for the counterparties: the wallet's accounts and the contacts
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of contacts ?? []) out[c.address] = c.name;
    for (const a of info?.accounts ?? []) out[a.address] = accountLabel(a, info!.accounts, t);
    return out;
  }, [contacts, info, t]);

  const filtered = view.filter !== "all" || !!view.with || !!view.jump;
  const set = (v: Partial<HistoryView>) => {
    setMessage(null);
    tx.setOpened(null);
    onView({ ...view, ...v });
  };

  const jumpToDate = async (date: string) => {
    if (!date) return;
    const [y, m, d] = date.split("-").map(Number);
    // The day's last block: what was mined by its end, local time
    const end = new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000;
    try {
      const block = await api.historyBlockAt(Math.floor(end));
      set({ jump: { kind: "date", block, date } });
    } catch (e) {
      setMessage({ tone: "critical", text: walletError(e, t) });
    }
  };

  const exportCsv = async () => {
    const short = address.slice(2, 8).toLowerCase();
    const path = await pickHistoryPath(`parallax-activity-${short}-${new Date().toISOString().slice(0, 10)}.csv`);
    if (!path) return;
    setMessage(null);
    setExporting({ done: 0, total: 1 });
    const off = onEvent<{ done: number; total: number }>("history-export", setExporting);
    try {
      const n = await api.walletExportHistory({ ...queryOf(address, view), atBlock: 0 }, path, names);
      setMessage({ tone: "info", text: t("wallet.history.exported", { n: formatInt(n) }) });
    } catch (e) {
      setMessage({ tone: "critical", text: walletError(e, t) });
    } finally {
      off();
      setExporting(null);
    }
  };

  const withName = view.with ? (names[view.with] ?? shortHex(view.with, 8, 6)) : "";
  const jumpLabel = !view.jump
    ? ""
    : view.jump.kind === "block"
      ? t("wallet.history.fromBlock", { block: formatInt(view.jump.block) })
      : view.jump.kind === "date"
        ? t("wallet.history.fromDate", {
            date: new Date(`${view.jump.date}T12:00:00`).toLocaleDateString(lang, { dateStyle: "medium" }),
          })
        : t("wallet.history.fromTx", { hash: shortHex(view.jump.hash, 8, 6) });
  const complete = !!h.page?.complete;
  const exportPct = exporting && exporting.total > 0 ? Math.floor((exporting.done / exporting.total) * 100) : null;

  // The rows by local day, each day a group of its own under its date, as a Mac's grouped lists
  const days = useMemo(() => {
    const out: { key: string; label: string; rows: Activity[] }[] = [];
    for (const a of rows) {
      const d = day(a.time, now);
      if (out.length > 0 && out[out.length - 1].key === d.key) out[out.length - 1].rows.push(a);
      else out.push({ ...d, rows: [a] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, now, lang]);

  const retry = (
    <>
      <p className="text-critical-ink">{h.err}</p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={h.retry}>
        {t("wallet.history.retry")}
      </button>
    </>
  );

  return (
    <Section
      title={titled ? t("wallet.activity") : undefined}
      aside={h.page && <HistoryState view={{ ...h.page, headBlock: head }} />}
    >
      <ToolbarAccessory>
        <HistoryActions
          onDate={jumpToDate}
          onExport={exportCsv}
          canExport={complete}
          exporting={exporting ? (exportPct ?? 0) : null}
        />
      </ToolbarAccessory>

      {/* What to show: found by what's typed, then a kind of item, and what's set besides, to clear */}
      <HistorySearch
        address={address}
        names={names}
        onWith={(a) => set({ with: a, jump: view.jump?.kind === "tx" ? null : view.jump })}
        onBlock={(block) => set({ jump: { kind: "block", block } })}
        onHash={(hash) => set({ filter: "all", with: "", jump: { kind: "tx", hash } })}
        onNoMatch={() => setMessage({ tone: "info", text: t("wallet.history.noSuggestion") })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<HistoryFilter>
          value={view.filter}
          onChange={(filter) => set({ filter })}
          options={FILTERS.map((v) => ({ value: v, label: t(`wallet.history.filter.${v}`) }))}
        />
        {view.with && <Chip label={t("wallet.history.with", { name: withName })} onClear={() => set({ with: "" })} />}
        {view.jump && <Chip label={jumpLabel} onClear={() => set({ jump: null })} />}
      </div>

      {message && (
        <Notice
          tone={message.tone}
          action={
            <button type="button" className="btn btn-tinted btn-sm" onClick={() => setMessage(null)}>
              {t("common.close")}
            </button>
          }
        >
          {message.text}
        </Notice>
      )}

      {rows.length === 0 && h.next ? (
        // A filter still looking through a long history: it goes on until it finds some, or the end
        <Panel>
          <div
            ref={sentinel}
            className="flex flex-col items-center gap-3 py-14 text-center text-sm text-muted-foreground"
          >
            {h.err ? (
              retry
            ) : (
              <>
                <ActivitySpinner size={20} />
                <p>{t("wallet.history.searching")}</p>
              </>
            )}
          </div>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
            {!h.running ? (
              // The node's tower and the way to connect, as Send's button; the switch's error over it
              <>
                <EmptySymbol icon={NODE_ICON} />
                <p className="max-w-sm">{t("wallet.activityOffline")}</p>
                {nodeSwitch.err && <p className="max-w-sm text-sm text-critical-ink">{nodeSwitch.err}</p>}
                <button
                  type="button"
                  className="btn btn-primary mt-1 min-w-40"
                  onClick={nodeSwitch.toggle}
                  disabled={nodeSwitch.busy}
                >
                  {nodeSwitch.busy && <ActivitySpinner size={14} />}
                  {nodeSwitch.busy ? t("node.starting") : t("node.start")}
                </button>
              </>
            ) : !h.page && !h.err ? (
              <ActivitySpinner size={20} />
            ) : (
              // An account's history otherwise, only empty; a filter's, with the way back
              <>
                <EmptySymbol icon={filtered ? Search : History} />
                <p className="max-w-sm">
                  {!h.page
                    ? h.err
                    : filtered
                      ? t(complete ? "wallet.history.noMatch" : "wallet.history.noMatchYet")
                      : complete
                        ? t("wallet.activityNone")
                        : t("wallet.activityNoneYet")}
                </p>
                {filtered && h.page && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => set(NEWEST)}>
                    {t("wallet.history.clear")}
                  </button>
                )}
              </>
            )}
          </div>
        </Panel>
      ) : (
        <>
          <motion.div {...stagger} className="flex flex-col gap-5">
            {days.map((d) => (
              <section key={d.key} className="flex flex-col gap-2">
                <h3 className="px-1 text-sm font-semibold text-muted-foreground">{d.label}</h3>
                <Panel as="ul" className="flex flex-col divide-y divide-border overflow-hidden">
                  {d.rows.map((a) => (
                    <ActivityRow
                      key={a.key}
                      a={a}
                      opened={tx.opened === a.key}
                      onToggle={() => tx.toggle(a)}
                      details={tx.details[a.hash]}
                      head={head}
                      now={now}
                      // Off screen, a row isn't laid out: a long history stays light
                      className="[contain-intrinsic-size:auto_4rem] [content-visibility:auto]"
                    />
                  ))}
                </Panel>
              </section>
            ))}
          </motion.div>
          {/* Older pages load as the end comes near; while the history is indexed, why there's no more yet */}
          {(h.next || h.err || !complete) && (
            <div
              ref={sentinel}
              className="flex flex-col items-center gap-2 px-4 py-2 text-center text-sm text-muted-foreground"
            >
              {h.err ? (
                retry
              ) : h.next ? (
                <ActivitySpinner size={16} />
              ) : h.page?.indexing ? (
                <p>{t("wallet.historyBuilding", { pct: indexedPct({ ...h.page, headBlock: head }) })}</p>
              ) : (
                <p>{t("wallet.historyLatestOnlyDesc")}</p>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/**
 * PendingSection is the account's transactions waiting in the pool, from
 * the summary: its own sends there can be sped up or cancelled. focus opens
 * one and scrolls it into view (a search found it waiting).
 */
export function PendingSection({
  view,
  refresh,
  now,
  focus,
}: {
  view: AddressView | null;
  refresh: () => void;
  now: number;
  focus?: { hash: string; at: number } | null;
}) {
  const t = useT();
  const stagger = useStagger();
  const { account } = useWallet();
  const [replace, setReplace] = useState<{ from: string; hash: string; kind: ReplaceKind } | null>(null);
  const waiting = useMemo(() => (view ? view.pending.map((tx) => toActivity(tx, view.address, true)) : []), [view]);
  const { opened, setOpened, details, load, open, toggle } = useTxDetails(waiting);
  useEffect(() => {
    const row = focus && waiting.find((a) => a.hash === focus.hash);
    if (!row) return;
    open(row).then(() =>
      document.getElementById(`pending-${row.hash}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  if (!account) return null;
  return (
    <>
      {waiting.length > 0 && (
        <Section title={t("wallet.pending")} count={waiting.length}>
          <Panel className="overflow-hidden">
            <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
              {waiting.map((a) => (
                <ActivityRow
                  key={a.key}
                  id={`pending-${a.hash}`}
                  a={a}
                  opened={opened === a.key}
                  onToggle={() => toggle(a)}
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
    </>
  );
}

/** How many of the newest items the Overview shows. */
const RECENT = 5;

/**
 * RecentActivity is the Overview's glance at the history: its newest few
 * items, from the summary, opening in place; the History page has the rest.
 */
export function RecentActivity({ view, running, now }: { view: AddressView | null; running: boolean; now: number }) {
  const t = useT();
  const stagger = useStagger();
  const rows = useMemo(
    () => (view ? view.transactions.slice(0, RECENT).map((tx) => toActivity(tx, view.address, false)) : []),
    [view],
  );
  const { opened, details, toggle } = useTxDetails(rows);
  const head = view?.headBlock ?? 0;
  return (
    <Section
      title={t("wallet.recent")}
      aside={
        <>
          {view && <HistoryState view={view} />}
          {/* The app's text link, as Settings' Read more: its chevron nudging on, never underlined; only with something to see */}
          {rows.length > 0 && (
            <Link
              to="/history"
              className="group inline-flex items-center gap-0.5 font-medium whitespace-nowrap text-brand"
            >
              {t("wallet.seeAll")}
              <ChevronRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          )}
        </>
      }
    >
      <Panel className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            {/* The node's tower when it's off, the reason; an account's history otherwise, only empty */}
            {running && !view ? (
              <ActivitySpinner size={20} />
            ) : (
              <>
                <EmptySymbol icon={running ? History : NODE_ICON} />
                <p className="max-w-sm">
                  {!running
                    ? t("wallet.activityOffline")
                    : view!.complete
                      ? t("wallet.activityNone")
                      : t("wallet.activityNoneYet")}
                </p>
              </>
            )}
          </div>
        ) : (
          <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
            {rows.map((a) => (
              <ActivityRow
                key={a.key}
                a={a}
                opened={opened === a.key}
                onToggle={() => toggle(a)}
                details={details[a.hash]}
                head={head}
                now={now}
              />
            ))}
          </motion.ul>
        )}
      </Panel>
    </Section>
  );
}

/** Chip is a part of the view that's set, cleared by its cross. */
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  const t = useT();
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-muted pr-1 pl-3 text-sm font-medium text-brand">
      {label}
      <button
        type="button"
        className="grid size-5 place-items-center rounded-full hover:bg-brand/15"
        onClick={onClear}
        aria-label={t("wallet.history.clear")}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * HistoryActions is what acts on the whole history, in the toolbar: a glass
 * pill, as Contacts' Import and Export, of going to a date (picked in the
 * system's calendar) and exporting what's shown, its progress in its place.
 */
function HistoryActions({
  onDate,
  onExport,
  canExport,
  exporting,
}: {
  onDate: (date: string) => void;
  onExport: () => void;
  canExport: boolean;
  /** The export's progress while it runs, as a whole percentage. */
  exporting: number | null;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [down, setDown] = useState(false);
  // The page's scroller, the toolbar's main, which this pill sits in
  useEffect(() => {
    const main = box.current?.closest("main");
    if (!main) return;
    const onScroll = () => setDown(main.scrollTop > 240);
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);
  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.current?.closest("main")?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  const today = new Date();
  const max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const capsule =
    "flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium text-foreground/70 transition-colors enabled:hover:text-foreground focus-visible:text-foreground disabled:opacity-50";
  return (
    <div ref={box} className="no-drag glass flex h-9 items-center rounded-full px-1.5">
      {/* Back to the top, once the page has scrolled down: opening out of the pill's left end, as Contacts' Export does */}
      <AnimatePresence initial={false}>
        {down && (
          <motion.span
            key="top"
            className="flex items-center overflow-hidden"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SPRING}
          >
            <Tooltip content={t("wallet.history.toTop")}>
              <button type="button" className={capsule} aria-label={t("wallet.history.toTop")} onClick={toTop}>
                <ArrowUp className="size-4" />
              </button>
            </Tooltip>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border-strong" />
          </motion.span>
        )}
      </AnimatePresence>
      <Tooltip content={t("wallet.history.jumpDate")}>
        <span className="relative flex">
          <button
            type="button"
            className={capsule}
            aria-label={t("wallet.history.jumpDate")}
            onClick={() => {
              const el = input.current;
              if (!el) return;
              el.value = "";
              try {
                el.showPicker();
              } catch {
                el.focus();
              }
            }}
          >
            <CalendarDays className="size-4" />
          </button>
          {/* The system's date picker, opened by the button; the field itself never shows */}
          <input
            ref={input}
            type="date"
            max={max}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0"
            onChange={(e) => onDate(e.target.value)}
          />
        </span>
      </Tooltip>
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border-strong" />
      <Tooltip content={canExport ? t("wallet.history.export") : t("wallet.history.exportPartial")}>
        <span className="flex">
          <button
            type="button"
            className={`${capsule} whitespace-nowrap tabular-nums`}
            disabled={!canExport || exporting !== null}
            onClick={onExport}
          >
            {exporting !== null ? <ActivitySpinner size={14} /> : <Upload className="size-4" />}
            {exporting !== null ? t("wallet.history.exporting", { pct: exporting }) : t("wallet.history.exportShort")}
          </button>
        </span>
      </Tooltip>
    </div>
  );
}

type Suggestion = { address: string; name: string; own: boolean };

/**
 * HistorySearch takes what's typed and finds it in the history: a
 * transaction by its hash, a block by its number, or the transactions
 * with an address, or with a contact or one of the wallet's accounts
 * picked by name from the suggestions as it's typed.
 */
function HistorySearch({
  address,
  names,
  onWith,
  onBlock,
  onHash,
  onNoMatch,
}: {
  address: string;
  names: Record<string, string>;
  onWith: (address: string) => void;
  onBlock: (block: number) => void;
  onHash: (hash: string) => void;
  onNoMatch: () => void;
}) {
  const t = useT();
  const { info } = useWallet();
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const q = value.trim().toLowerCase();
  const typed = /^0x[0-9a-f]{64}$/.test(q)
    ? "hash"
    : isAddress(q)
      ? "address"
      : /^#?\d[\d,]*$/.test(q)
        ? "block"
        : "name";
  const suggestions = useMemo<Suggestion[]>(() => {
    if (typed !== "name" || !q) return [];
    const own = new Set((info?.accounts ?? []).map((a) => a.address.toLowerCase()));
    return Object.entries(names)
      .filter(([a, n]) => !sameAddress(a, address) && (n.toLowerCase().includes(q) || a.toLowerCase().includes(q)))
      .map(([a, n]) => ({ address: a, name: n, own: own.has(a.toLowerCase()) }))
      .sort((x, y) => Number(y.own) - Number(x.own) || x.name.localeCompare(y.name))
      .slice(0, 8);
  }, [typed, q, names, info, address]);
  const showing = open && suggestions.length > 0;
  const pos = usePopup(showing, setOpen, field, menu);
  useEffect(() => setActive(0), [q]);

  const done = () => {
    setValue("");
    setOpen(false);
  };
  const submit = () => {
    if (!q) return;
    if (typed === "hash") onHash(q);
    else if (typed === "address") onWith(value.trim());
    else if (typed === "block") onBlock(Number(q.replace(/[#,]/g, "")));
    else if (suggestions.length > 0) onWith(suggestions[Math.min(active, suggestions.length - 1)].address);
    else return onNoMatch();
    done();
  };

  return (
    <>
      <SearchField
        ref={field}
        onClear={() => setValue("")}
        clearLabel={t("wallet.history.clear")}
        placeholder={t("wallet.history.search")}
        aria-label={t("wallet.history.search")}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!menu.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (showing) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else setValue("");
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
            return;
          }
          if (!showing) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
          }
        }}
        role="combobox"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
      />
      {/* Over the window, so the section can't cut it */}
      {createPortal(
        <AnimatePresence>
          {showing && (
            <motion.div
              ref={menu}
              className={`menu no-drag fixed z-[150] flex flex-col p-1.5 ${pos?.up ? "origin-bottom" : "origin-top"}`}
              style={{
                left: pos?.x ?? 0,
                ...(pos?.up ? { bottom: pos.bottom } : { top: pos?.y ?? 0 }),
                width: pos?.width ?? field.current?.offsetWidth,
                visibility: pos ? "visible" : "hidden",
              }}
              {...POPUP}
              onMouseDown={(e) => e.preventDefault()}
            >
              <ul id={listId} role="listbox" className="flex max-h-72 flex-col gap-px overflow-y-auto">
                {suggestions.map((s, i) => (
                  <motion.li key={s.address} role="presentation" variants={POPUP_ROW}>
                    <button
                      id={`${listId}-${i}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === active}
                      data-active={i === active || undefined}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        onWith(s.address);
                        done();
                      }}
                      className="menu-item relative w-full gap-2.5 py-1.5"
                    >
                      <AddressAvatar address={s.address} size={24} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">{s.name}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {shortHex(s.address, 8, 6)}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {s.own ? t("wallet.history.ownAccount") : t("wallet.history.contact")}
                      </span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/**
 * ActivityRow is one transaction of the account's: what it was, with whom,
 * and for how much, opening to its details. One of the account's own still
 * waiting has the ways to speed it up or cancel it beside them.
 */
export function ActivityRow({
  a,
  opened,
  onToggle,
  details,
  head,
  now,
  onReplace,
  id,
  className = "",
}: {
  a: Activity;
  opened: boolean;
  onToggle: () => void;
  details: TxDetails | string | undefined;
  head: number;
  now: number;
  onReplace?: (kind: ReplaceKind) => void;
  id?: string;
  className?: string;
}) {
  const t = useT();
  const ago = useAgo();
  const label = useId();
  return (
    <motion.li id={id} variants={STAGGER.item} className={className}>
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
          <ActivityIcon kind={a.kind} pending={a.pending} cancel={a.cancel} failed={a.failed} />
        </span>
        <div id={label} className="pointer-events-none relative min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">
            {a.cancel ? t(a.pending ? "wallet.kind.cancelling" : "wallet.kind.cancelled") : t(`wallet.kind.${a.kind}`)}
            {a.failed && <Pill tone="critical">{t("wallet.tx.status.failed")}</Pill>}
          </div>
          <div className="truncate text-sm text-muted-foreground tabular-nums">
            {a.pending ? t("wallet.inPool") : t("wallet.inBlock", { block: formatInt(a.block) })}
            {/* A reward not yet spendable says from when it is */}
            {a.mined && (a.mined.maturesAt ?? 0) > head && (
              <>
                {" · "}
                {t("wallet.mined.maturesAt", { block: formatInt(a.mined.maturesAt ?? 0) })}
              </>
            )}
            {a.kind !== "self" && a.kind !== "mined" && (
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
          {/* A failed one moved nothing: its amount is struck through */}
          <div
            className={`font-semibold ${a.failed ? "text-muted-foreground line-through" : a.kind === "in" || a.kind === "mined" ? "text-good-ink" : ""}`}
          >
            {a.failed ? "" : a.kind === "in" || a.kind === "mined" ? "+" : a.kind === "out" ? "−" : ""}
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
            {a.mined ? (
              <MinedDetails m={a.mined} head={head} />
            ) : (
              <ActivityDetails d={details} head={head} cancel={a.cancel} />
            )}
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

/**
 * MinedDetails is an opened row of a block the account mined: when its
 * reward can be spent, and what it was made of.
 */
function MinedDetails({ m, head }: { m: HistoryTx; head: number }) {
  const t = useT();
  const { lang } = useLang();
  const maturesAt = m.maturesAt ?? m.block;
  const left = maturesAt - head;
  return (
    <div className="flex flex-col gap-3 bg-hover pr-4 pb-4 pl-[70px]">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone={left > 0 ? "info" : "good"} className="tabular-nums">
          {left <= 0
            ? t("wallet.mined.spendable")
            : left === 1
              ? t("wallet.mined.maturesInOne")
              : t("wallet.mined.maturesIn", { n: formatInt(left) })}
        </Pill>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {new Date(m.timestamp * 1000).toLocaleString(lang, { dateStyle: "medium", timeStyle: "medium" })}
        </span>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Facts>
          <Fact label={t("wallet.tx.block")}>{formatInt(m.block)}</Fact>
          <Fact label={t("wallet.tx.blockHash")}>
            <Hex value={m.blockHash} />
          </Fact>
          <Fact label={t("wallet.mined.spendableFrom")}>{formatInt(maturesAt)}</Fact>
        </Facts>
        <Facts>
          <Fact label={t("wallet.mined.reward")}>{formatLax(m.rewardWei ?? "0", 18)} LAX</Fact>
          <Fact label={t("wallet.mined.fees")}>{m.feesWei ? `${formatLax(m.feesWei, 18)} LAX` : "—"}</Fact>
        </Facts>
      </div>
    </div>
  );
}

/**
 * HistoryState says, beside the activity's title, how far the history
 * index has got while it's being built, or that it couldn't be opened.
 */
function HistoryState({
  view,
}: {
  view: { complete: boolean; indexing: boolean; indexedTo: number; headBlock: number };
}) {
  const t = useT();
  if (view.complete) return null;
  if (!view.indexing) {
    return (
      <Tooltip content={t("wallet.historyLatestOnlyDesc")}>
        <span>{t("wallet.historyLatestOnly")}</span>
      </Tooltip>
    );
  }
  return (
    <>
      <ActivitySpinner size={12} />
      {t("wallet.historyIndexing", { pct: indexedPct(view) })}
    </>
  );
}

/** indexedPct is how far the history index has got, as a whole percentage short of 100 until it's there. */
function indexedPct(view: { indexedTo: number; headBlock: number }): string {
  if (view.headBlock <= 0) return "0";
  return String(Math.min(99, Math.floor((view.indexedTo / view.headBlock) * 100)));
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

function ActivityIcon({
  kind,
  pending,
  cancel,
  failed,
}: {
  kind: Activity["kind"];
  pending: boolean;
  cancel: boolean;
  failed: boolean;
}) {
  return (
    <IconBadge
      icon={
        pending
          ? Clock
          : failed
            ? X
            : cancel
              ? Ban
              : kind === "mined"
                ? Pickaxe
                : kind === "in"
                  ? ArrowDownLeft
                  : ArrowUpRight
      }
      tone={pending ? "info" : failed ? "critical" : kind === "in" || kind === "mined" ? "good" : "neutral"}
    />
  );
}
