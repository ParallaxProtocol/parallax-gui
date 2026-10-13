import { motion } from "motion/react";
import { SPRING } from "../../lib/motion";

/**
 * Toggle is a small switch whose knob springs across; on, its track takes
 * the logo gradient.
 *
 * The knob sits at left: 2px and moves by transform x rather than by
 * tweening `left`: motion can't interpolate calc() expressions.
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
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors duration-300 disabled:opacity-40 ${
        checked ? "brand-gradient border-transparent" : "border-border-strong bg-muted"
      }`}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-[18px] rounded-full bg-white shadow-md"
        animate={{ x: checked ? 20 : 0 }}
        transition={SPRING}
      />
    </button>
  );
}
