import { motion } from "motion/react";
import { SPRING } from "../../lib/motion";

/**
 * Toggle is a switch, its track taking the accent when on and its knob
 * springing across. The knob moves by transform x rather than by tweening
 * `left`: motion can't interpolate calc() expressions.
 */
export default function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-[34px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 ${
        checked ? "bg-brand-fill" : "bg-border-strong"
      }`}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/30%)]"
        initial={false}
        animate={{ x: checked ? 14 : 0 }}
        transition={SPRING}
      />
    </button>
  );
}
