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
 * Segmented is a row of mutually exclusive choices; the selection's wash
 * springs from one option to the next.
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
    <div
      role="radiogroup"
      className={`inline-flex gap-1 rounded-md border border-border bg-background p-1 ${className}`}
    >
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
            className={`relative rounded-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm"
            } ${here ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {here && (
              <motion.span
                layoutId={`segment-${id}`}
                transition={SPRING}
                className="absolute inset-0 rounded-sm border border-border-strong bg-surface-elevated"
              >
                <span className="brand-gradient-mark absolute inset-x-2 -bottom-px h-px" />
              </motion.span>
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
