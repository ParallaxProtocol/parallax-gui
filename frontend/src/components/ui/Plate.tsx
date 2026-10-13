import type { ElementType, ReactNode } from "react";

export type Tone = "warn" | "critical" | "good" | null;

/**
 * A plate a warning is about takes the warning's colour: a tinted border,
 * a wash fading down, and the hover border and corner brackets in that
 * colour.
 */
const TONE: Record<"none" | "warn" | "critical" | "good", string> = {
  none: "border-border hover:border-foreground/20",
  warn: "border-warn/45 bg-linear-to-b from-warn/[0.09] to-transparent to-60% hover:border-warn/80 [--plate-accent:var(--warn)]",
  critical:
    "border-critical/45 bg-linear-to-b from-critical/[0.10] to-transparent to-60% hover:border-critical/80 [--plate-accent:var(--critical)]",
  good: "border-brand/40 bg-linear-to-b from-brand/[0.08] to-transparent to-60% hover:border-brand/70",
};

/**
 * Plate is the app's structural surface, as on the status page: square
 * corners, a hairline border, and brand corner brackets that surface on
 * hover.
 */
export function Plate({
  as: Tag = "div",
  className = "",
  tone = null,
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  tone?: Tone;
  id?: string;
  children: ReactNode;
  [attr: `aria-${string}`]: string | undefined;
}) {
  return (
    <Tag
      className={`group/plate relative rounded-md border bg-surface-elevated transition-colors duration-300 ${TONE[tone ?? "none"]} ${className}`}
      {...rest}
    >
      <span aria-hidden className="plate-brackets" />
      {children}
    </Tag>
  );
}

/** Label is the small heading: mono, uppercase, widely tracked. */
export function Label({
  as: Tag = "span",
  className = "",
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={`font-mono text-[11px] tracking-[0.15em] text-muted-foreground uppercase ${className}`}>
      {children}
    </Tag>
  );
}
