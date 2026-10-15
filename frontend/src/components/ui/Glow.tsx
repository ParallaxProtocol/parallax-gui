import { motion } from "motion/react";

/** The ease the welcome and lock screens move with: a quick start, a long settle. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Glow is a slow, soft drift of the brand's colours behind everything. */
export function Glow() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-1/2 size-[56rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
      style={{
        background:
          "radial-gradient(closest-side, color-mix(in oklab, var(--app-brand-mark) 20%, transparent) 0%, color-mix(in oklab, var(--app-brand-mark) 14%, transparent) 20%, color-mix(in oklab, #5b5bf0 9%, transparent) 42%, color-mix(in oklab, #5b5bf0 4%, transparent) 64%, color-mix(in oklab, #5b5bf0 1.5%, transparent) 82%, transparent 100%)",
      }}
      animate={{ scale: [1, 1.08, 1], rotate: [0, 12, 0] }}
      transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
