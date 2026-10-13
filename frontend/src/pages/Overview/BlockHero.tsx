import { useState } from "react";
import { Loader2, Power } from "lucide-react";
import { api, BlockView, NodeStatus } from "../../lib/api";
import { formatInt, TARGET_BLOCK_SECONDS } from "../../lib/format";
import { nodeState, syncProgress, useBlocks, useNode, useRefresh } from "../../lib/live";
import { useNow } from "../../lib/useNow";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../../components/ui/Indicator";
import { Label, Panel } from "../../components/ui/Panel";
import { Fill, Meter, Notice } from "../../components/ui/bits";
import logo from "../../assets/logo.svg";

/**
 * BlockHero leads the Overview with the node's state: sync progress while
 * it catches up, and once synced the best block and how long the network
 * has waited since against the 10 minute target. While the node is off
 * the Overview shows <Stopped> instead.
 */
export default function BlockHero() {
  const node = useNode();
  const blocks = useBlocks();
  const state = nodeState(node);

  if (state === "syncing") return <Syncing node={node!} />;
  if (state === "synced") return <Clock node={node!} head={blocks[0]} />;
  return null;
}

/** Stopped is the Overview's empty state: what the node does, and the switch to start it. */
export function Stopped() {
  const t = useT();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.startNode();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <img src={logo} alt="" className="size-14 opacity-90" />
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-xl font-semibold">{t("overview.stopped.title")}</h2>
        <p className="text-muted-foreground">{t("overview.stopped.desc")}</p>
      </div>
      <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
        {busy ? t("node.starting") : t("node.start")}
      </button>
      {err && <Notice tone="critical" className="max-w-md text-left">{err}</Notice>}
    </div>
  );
}

function Syncing({ node }: { node: NodeStatus }) {
  const t = useT();
  const progress = syncProgress(node);
  const searching = node.peers === 0;
  const left = Math.max(0, node.highestBlock - node.currentBlock);

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <Indicator grade="info" ping cause={searching ? "search" : "sync"} />
            <Label>{searching ? t("overview.sync.searching") : t("node.state.syncing")}</Label>
          </span>
          <span className="text-2xl font-semibold tabular-nums">{(progress * 100).toFixed(1)}%</span>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm text-muted-foreground tabular-nums">
          <span>
            <span className="text-foreground">{formatInt(node.currentBlock)}</span> /{" "}
            {node.highestBlock > 0 ? formatInt(node.highestBlock) : "—"}
          </span>
          {!searching && left > 0 && <span>{t("overview.sync.left", { n: formatInt(left) })}</span>}
        </div>
      </div>
      <Meter value={progress} label={t("node.state.syncing")} />
      <p className="text-sm text-muted-foreground">
        {searching ? t("overview.sync.searchingDesc") : t("overview.sync.desc")}
      </p>
    </Panel>
  );
}

/** The span of the clock track, as a multiple of the target interval. */
const SPAN = 3;

function grade(elapsedS: number): Grade {
  if (elapsedS <= TARGET_BLOCK_SECONDS) return "good";
  if (elapsedS <= 3 * TARGET_BLOCK_SECONDS) return "warn";
  if (elapsedS <= 6 * TARGET_BLOCK_SECONDS) return "serious";
  return "critical";
}

const VERDICT: Record<Grade, string> = {
  good: "clock.onSchedule",
  warn: "clock.runningLong",
  serious: "clock.unusuallyLong",
  critical: "clock.veryLong",
  info: "",
  off: "",
};

/** mm:ss, or h:mm:ss past the hour: language-neutral, unlike unit words. */
function clock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function Clock({ node, head }: { node: NodeStatus; head?: BlockView }) {
  const t = useT();
  const now = useNow(1000);
  const foundAt = head && head.number === node.currentBlock ? head.timestamp : 0;
  // Miners' clocks may run a little ahead of ours
  const elapsed = foundAt ? Math.max(0, Math.floor(now / 1000 - foundAt)) : 0;
  const g: Grade = foundAt ? grade(elapsed) : "off";
  const fill = Math.min(1, elapsed / (TARGET_BLOCK_SECONDS * SPAN));
  // Intervals are exponential: the share of blocks that take longer than this
  const longer = Math.min(99, Math.round(Math.exp(-elapsed / TARGET_BLOCK_SECONDS) * 100));
  const ticks = [
    { at: 0, label: "0" },
    { at: 1 / SPAN, label: t("clock.target") },
    { at: 2 / SPAN, label: "20 min" },
    { at: 1, label: "30 min" },
  ];

  return (
    <Panel tone={g === "serious" || g === "critical" ? "warn" : null} className="grid grid-cols-[auto_1fr] gap-x-8 p-4">
      <div className="flex flex-col gap-1 border-r border-border pr-8">
        <Label as="h2">{t("clock.bestBlock")}</Label>
        <span className="selectable text-2xl font-semibold tabular-nums">{formatInt(node.currentBlock)}</span>
      </div>

      <div className="flex min-w-0 flex-col justify-between gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span>
            {foundAt ? (
              // The time sits wherever the language puts it in the sentence
              t("clock.foundAgo")
                .split("{time}")
                .map((part, i) =>
                  i === 0 ? (
                    part
                  ) : (
                    <span key={i}>
                      <span className="font-semibold tabular-nums">{clock(elapsed)}</span>
                      {part}
                    </span>
                  ),
                )
            ) : (
              <span className="text-muted-foreground">…</span>
            )}
          </span>
          {foundAt > 0 && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
              <Indicator grade={g} />
              {t(VERDICT[g])} · {t("clock.longer", { pct: longer < 1 ? "<1" : longer })}
            </span>
          )}
        </div>

        <div>
          <div
            className="relative h-1 rounded-full bg-muted"
            role="meter"
            aria-label={t("clock.meter")}
            aria-valuemin={0}
            aria-valuemax={TARGET_BLOCK_SECONDS * SPAN}
            aria-valuenow={Math.min(elapsed, TARGET_BLOCK_SECONDS * SPAN)}
          >
            {/* Steps once a second with the clock, without a transition: the fill
                moves under a pixel a second, and a running transition would keep
                the window redrawing every frame. Keyed by the block, so a new one
                starts afresh rather than draining back */}
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <Fill key={foundAt} value={fill} className="bg-brand-mark" style={{ transition: "none" }} />
            </div>
            {ticks.slice(1, -1).map((tick) => (
              <div
                key={tick.at}
                className="absolute -inset-y-0.5 w-px bg-faint"
                style={{ left: `${tick.at * 100}%` }}
              />
            ))}
          </div>
          <div className="relative mt-1 h-3.5 text-xs text-muted-foreground">
            {ticks.map((tick) => (
              <span
                key={tick.at}
                className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
                style={{ left: `${tick.at * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
