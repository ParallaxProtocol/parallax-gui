import type { ReactNode } from "react";

/**
 * SectionHeader opens a section of a page as on the status page: its
 * index in corner brackets, its title, and a ruled scale running out to
 * the row's end, with an optional readout or action at the far side.
 */
export function SectionHeader({
  index,
  title,
  aside,
  id,
}: {
  index: number;
  title: string;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="section-index font-mono text-[11px] text-brand tabular-nums">
        {String(index).padStart(2, "0")}
      </span>
      <h2 id={id} className="font-sans text-sm font-medium tracking-tight text-foreground">
        {title}
      </h2>
      <span aria-hidden className="section-rule min-w-8 flex-1 self-center" />
      {aside && <div className="shrink-0 text-xs text-muted-foreground">{aside}</div>}
    </div>
  );
}
