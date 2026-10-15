const SPOKES = 12;
const PERIOD = 1; // seconds, as `.spoke` in styles.css

/**
 * ActivitySpinner is the macOS activity indicator: twelve fine rounded
 * spokes round a ring, each lit in turn and fading behind the light, in
 * the current colour. With `glow` it sits in a soft halo of that colour,
 * a faint bloom behind that breathes slowly and a glow along the spokes.
 * With animations off the spokes rest at the same fading steps, still
 * reading as a spinner, and the halo holds still.
 */
export function ActivitySpinner({
  size = 20,
  glow,
  label,
  className = "",
}: {
  size?: number;
  glow?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-grid place-items-center ${className}`}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {glow && (
        <span
          aria-hidden
          className="breathe pointer-events-none absolute -inset-1/5 rounded-full blur-md"
          style={{ background: "radial-gradient(closest-side, color-mix(in oklab, currentColor 22%, transparent), transparent)" }}
        />
      )}
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="relative"
        aria-hidden
        style={glow ? { filter: "drop-shadow(0 0 1.5px color-mix(in oklab, currentColor 40%, transparent))" } : undefined}
      >
        {Array.from({ length: SPOKES }, (_, i) => (
          <rect
            key={i}
            className="spoke"
            x={11.1}
            y={1.75}
            width={1.8}
            height={5.4}
            rx={0.9}
            fill="currentColor"
            transform={`rotate(${(i * 360) / SPOKES} 12 12)`}
            // The spoke ahead of the light is the faintest: delays lead the ring clockwise
            style={{ animationDelay: `${((i - SPOKES) * PERIOD) / SPOKES}s`, opacity: 0.15 + (0.85 * (i + 1)) / SPOKES }}
          />
        ))}
      </svg>
    </span>
  );
}
