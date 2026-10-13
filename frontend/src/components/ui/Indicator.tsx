export type Grade = "good" | "warn" | "serious" | "critical" | "info" | "off";

const COLOR: Record<Grade, string> = {
  good: "bg-good",
  warn: "bg-warn",
  serious: "bg-serious",
  critical: "bg-critical",
  info: "bg-info",
  off: "bg-transparent ring-1 ring-inset ring-off",
};

export const GRADE_TEXT: Record<Grade, string> = {
  good: "text-good-ink",
  warn: "text-warn-ink",
  serious: "text-serious-ink",
  critical: "text-critical-ink",
  info: "text-info-ink",
  off: "text-muted-foreground",
};

/**
 * Indicator is the coloured status dot beside a value. With `ping`, a ring
 * spreads from it to draw the eye: three times and rests, or for as long
 * as the state lasts when `ping` is "always". A new `cause` starts the
 * ring again, so a change of state draws the eye anew.
 */
export function Indicator({
  grade,
  ping,
  cause,
  label,
  className = "",
}: {
  grade: Grade;
  ping?: boolean | "always";
  cause?: string;
  /** Announced to screen readers; leave out when adjacent text says it. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-flex size-2 shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ping && grade !== "off" && (
        <span
          key={cause}
          className={`absolute inline-flex size-full rounded-full opacity-60 motion-reduce:hidden ${
            ping === "always" ? "animate-ping" : "animate-ping-few"
          } ${COLOR[grade]}`}
        />
      )}
      <span className={`relative inline-block size-2 rounded-full ${COLOR[grade]}`} />
    </span>
  );
}
