import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BlockView } from "../../lib/api";
import { formatInt, sameAddress, TARGET_BLOCK_SECONDS } from "../../lib/format";
import { SPRING } from "../../lib/motion";
import { useAgo, useT } from "../../i18n";

/** How much time the lane spans, right edge "now" to left edge. */
const SPAN = 2 * 3600;
const LANE = 56;

/**
 * BlockLane draws the recent chain on a time axis: each block a bar at the
 * moment it was found, as tall as it was full, drifting left as time
 * passes; the wait since the last block a band growing towards "now",
 * against a tick at the 10 minute target. A new block rises into place
 * and the band starts over.
 *
 * Positions step once a second with `now`; a one-second linear transition
 * on `left` turns the steps into a continuous drift.
 */
export default function BlockLane({ blocks, now, mine }: { blocks: BlockView[]; now: number; mine?: string }) {
  const t = useT();
  const ago = useAgo();
  const [hover, setHover] = useState<number | null>(null);
  const nowS = now / 1000;
  const x = (ts: number) => (1 - (nowS - ts) / SPAN) * 100;

  const head = blocks[0];
  const shown = blocks.filter((b) => x(b.timestamp) > 0);
  const lastX = head ? Math.min(100, x(head.timestamp)) : 100;
  const targetX = head ? x(head.timestamp + TARGET_BLOCK_SECONDS) : 100;
  const late = head ? nowS - head.timestamp > TARGET_BLOCK_SECONDS : false;
  const hovered = shown.find((b) => b.number === hover);

  return (
    <div>
      <div className="relative" style={{ height: LANE }} onMouseLeave={() => setHover(null)}>
        {/* The baseline, with a tick every ten minutes */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1 border-b border-border-strong opacity-70"
          style={{ backgroundImage: `repeating-linear-gradient(to left, var(--faint) 0 1px, transparent 1px ${100 / 12}%)` }}
        />

        {/* The wait for the next block: a band from the last block to now */}
        {head && (
          <div
            aria-hidden
            className="absolute bottom-0 h-1.5 overflow-hidden rounded-full"
            style={{
              left: `${lastX}%`,
              right: 0,
              transition: "left 1s linear",
              background: late
                ? "linear-gradient(90deg, color-mix(in oklab, var(--warn) 25%, transparent), color-mix(in oklab, var(--warn) 55%, transparent))"
                : "linear-gradient(90deg, var(--brand-muted), color-mix(in oklab, var(--brand-mark) 55%, transparent))",
            }}
          >
            <div className="shimmer absolute inset-0 opacity-40" />
          </div>
        )}

        {/* The target: ten minutes after the last block */}
        {head && targetX < 100 && (
          <div
            aria-hidden
            className="absolute bottom-0 h-full w-px"
            style={{
              left: `${targetX}%`,
              transition: "left 1s linear",
              backgroundImage: "linear-gradient(to top, var(--faint) 50%, transparent 50%)",
              backgroundSize: "1px 4px",
            }}
          >
            {/* On whichever side has room: past the lane's middle it reads
                leftwards, or near "now" it would run off the panel's edge */}
            <span
              className={`absolute -top-0.5 text-xs whitespace-nowrap text-muted-foreground ${
                targetX > 50 ? "right-1.5" : "left-1.5"
              }`}
            >
              {t("clock.target")}
            </span>
          </div>
        )}

        {/* Now: the lane's leading edge */}
        <div aria-hidden className="absolute right-0 bottom-0 h-full w-px bg-gradient-to-t from-brand-mark/70 to-transparent" />

        <AnimatePresence initial={false}>
          {shown.map((b, i) => {
            const full = b.gasLimit > 0 ? b.gasUsed / b.gasLimit : 0;
            const h = 14 + full * (LANE - 22);
            const ours = sameAddress(b.coinbase, mine);
            return (
              <motion.button
                type="button"
                key={b.number}
                aria-label={`${t("blocks.block")} ${formatInt(b.number)}`}
                onMouseEnter={() => setHover(b.number)}
                onFocus={() => setHover(b.number)}
                onBlur={() => setHover(null)}
                className="absolute bottom-0 w-2.5 -translate-x-1/2 origin-bottom"
                style={{ left: `${x(b.timestamp)}%`, height: h, transition: "left 1s linear" }}
                initial={{ scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={SPRING}
              >
                <span
                  className={`absolute inset-0 rounded-[3px] transition-[filter] duration-150 ${hover === b.number ? "brightness-125" : ""}`}
                  style={{
                    background: ours
                      ? "linear-gradient(to top, #0080ff, #00ff80)"
                      : "linear-gradient(to top, color-mix(in oklab, var(--brand-mark) 55%, transparent), var(--brand-mark))",
                    boxShadow: i === 0 ? "0 0 12px var(--glow)" : undefined,
                  }}
                />
                {i === 0 && (
                  <span aria-hidden className="halo absolute -inset-0.5 rounded-[4px] border border-brand-mark" />
                )}
              </motion.button>
            );
          })}
        </AnimatePresence>

        {/* What the hovered block was */}
        <AnimatePresence>
          {hovered && (
            <motion.div
              key="tip"
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-border-strong bg-surface-raised px-2.5 py-1.5 text-sm whitespace-nowrap shadow-[var(--shadow-popover)]"
              style={{ left: `clamp(60px, ${x(hovered.timestamp)}%, calc(100% - 60px))`, bottom: LANE + 6 }}
              initial={{ opacity: 0, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ type: "spring", bounce: 0, visualDuration: 0.2 }}
            >
              <div className="font-semibold tabular-nums">
                {t("blocks.block")} {formatInt(hovered.number)}
              </div>
              <div className="text-muted-foreground tabular-nums">
                {ago(hovered.timestamp, now)} · {t("lane.txs", { n: hovered.txCount })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{t("lane.hoursAgo", { n: 2 })}</span>
        <span>{t("lane.hoursAgo", { n: 1 })}</span>
        <span>{t("lane.now")}</span>
      </div>
    </div>
  );
}
