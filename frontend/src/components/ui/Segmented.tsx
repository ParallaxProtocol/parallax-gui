import { useId } from "react";
import { motion } from "motion/react";
import { SPRING } from "../../lib/motion";
import { Tooltip } from "./Tooltip";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
};

/**
 * Segmented is a segmented control, as Apple draws them: mutually exclusive
 * choices in one flat, rounded well, the selected one raised on a lit
 * thumb that slides from choice to choice.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  fill = false,
  className = "",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  /** Spread across its width, the choices sharing it equally. */
  fill?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      className={`${fill ? "flex" : "inline-flex"} rounded-[10px] bg-segment-well p-[3px] ${className}`}
    >
      {options.map((o) => {
        const here = o.value === value;
        const button = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={here}
            disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.value)}
            className={`relative ${fill ? "min-w-0 flex-1 truncate" : "min-w-20"} rounded-[7px] font-medium transition-colors disabled:opacity-40 ${
              size === "sm" ? "h-6 px-3 text-sm" : "h-7 px-4"
            } ${here ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {here && (
              <motion.span
                layoutId={`segment-${id}`}
                layoutDependency={value}
                transition={SPRING}
                className="absolute inset-0 rounded-[7px] bg-segment-thumb shadow-[var(--shadow-segment)]"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
        return o.title ? (
          <Tooltip key={o.value} content={o.title}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
