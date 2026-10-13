import { useState } from "react";
import { motion } from "motion/react";
import { Loader2, Power } from "lucide-react";
import { api, BlockView, NodeStatus } from "../../lib/api";
import { formatInt, TARGET_BLOCK_SECONDS } from "../../lib/format";
import { nodeState, syncProgress, useLive } from "../../lib/live";
import { useNow } from "../../lib/useNow";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../../components/ui/Indicator";
import { Label, Plate } from "../../components/ui/Plate";
import { Rolling } from "../../components/ui/Rolling";
import { Meter, Notice } from "../../components/ui/bits";
import logo from "../../assets/logo.svg";

/**
 * BlockHero leads the Overview with whatever matters most right now: a
 * prompt to start the node while it is off, sync progress while it
 * catches up, and once synced the block clock, the best block and how
 * long the network has waited since against the 10 minute target.
 */
export default function BlockHero() {
  const { node, blocks } = useLive();
  const state = nodeState(node);

  return (
    <motion.div layout="position">
      {state === "stopped" && <Stopped />}
      {state === "syncing" && <Syncing node={node!} />}
      {state === "synced" && <Clock node={node!} head={blocks[0]} />}
    </motion.div>
  );
}

function Stopped() {
  const t = useT();
  const { refresh } = useLive();
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
    <Plate className="overflow-hidden p-8">
      {/* The mark, large and faint, turning slowly behind the prompt */}
      <motion.img
        src={logo}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-80 opacity-[0.07]"
        animate={{ rotate: 360 }}
        transition={{ duration: 120, repeat: Infinity, ease: "linear" }}
      />
      <div className="relative flex max-w-xl flex-col gap-4">
        <span className="flex items-center gap-2">
          <Indicator grade="off" />
          <Label>{t("node.state.stopped")}</Label>
        </span>
        <h2 className="text-4xl leading-tight">{t("overview.stopped.title")}</h2>
        <p className="text-muted-foreground">{t("overview.stopped.desc")}</p>
        <div className="mt-2">
          <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
            {busy ? t("node.starting") : t("node.start")}
          </button>
        </div>
        {err && <Notice tone="critical">{err}</Notice>}
      </div>
    </Plate>
  );
}

function Syncing({ node }: { node: NodeStatus }) {
  const t = useT();
  const progress = syncProgress(node);
  const searching = node.peers === 0;
  const left = Math.max(0, node.highestBlock - node.currentBlock);

  return (
    <Plate className="p-8">
      <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[auto_1fr] lg:items-end">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <Indicator grade="info" ping="always" />
            <Label>{searching ? t("overview.sync.searching") : t("node.state.syncing")}</Label>
          </span>
          <p className="font-sans text-6xl font-semibold tracking-tight tabular-nums">
            <Rolling value={`${(progress * 100).toFixed(1)}%`} />
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
            <span className="font-mono tabular-nums">
              #{formatInt(node.currentBlock)}
              <span className="text-muted-foreground">
                {" "}
                / {node.highestBlock > 0 ? `#${formatInt(node.highestBlock)}` : "—"}
              </span>
            </span>
            {!searching && left > 0 && (
              <span className="text-muted-foreground tabular-nums">
                {t("overview.sync.left", { n: formatInt(left) })}
              </span>
            )}
          </div>
          <Meter value={searching ? undefined : progress} active label={t("node.state.syncing")} />
          <p className="text-xs text-muted-foreground">
            {searching ? t("overview.sync.searchingDesc") : t("overview.sync.desc")}
          </p>
        </div>
      </div>
    </Plate>
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
    <Plate tone={g === "serious" || g === "critical" ? "warn" : null} className="p-8">
      <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[auto_1fr] lg:items-end">
        <div className="flex flex-col gap-2">
          <Label as="h2">{t("clock.bestBlock")}</Label>
          <p className="font-sans text-6xl font-semibold tracking-tight tabular-nums">
            <Rolling value={formatInt(node.currentBlock)} />
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <p className="text-lg">
              {foundAt ? (
                // The time sits wherever the language puts it in the sentence
                t("clock.foundAgo")
                  .split("{time}")
                  .map((part, i) =>
                    i === 0 ? (
                      part
                    ) : (
                      <span key={i}>
                        <span className="font-mono font-semibold tabular-nums">{clock(elapsed)}</span>
                        {part}
                      </span>
                    ),
                  )
              ) : (
                <span className="text-muted-foreground">…</span>
              )}
            </p>
            {foundAt > 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Indicator grade={g} ping cause={String(head?.number)} />
                <span className="tabular-nums">
                  {t(VERDICT[g])} · {t("clock.longer", { pct: longer < 1 ? "<1" : longer })}
                </span>
              </p>
            )}
          </div>

          <div
            className="relative h-1.5 rounded-full bg-muted"
            role="meter"
            aria-label={t("clock.meter")}
            aria-valuemin={0}
            aria-valuemax={TARGET_BLOCK_SECONDS * SPAN}
            aria-valuenow={Math.min(elapsed, TARGET_BLOCK_SECONDS * SPAN)}
          >
            {/* Keyed by the block, so a new one starts the fill afresh rather than draining it back */}
            <div
              key={foundAt}
              className="brand-gradient-mark absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-linear"
              style={{ width: `${fill * 100}%` }}
            />
            {ticks.slice(1, -1).map((tick) => (
              <div
                key={tick.at}
                className="absolute -inset-y-1 w-px bg-muted-foreground/60"
                style={{ left: `${tick.at * 100}%` }}
              />
            ))}
          </div>
          <div className="relative h-4 font-mono text-[11px] text-muted-foreground">
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
    </Plate>
  );
}
