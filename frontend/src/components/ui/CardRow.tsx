import { Children, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { STAGGER } from "../../lib/motion";

/** The ink each tone's symbol is drawn in, as a Notice's. */
const INK = { info: "text-info-ink", warn: "text-warn-ink", critical: "text-critical-ink" } as const;

/**
 * CardRows holds a GlowCard's CardRows, across the card's foot: out to its
 * edges and down to its bottom, past the card's padding. Nothing when it
 * holds none.
 */
export function CardRows({ className = "", children }: { className?: string; children: ReactNode }) {
  // Keyed by toArray, and without what was left out (false, null)
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;
  // Hidden while its rows render nothing (a device's status once it's ready)
  return <div className={`-mx-6 -mb-6 flex flex-col empty:hidden ${className}`}>{rows}</div>;
}

/**
 * CardRow is a row across a GlowCard's foot, as the "Finish setting up" row
 * atop a Mac's System Settings: its symbol in the tone's colour, the title
 * over a muted line (or the line alone), and at its end a chevron, the
 * whole row the button (`onClick`), or `action`, a flat capsule for what
 * is done in place, or nothing. Flat, under a hairline across the card, as
 * it sits on the card's glass. What the page has to say goes here, on the
 * card it is about, rather than in a notice of its own.
 */
export function CardRow({
  tone,
  icon: Icon,
  title,
  desc,
  detail,
  ...end
}: {
  tone: keyof typeof INK;
  icon: LucideIcon;
  title?: string;
  desc: ReactNode;
  /** What went wrong, as it was said: small, under the line, to copy into a report. */
  detail?: string | null;
} & ({ action?: ReactNode } | { label: string; onClick: () => void })) {
  const body = (
    <>
      <Icon className={`size-6 shrink-0 ${INK[tone]}`} strokeWidth={1.75} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <span className="font-medium">{title}</span>}
        <span className={title ? "text-sm text-muted-foreground" : ""}>{desc}</span>
        {detail && <span className="selectable mt-0.5 font-mono text-xs break-words text-faint">{detail}</span>}
      </span>
    </>
  );
  const row = "flex items-center gap-3.5 border-t border-border px-6 py-4 text-left";
  if (!("onClick" in end)) {
    return (
      <motion.div variants={STAGGER.item} className={row} role={tone === "critical" ? "alert" : "status"}>
        {body}
        {end.action}
      </motion.div>
    );
  }
  return (
    <motion.button
      type="button"
      variants={STAGGER.item}
      onClick={end.onClick}
      aria-label={end.label}
      className={`${row} transition-colors hover:bg-hover focus-visible:-outline-offset-2`}
    >
      {body}
      <ChevronRight className="size-4 shrink-0 text-faint" strokeWidth={2.5} />
    </motion.button>
  );
}
