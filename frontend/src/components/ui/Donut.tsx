import type { ReactNode } from "react";
import { motion } from "motion/react";
import { SPRING } from "../../lib/motion";

export type DonutSegment = { value: number; color: string };

/**
 * Donut is a round chart of how a whole splits, as Apple draws them: each
 * segment an arc in its colour with rounded ends, in order, apart by a
 * small gap, over a faint track (all track while the whole is empty), and
 * what it counts written inside.
 */
export function Donut({
  segments,
  size = 112,
  stroke = 12,
  children,
}: {
  segments: DonutSegment[];
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((n, s) => n + Math.max(0, s.value), 0);
  const shown = segments.filter((s) => s.value > 0);
  // Room between arcs for their rounded ends and a gap, unless one arc is
  // the whole ring; an arc too short for its ends shows as a dot
  const gap = shown.length > 1 ? stroke + Math.min(4, c / 60) : 0;
  let start = 0;
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        {total > 0 &&
          shown.map((s, i) => {
            const len = (s.value / total) * c;
            const arc = Math.max(0.01, len - gap);
            const offset = -(start + (shown.length > 1 ? gap / 2 : 0));
            start += len;
            return (
              <motion.circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                initial={false}
                animate={{ strokeDasharray: `${arc} ${c - arc}`, strokeDashoffset: offset }}
                transition={SPRING}
              />
            );
          })}
      </svg>
      {children && <span className="absolute inset-0 grid place-items-center text-center">{children}</span>}
    </span>
  );
}
