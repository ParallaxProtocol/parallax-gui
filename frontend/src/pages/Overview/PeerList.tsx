import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  ShieldCheck,
  ShieldOff,
  Unplug,
} from "lucide-react";
import { api, BanEntry, PeerView } from "../../lib/api";
import { parseClient } from "../../lib/client";
import { formatInt } from "../../lib/format";
import { SPRING } from "../../lib/motion";
import { useNow } from "../../lib/useNow";
import { useLang, useT } from "../../i18n";
import { Segmented } from "../../components/ui/Segmented";
import { Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { Select } from "../../components/ui/Select";
import { Pill } from "../../components/ui/Pill";
import { IconBadge } from "../../components/ui/IconBadge";
import { Detail, DetailCard, Unfold } from "./parts";

type Filter = "all" | "in" | "out" | "blocked";

/** The block lengths on offer, in seconds; the last is as good as permanent. */
const DURATIONS = [
  { key: "hour", seconds: 3600 },
  { key: "day", seconds: 86_400 },
  { key: "week", seconds: 7 * 86_400 },
  { key: "month", seconds: 30 * 86_400 },
  { key: "forever", seconds: 100 * 365 * 86_400 },
] as const;
const DEFAULT_DURATION = 86_400;
/** Bans ending further out than this read as permanent. */
const FOREVER = 50 * 365 * 86_400;

/**
 * PeerList lists the node's connected peers inside the Overview's peers
 * card, filtered by direction, and manages them: add a peer by enode URL
 * or ip:port, and on each peer disconnect, trust (enode peers only) or
 * block for a while. The Blocked filter shows the ban list, where bans
 * are lifted or added by hand. The Overview polls the peers, faster while
 * the list is open; the ban list polls here, while it is shown.
 */
export default function PeerList({
  peers,
  error,
  onChanged,
}: {
  peers: PeerView[];
  error: string | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [bans, setBans] = useState<BanEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loadBans = useCallback(() => {
    api
      .banned()
      .then(setBans)
      .catch(() => {});
  }, []);

  // The ban list's count shows on its filter, so it loads with the list
  useEffect(() => {
    loadBans();
    const id = setInterval(loadBans, 5000);
    return () => clearInterval(id);
  }, [loadBans]);

  /** Runs one action: one at a time, its error shown, its success confirmed briefly. */
  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key);
    setActionErr(null);
    try {
      await action();
      setDone(success);
      window.setTimeout(() => setDone((d) => (d === success ? null : d)), 2500);
      onChanged();
      loadBans();
      return true;
    } catch (e: any) {
      setActionErr(e?.message || String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const shown = peers.filter((p) => (filter === "in" ? p.inbound : filter === "out" ? !p.inbound : true));

  return (
    <div className="border-t border-border">
      <div className="flex items-center gap-3 px-5 py-3">
        <Segmented
          size="sm"
          value={filter}
          onChange={(f) => {
            // A message belongs to where it happened
            setFilter(f);
            setActionErr(null);
          }}
          options={[
            { value: "all", label: t("peers.filter.all") },
            { value: "in", label: t("peers.filter.in") },
            { value: "out", label: t("peers.filter.out") },
            {
              value: "blocked",
              label: bans?.length ? t("peers.filter.blockedN", { n: bans.length }) : t("peers.filter.blocked"),
            },
          ]}
        />
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {filter !== "blocked" && t("peers.showing", { n: shown.length, total: peers.length })}
        </span>
        {filter !== "blocked" && (
          <button
            type="button"
            className="btn btn-tinted btn-sm"
            onClick={() => {
              setAdding((a) => !a);
              setActionErr(null);
            }}
            aria-expanded={adding}
          >
            <Plus className="size-3.5" />
            {t("peers.add")}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {adding && filter !== "blocked" && (
          <Unfold key="add">
            <AddPeer
              busy={busy === "add"}
              onCancel={() => {
                setAdding(false);
                setActionErr(null);
              }}
              onAdd={async (target) => {
                if (await run("add", () => api.addPeer(target), t("peers.done.added"))) setAdding(false);
              }}
            />
          </Unfold>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {(error || actionErr) && (
          <Unfold key="err">
            <Notice tone="critical" className="mx-5 mb-3">
              {actionErr || error}
            </Notice>
          </Unfold>
        )}
        {done && !actionErr && (
          <Unfold key="done">
            <p className="mx-5 mb-3 flex items-center gap-1.5 text-sm text-good-ink">
              <Check className="size-3.5" />
              {done}
            </p>
          </Unfold>
        )}
      </AnimatePresence>

      {filter === "blocked" ? (
        <Blocked bans={bans} busy={busy} run={run} />
      ) : shown.length === 0 ? (
        <p className="border-t border-border py-12 text-center text-muted-foreground">{t("peers.empty")}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {/* Column heads over the rows' grid */}
          <li className={`grid ${ROW} gap-3 px-5 pt-2.5 pb-2 text-xs font-medium text-muted-foreground`} aria-hidden>
            <span className="col-start-3">{t("peers.col.client")}</span>
            <span>{t("peers.col.address")}</span>
            <span className="text-right">{t("peers.col.latency")}</span>
          </li>
          <AnimatePresence initial={false}>
            {shown.map((p) => (
              <PeerRow
                key={p.fullId}
                peer={p}
                open={expanded === p.fullId}
                onToggle={() => setExpanded((e) => (e === p.fullId ? null : p.fullId))}
                busy={busy}
                run={run}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

/** The peer rows' columns: chevron, direction, client, address, latency. */
const ROW = "grid-cols-[14px_32px_minmax(0,1.5fr)_minmax(0,1fr)_76px]";

/** Latency shows a peer's best round trip, its dot coloured by how quick it is. */
function Latency({ ms }: { ms?: number }) {
  if (!ms) return <span className="text-right text-sm text-muted-foreground">—</span>;
  const tone = ms < 100 ? "bg-good" : ms < 300 ? "bg-warn" : "bg-serious";
  return (
    <span className="flex items-center justify-end gap-1.5 text-sm tabular-nums">
      <span className={`size-1.5 rounded-full ${tone}`} aria-hidden />
      {ms.toFixed(0)} ms
    </span>
  );
}

type Run = (key: string, action: () => Promise<void>, success: string) => Promise<boolean>;

/** The address to act on a peer by: its enode URL where it has one, else its ip:port. */
function target(p: PeerView): string {
  return p.enode || p.address || p.remoteAddr;
}

function PeerRow({
  peer: p,
  open,
  onToggle,
  busy,
  run,
}: {
  peer: PeerView;
  open: boolean;
  onToggle: () => void;
  busy: string | null;
  run: Run;
}) {
  const t = useT();
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const id = p.fullId;
  const client = parseClient(p.name);

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={SPRING}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`grid w-full ${ROW} items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-hover ${open ? "bg-hover" : ""}`}
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <Tooltip
          content={
            <>
              <span className="font-medium">{p.inbound ? t("peers.filter.in") : t("peers.filter.out")}</span>
              <span className="text-muted-foreground">
                {" "}
                · {p.inbound ? t("peers.tooltip.in") : t("peers.tooltip.out")}
              </span>
            </>
          }
        >
          <IconBadge
            icon={p.inbound ? ArrowDownLeft : ArrowUpRight}
            tone={p.inbound ? "warn" : "brand"}
            size="sm"
            aria-label={p.inbound ? t("peers.filter.in") : t("peers.filter.out")}
            role="img"
          />
        </Tooltip>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <Tooltip content={p.name} mono>
              <span className="truncate font-medium">
                {[client.name, client.version].filter(Boolean).join(" ") || t("peers.unknown")}
              </span>
            </Tooltip>
            {p.trusted && <Pill tone="brand">{t("peers.trusted")}</Pill>}
            {p.static && <Pill>{t("peers.static")}</Pill>}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {[[client.os, client.arch].filter(Boolean).join(" "), client.identity].filter(Boolean).join(" · ") ||
              "\u00a0"}
          </span>
        </span>
        <Tooltip content={p.remoteAddr} mono overflowOnly>
          <span className="truncate font-mono text-sm text-muted-foreground">{p.remoteAddr}</span>
        </Tooltip>
        <Latency ms={p.minPingMs} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <Unfold>
            <DetailCard>
              <dl className="space-y-2.5">
                {/* The client's own string, which the row above summarises */}
                <Detail label={t("overview.client")} value={p.name} wrap />
                <Detail label={t("peers.fullId")} value={p.fullId} copy />
                {/* v2 nodes have no enode URL: leave the row out rather than show a dash */}
                {p.enode && <Detail label={t("peers.enode")} value={p.enode} wrap copy />}
                <Detail label={t("peers.remoteAddr")} value={p.remoteAddr} />
                <Detail label={t("peers.localAddr")} value={p.localAddr} />
                <Detail label={t("peers.network")} value={p.network || "—"} />
                <Detail label={t("peers.minPing")} value={p.minPingMs ? `${p.minPingMs.toFixed(1)} ms` : "—"} />
                <div className="grid grid-cols-[120px_1fr_auto] items-center gap-3">
                  <dt className="text-sm text-muted-foreground">{t("peers.caps")}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {p.caps.length > 0 ? (
                      p.caps.map((c) => (
                        <Pill key={c} className="font-mono">
                          {c}
                        </Pill>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("peers.none")}</span>
                    )}
                  </dd>
                  <span />
                </div>
              </dl>

              {/* What can be done about this peer */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Action
                  busy={busy === `disconnect:${id}`}
                  disabled={!!busy}
                  icon={<Unplug className="size-3.5" />}
                  onClick={() =>
                    run(`disconnect:${id}`, () => api.disconnectPeer(target(p)), t("peers.done.disconnected"))
                  }
                >
                  {t("peers.disconnect")}
                </Action>
                {p.enode && (
                  <Action
                    busy={busy === `trust:${id}`}
                    disabled={!!busy}
                    icon={p.trusted ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                    onClick={() =>
                      run(
                        `trust:${id}`,
                        () => api.setPeerTrusted(p.enode, !p.trusted),
                        p.trusted ? t("peers.done.untrusted") : t("peers.done.trusted"),
                      )
                    }
                    title={t("peers.trustHint")}
                  >
                    {p.trusted ? t("peers.untrust") : t("peers.trust")}
                  </Action>
                )}
                <span className="flex-1" />
                <DurationSelect value={duration} onChange={setDuration} />
                <Action
                  danger
                  busy={busy === `ban:${id}`}
                  disabled={!!busy}
                  icon={<Ban className="size-3.5" />}
                  onClick={() => run(`ban:${id}`, () => api.banPeer(p.remoteAddr, duration), t("peers.done.blocked"))}
                  title={t("peers.blockHint")}
                >
                  {t("peers.block")}
                </Action>
              </div>
            </DetailCard>
          </Unfold>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** AddPeer is the form for connecting to a peer by enode URL or ip:port. */
function AddPeer({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (target: string) => void; onCancel: () => void }) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <form
      className="flex flex-col gap-1.5 px-5 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAdd(value.trim());
      }}
    >
      <div className="flex gap-2">
        <input
          className="input font-mono"
          placeholder={t("peers.addPlaceholder")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          spellCheck={false}
          autoFocus
          aria-label={t("peers.add")}
        />
        <button type="button" className="btn btn-tinted" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {t("peers.addCta")}
        </button>
      </div>
      <p className="text-sm text-muted-foreground">{t("peers.addHint")}</p>
    </form>
  );
}

/**
 * Blocked is the ban list: each ban with when it ends and a way to lift
 * it, a form to block an address or subnet by hand, and lifting them all.
 */
function Blocked({ bans, busy, run }: { bans: BanEntry[] | null; busy: string | null; run: Run }) {
  const t = useT();
  const { lang } = useLang();
  const now = useNow(30_000) / 1000;
  const [value, setValue] = useState("");
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [confirmClear, setConfirmClear] = useState(false);

  const until = (b: BanEntry) =>
    b.bannedUntil - now > FOREVER
      ? t("peers.ban.forever")
      : t("peers.ban.until", {
          date: new Date(b.bannedUntil * 1000).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }),
        });

  return (
    <div className="border-t border-border">
      <form
        className="flex items-center gap-2 px-5 py-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run("ban:manual", () => api.banPeer(value.trim(), duration), t("peers.done.blocked"))) setValue("");
        }}
      >
        <input
          className="input max-w-sm flex-1 font-mono"
          placeholder={t("peers.ban.placeholder")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          aria-label={t("peers.ban.placeholder")}
        />
        <DurationSelect value={duration} onChange={setDuration} />
        <Action
          danger
          busy={busy === "ban:manual"}
          disabled={!!busy || !value.trim()}
          icon={<Ban className="size-3.5" />}
          submit
        >
          {t("peers.block")}
        </Action>
        <span className="flex-1" />
        {!!bans?.length && (
          <button
            type="button"
            className={`btn btn-sm ${confirmClear ? "btn-danger" : "btn-tinted"}`}
            disabled={!!busy}
            onClick={async () => {
              if (!confirmClear) {
                setConfirmClear(true);
                window.setTimeout(() => setConfirmClear(false), 4000);
                return;
              }
              setConfirmClear(false);
              await run("ban:clear", () => api.clearBanned(), t("peers.done.cleared"));
            }}
          >
            {confirmClear ? t("peers.ban.clearConfirm") : t("peers.ban.clear")}
          </button>
        )}
      </form>

      {bans === null ? (
        <p className="border-t border-border py-12 text-center text-muted-foreground">…</p>
      ) : bans.length === 0 ? (
        <p className="border-t border-border py-12 text-center text-muted-foreground">{t("peers.ban.empty")}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          <AnimatePresence initial={false}>
            {bans.map((b) => (
              <motion.li
                key={b.subnet}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={SPRING}
                className="flex items-center gap-3 px-5 py-3"
              >
                <IconBadge icon={Ban} tone="critical" size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm">{b.subnet}</span>
                  <span className="block text-xs text-muted-foreground">{until(b)}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-tinted btn-sm"
                  disabled={!!busy}
                  onClick={() => run(`unban:${b.subnet}`, () => api.unbanPeer(b.subnet), t("peers.done.unblocked"))}
                >
                  {busy === `unban:${b.subnet}` && <Loader2 className="size-3 animate-spin" />}
                  {t("peers.unblock")}
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {bans && bans.length > 0 && (
        <p className="border-t border-border px-5 py-2.5 text-sm text-muted-foreground">
          {t("peers.ban.count", { n: formatInt(bans.length) })}
        </p>
      )}
    </div>
  );
}

function DurationSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT();
  return (
    <Select<number>
      size="sm"
      value={value}
      onChange={onChange}
      aria-label={t("peers.ban.duration")}
      options={DURATIONS.map((d) => ({ value: d.seconds, label: t(`peers.ban.for.${d.key}`) }))}
    />
  );
}

function Action({
  busy,
  disabled,
  danger,
  icon,
  onClick,
  title,
  submit,
  children,
}: {
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  icon: ReactNode;
  onClick?: () => void;
  title?: string;
  submit?: boolean;
  children: ReactNode;
}) {
  const button = (
    <button
      type={submit ? "submit" : "button"}
      className={`btn btn-tinted btn-sm ${danger ? "text-critical-ink" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
  return title ? <Tooltip content={title}>{button}</Tooltip> : button;
}
