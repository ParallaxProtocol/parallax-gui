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
    <div role="radiogroup" className={`inline-flex rounded-md bg-segment-well p-0.5 shadow-[0_1px_2px_rgb(0_0_0/20%)_inset] ${className}`}>
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
            className={`relative min-w-16 rounded-[5px] font-medium transition-colors disabled:opacity-40 ${
              size === "sm" ? "h-5 px-2.5 text-sm" : "h-6 px-3"
            } ${here ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {here && (
              <motion.span
                layoutId={`segment-${id}`}
                layoutDependency={value}
                transition={SPRING}
                className="absolute inset-0 rounded-[5px] bg-segment-thumb shadow-[var(--shadow-segment)]"
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
