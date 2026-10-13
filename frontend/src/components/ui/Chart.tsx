import { useId, useMemo, useState } from "react";
import type { Sample } from "../../lib/live";
import { useAnimationsOff } from "../../lib/prefs";

const W = 600;

function scale(samples: Sample[], height: number, floorZero: boolean) {
  const values = samples.map((s) => s.v);
  const max = Math.max(...values);
  const min = floorZero ? 0 : Math.min(...values);
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 1;
  const top = max + pad;
  const bottom = floorZero ? 0 : min - pad;
  const t0 = samples[0].t;
  const span = Math.max(1, samples[samples.length - 1].t - t0);
  return {
    x: (t: number) => ((t - t0) / span) * W,
    y: (v: number) => 4 + (1 - (v - bottom) / (top - bottom)) * (height - 8),
    max,
    min,
  };
}

/**
 * AreaChart draws a live series as a line in the brand teal over a soft
 * gradient fill, sweeping in from the left when first shown. Hovering
 * reads off the nearest sample through `format`.
 */
export function AreaChart({
  samples,
  height = 120,
  format,
  floorZero = true,
  label,
}: {
  samples: Sample[];
  height?: number;
  format: (v: number) => string;
  floorZero?: boolean;
  label: string;
}) {
  const id = useId();
  const still = useAnimationsOff();
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (samples.length < 2) return null;
    const s = scale(samples, height, floorZero);
    const pts = samples.map((p) => [s.x(p.t), s.y(p.v)] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const area = `${line}L${W},${height}L0,${height}Z`;
    return { s, pts, line, area };
  }, [samples, height, floorZero]);

  if (!geom) {
    return (
      <div
        className="grid place-items-center rounded-sm border border-dashed border-border font-mono text-[11px] text-muted-foreground"
        style={{ height }}
      >
        …
      </div>
    );
  }

  const focus = hover ?? geom.pts.length - 1;
  const [fx, fy] = geom.pts[focus];

  return (
    // The sweep clips the whole chart, so the live dot arrives with its line
    <div className={`relative ${still ? "" : "chart-reveal"}`} style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={label}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          for (let i = 1; i < geom.pts.length; i++) {
            if (Math.abs(geom.pts[i][0] - x) < Math.abs(geom.pts[best][0] - x)) best = i;
          }
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-mark)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand-mark)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={height * f}
            y2={height * f}
            stroke="var(--border)"
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={geom.area} fill={`url(#fill-${id})`} />
        <path
          d={geom.line}
          fill="none"
          stroke="var(--brand-mark)"
          strokeWidth="1.75"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null && (
          <line
            x1={fx}
            x2={fx}
            y1="0"
            y2={height}
            stroke="var(--muted-foreground)"
            strokeOpacity="0.5"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* The dot is HTML so the stretched viewBox does not squash it */}
      <span
        className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-mark ring-4 ring-brand-muted"
        style={{ left: `${(fx / W) * 100}%`, top: fy }}
      />
      {hover !== null && (
        <span
          className="pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full rounded-sm border border-border bg-surface-elevated px-2 py-1 font-mono text-[11px] whitespace-nowrap tabular-nums shadow-lg"
          style={{ left: `${(fx / W) * 100}%` }}
        >
          {format(samples[hover].v)}
        </span>
      )}
      <span className="pointer-events-none absolute top-0 right-0 font-mono text-[10px] text-muted-foreground tabular-nums">
        {format(geom.s.max)}
      </span>
      {!floorZero && (
        <span className="pointer-events-none absolute right-0 bottom-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {format(geom.s.min)}
        </span>
      )}
    </div>
  );
}

/** Sparkline is a small trend line with no axes, for inside a tile. */
export function Sparkline({ samples, height = 32 }: { samples: Sample[]; height?: number }) {
  const still = useAnimationsOff();
  if (samples.length < 2) return <div style={{ height }} />;
  const s = scale(samples, height, false);
  const d = samples
    .map((p, i) => `${i ? "L" : "M"}${s.x(p.t).toFixed(1)},${s.y(p.v).toFixed(1)}`)
    .join("");
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${still ? "" : "chart-reveal"}`}
      style={{ height }}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="var(--brand-mark)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
