import type { ReactNode } from "react";
import { ChevronRight, Loader2, type LucideIcon } from "lucide-react";

/**
 * LinkRows is a card of ways on, as a Mac's settings group of rows that
 * each open their own page: glass, a hairline between rows.
 */
export function LinkRows({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`glass flex w-full flex-col divide-y divide-border overflow-hidden text-left ${className}`}>
      {children}
    </div>
  );
}

/**
 * LinkRow is one way on in a LinkRows card: its symbol, its name and line,
 * and a chevron, or a spinner while it works.
 */
export function LinkRow({
  icon: Icon,
  title,
  desc,
  busy,
  disabled,
  onClick,
  autoFocus,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className="group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors enabled:hover:bg-[var(--glass-hover)] disabled:opacity-60"
    >
      <Icon className="size-5 shrink-0 text-brand" strokeWidth={1.75} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{desc}</span>
      </span>
      {busy ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-enabled:group-hover:translate-x-0.5" />
      )}
    </button>
  );
}
