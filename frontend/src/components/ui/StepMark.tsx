import { AnimatePresence, motion } from "motion/react";
import { GLIDE } from "../../lib/motion";

export type StepState = "done" | "current" | "todo" | "skipped";

/**
 * StepMark is a checklist item's state: an empty ring to do, a disc
 * painted in the accent for the step at hand, and once done the same
 * disc with a check drawing itself in. A step passed without being done
 * is a dashed ring with a dash in it, in grey.
 */
export function StepMark({ state, size = 20 }: { state: StepState; size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <motion.span
        className={`absolute inset-0 rounded-full border ${state === "skipped" ? "border-dashed" : ""}`}
        initial={false}
        animate={{
          borderColor: state === "todo" || state === "skipped" ? "var(--border-strong)" : "var(--brand-mark)",
          borderWidth: state === "current" ? 2 : 1,
        }}
        transition={GLIDE}
      />
      <AnimatePresence initial={false}>
        {state === "skipped" && (
          <motion.span
            key="skip"
            aria-hidden
            className="h-[1.5px] rounded-full bg-muted-foreground"
            style={{ width: size * 0.4 }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            exit={{ scaleX: 0 }}
            transition={GLIDE}
          />
        )}
        {(state === "done" || state === "current") && (
          <motion.span
            key="fill"
            className="absolute inset-0 grid place-items-center rounded-full bg-brand-fill text-brand-foreground"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={GLIDE}
          >
            {state === "done" && (
              <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" aria-hidden>
                <motion.path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.35, delay: 0.08, ease: [0.65, 0, 0.35, 1] }}
                />
              </svg>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
