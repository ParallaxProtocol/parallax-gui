import type { ReactNode } from "react";
import { Check } from "lucide-react";

/**
 * RadioMark is the mark of a choice among several: an empty ring, or
 * filled with a check once chosen. The one used by every list of choices.
 */
export function RadioMark({ selected, className = "" }: { selected: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid size-5 shrink-0 place-items-center rounded-full transition-colors ${
        selected ? "bg-brand-fill text-brand-foreground" : "border border-border-strong"
      } ${className}`}
    >
      {selected && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

/**
 * Choice is one option of a list of choices: a card of glass with its
 * mark, its name and, if it has one, a line on it or a value beside it.
 */
export function Choice({
  selected,
  onClick,
  title,
  desc,
  aside,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: ReactNode;
  desc?: ReactNode;
  aside?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="glass flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors"
    >
      <RadioMark selected={selected} />
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        {desc && <span className="text-sm text-muted-foreground">{desc}</span>}
      </span>
      {aside && <span className="shrink-0 text-sm text-muted-foreground">{aside}</span>}
    </button>
  );
}
