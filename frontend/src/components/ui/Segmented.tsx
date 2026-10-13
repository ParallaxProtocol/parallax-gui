import { useId } from "react";
import { motion } from "motion/react";
import { SPRING } from "../../lib/motion";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
};

/**
 * Segmented is a segmented control: mutually exclusive choices in one
 * well, the selected one raised, its thumb sliding from choice to choice.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className = "",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" className={`inline-flex rounded-md bg-muted p-0.5 ${className}`}>
      {options.map((o) => {
        const here = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={here}
            disabled={o.disabled}
            title={o.title}
            onClick={() => !o.disabled && onChange(o.value)}
            className={`relative min-w-16 rounded-[5px] font-medium transition-colors disabled:opacity-40 ${
              size === "sm" ? "h-5 px-2.5 text-sm" : "h-6 px-3"
            } ${here ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {here && (
              <motion.span
                layoutId={`segment-${id}`}
                layoutDependency={value}
                transition={SPRING}
                className="absolute inset-0 rounded-[5px] bg-surface-raised shadow-[var(--shadow-control)]"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
