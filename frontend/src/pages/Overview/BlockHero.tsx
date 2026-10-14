import { useState } from "react";
import { motion } from "motion/react";
import { Loader2, Power } from "lucide-react";
import { api, BlockView, NodeStatus } from "../../lib/api";
import { formatInt, TARGET_BLOCK_SECONDS } from "../../lib/format";
import { nodeState, syncProgress, useBlocks, useNode, useRefresh } from "../../lib/live";
import { STAGGER, useStagger } from "../../lib/motion";
import { useNow } from "../../lib/useNow";
import { useT } from "../../i18n";
import { BrandMark } from "../../components/ui/BrandMark";
import { Counter } from "../../components/ui/Counter";
import { Indicator, type Grade } from "../../components/ui/Indicator";
import { Label, Panel } from "../../components/ui/Panel";
import { Meter, Notice } from "../../components/ui/bits";
import BlockLane from "./BlockLane";

/**
 * BlockHero leads the Overview with the node's state: sync progress while
 * it catches up, and once synced the best block over the live block lane.
 * While the node is off the Overview shows <Stopped> instead.
 */
export default function BlockHero({ mine }: { mine?: string }) {
  const node = useNode();
  const blocks = useBlocks();
  const state = nodeState(node);

  if (state === "syncing") return <Syncing node={node!} />;
  if (state === "synced") return <Clock node={node!} blocks={blocks} mine={mine} />;
  return null;
}

/** The hero's surface: a panel lit by a soft accent glow from its top left corner. */
function HeroPanel({ tone, children }: { tone?: "warn" | null; children: React.ReactNode }) {
  return (
    <Panel tone={tone} className="relative overflow-hidden p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[30rem]"
        style={{ background: `radial-gradient(closest-side, ${tone ? "color-mix(in oklab, var(--warn) 18%, transparent)" : "var(--glow)"}, transparent 75%)` }}
      />
      <div className="relative">{children}</div>
    </Panel>
  );
}

/** Stopped is the Overview's empty state: what the node does, and the switch to start it. */
export function Stopped() {
  const t = useT();
  const stagger = useStagger();
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
    <motion.div
      className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      {...stagger}
    >
      <motion.div variants={STAGGER.item} className="mb-2">
        <BrandMark size={64} />
      </motion.div>
      <motion.div variants={STAGGER.item} className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-xl font-semibold">{t("overview.stopped.title")}</h2>
        <p className="text-muted-foreground">{t("overview.stopped.desc")}</p>
      </motion.div>
      <motion.div variants={STAGGER.item}>
        <button type="button" className="btn btn-primary btn-lg" onClick={start} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
          {busy ? t("node.starting") : t("node.start")}
        </button>
      </motion.div>
      {err && <Notice tone="critical" className="max-w-md text-left">{err}</Notice>}
    </motion.div>
  );
}

function Syncing({ node }: { node: NodeStatus }) {
  const t = useT();
  const progress = syncProgress(node);
  const searching = node.peers === 0;
  const left = Math.max(0, node.highestBlock - node.currentBlock);

  return (
    <HeroPanel>
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <Indicator grade="info" ping cause={searching ? "search" : "sync"} />
              <Label>{searching ? t("overview.sync.searching") : t("node.state.syncing")}</Label>
            </span>
            <span className="text-[30px] leading-9 font-semibold tracking-tight">
              <Counter value={progress * 100} format={(v) => `${v.toFixed(1)}%`} />
            </span>
          </div>
          <div className="flex flex-col items-end gap-1 text-sm text-muted-foreground tabular-nums">
            <span>
              <Counter value={node.currentBlock} format={(v) => formatInt(Math.round(v))} className="text-foreground" /> /{" "}
              {node.highestBlock > 0 ? formatInt(node.highestBlock) : "—"}
            </span>
            {!searching && left > 0 && <span>{t("overview.sync.left", { n: formatInt(left) })}</span>}
          </div>
        </div>
        <Meter value={progress} live thick label={t("node.state.syncing")} />
        <p className="text-sm text-muted-foreground">
          {searching ? t("overview.sync.searchingDesc") : t("overview.sync.desc")}
        </p>
      </div>
    </HeroPanel>
  );
}

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

function Clock({ node, blocks, mine }: { node: NodeStatus; blocks: BlockView[]; mine?: string }) {
  const t = useT();
  const now = useNow(1000);
  const head = blocks[0];
  const foundAt = head && head.number === node.currentBlock ? head.timestamp : 0;
  // Miners' clocks may run a little ahead of ours
  const elapsed = foundAt ? Math.max(0, Math.floor(now / 1000 - foundAt)) : 0;
  const g: Grade = foundAt ? grade(elapsed) : "off";
  // Intervals are exponential: the share of blocks that take longer than this
  const longer = Math.min(99, Math.round(Math.exp(-elapsed / TARGET_BLOCK_SECONDS) * 100));

  return (
    <HeroPanel tone={g === "serious" || g === "critical" ? "warn" : null}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div className="flex flex-col gap-0.5">
            <Label as="h2">{t("clock.bestBlock")}</Label>
            <span className="selectable text-[30px] leading-9 font-semibold tracking-tight">
              <Counter value={node.currentBlock} format={(v) => formatInt(Math.round(v))} />
            </span>
          </div>

          {foundAt > 0 && (
            <div className="flex flex-col items-end gap-0.5">
              <Label>{t("clock.sinceLast")}</Label>
              <span className="flex items-center gap-2.5">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
                  <Indicator grade={g} />
                  {t(VERDICT[g])} · {t("clock.longer", { pct: longer < 1 ? "<1" : longer })}
                </span>
                <span className="text-xl font-semibold tabular-nums">{clock(elapsed)}</span>
              </span>
            </div>
          )}
        </div>

        <BlockLane blocks={blocks} now={now} mine={mine} />
      </div>
    </HeroPanel>
  );
}
