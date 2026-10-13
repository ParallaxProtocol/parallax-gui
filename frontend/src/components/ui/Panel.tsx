import type { ElementType, ReactNode } from "react";

export type Tone = "warn" | "critical" | null;

const TONE: Record<"none" | "warn" | "critical", string> = {
  none: "border-border",
  warn: "border-warn/50",
  critical: "border-critical/50",
};

/**
 * Panel is the app's grouped surface, as in system settings: a rounded
 * box a step lighter than the window, on a hairline border. A panel a
 * warning is about takes the warning's colour on its border.
 */
export function Panel({
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
      className={`rounded-lg border bg-surface shadow-[var(--shadow-panel)] ${TONE[tone ?? "none"]} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Section is a titled block of a page: a small heading over its panels, with an optional aside. */
export function Section({
  title,
  aside,
  className = "",
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex flex-col gap-2 ${className}`}>
      <div className="flex min-h-6 items-center justify-between gap-4 px-1">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {aside && <div className="flex items-center gap-2 text-sm text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label is secondary text naming a value. */
export function Label({
  as: Tag = "span",
  className = "",
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <Tag className={`text-sm text-muted-foreground ${className}`}>{children}</Tag>;
}

/** Rows is a panel of rows divided by hairlines: a settings group, a property list. */
export function Rows({ as, className = "", children }: { as?: ElementType; className?: string; children: ReactNode }) {
  return (
    <Panel as={as} className={`flex flex-col divide-y divide-border ${className}`}>
      {children}
    </Panel>
  );
}

/** Row is one line of a Rows panel: what it is on the left, its control or value on the right. */
export function Row({
  title,
  desc,
  badge,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-8 px-4 py-2.5">
      <div className="min-w-0 max-w-xl">
        <div className="flex items-center gap-2">
          {title}
          {badge}
        </div>
        {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children !== undefined && <div className="flex min-w-0 shrink-0 items-center gap-1">{children}</div>}
    </div>
  );
}

/** Property is a read-only Row: a label and its value, the value selectable. */
export function Property({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-6 px-4 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`flex min-w-0 items-center justify-end gap-1 tabular-nums ${mono ? "font-mono text-sm" : ""}`}>
        {children}
      </dd>
    </div>
  );
}

/** StatStrip is a panel of figures side by side, divided by hairlines; equal widths unless `columns` says otherwise. */
export function StatStrip({ columns, children }: { columns?: string; children: ReactNode }) {
  return (
    <div
      className="grid auto-cols-fr grid-flow-col divide-x divide-border rounded-lg border border-border bg-surface shadow-[var(--shadow-panel)]"
      style={columns ? { gridTemplateColumns: columns } : undefined}
    >
      {children}
    </div>
  );
}

/** Stat is one figure of a StatStrip: its name, the value, and a line of detail. */
export function Stat({
  label,
  value,
  unit,
  detail,
  action,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="truncate">{label}</Label>
        {action}
      </div>
      <div className="truncate text-xl font-semibold tabular-nums">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
      </div>
      {detail && <div className="truncate text-sm text-muted-foreground tabular-nums">{detail}</div>}
    </div>
  );
}
