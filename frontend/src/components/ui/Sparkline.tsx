/**
 * Sparkline is a small line chart of recent values, newest on the right,
 * scaled to the largest of them (or to floor, while they're all below it,
 * so a quiet stretch reads as quiet rather than as noise blown up), its
 * area faintly filled. It stretches to
 * its container's width; width only sets the drawing's proportions.
 */
export function Sparkline({
  values,
  color,
  floor = 0,
  width = 120,
  height = 32,
}: {
  values: number[];
  color: string;
  floor?: number;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span style={{ height }} className="block w-full" />;
  const max = Math.max(...values, floor) || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 1 - (v / max) * (height - 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      aria-hidden
    >
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.15} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
