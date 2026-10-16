import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING, STAGGER } from "../../lib/motion";
import { StepMark } from "../../components/ui/StepMark";
import { Tooltip } from "../../components/ui/Tooltip";

/**
 * Pieces of the pages made of steps: the progress beside the page's name
 * in the toolbar (Send, signing, broadcasting, messages), and a
 * hairline-divided part of a panel.
 */

/**
 * Steps is a flow's progress, small, in the toolbar: a glass pill of
 * marks, those behind ticked off and linked on to the next, the one at
 * hand painted. The step at hand alone opens out to its name;
 * the others tell theirs on hover.
 */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="glass flex h-9 items-center rounded-full px-1.5">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        const step = (
          <span className="flex h-7 items-center rounded-full px-1">
            <StepMark state={state} size={18} />
            <AnimatePresence initial={false}>
              {state === "current" && (
                <motion.span
                  key="name"
                  className="overflow-hidden font-medium whitespace-nowrap text-foreground"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: "auto", opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={SPRING}
                >
                  <span className="block pr-1.5 pl-2">{s}</span>
                </motion.span>
              )}
            </AnimatePresence>
            {state !== "current" && <span className="sr-only">{s}</span>}
          </span>
        );
        return (
          <motion.li
            key={s}
            layout="position"
            transition={SPRING}
            className="flex items-center"
            aria-current={state === "current" ? "step" : undefined}
          >
            {/* The link to the step before fills in once that step is done */}
            {i > 0 && (
              <span aria-hidden className="relative h-px w-3 overflow-hidden rounded-full bg-border-strong">
                <motion.span
                  className="absolute inset-0 origin-left bg-brand-mark"
                  initial={false}
                  animate={{ scaleX: i <= current ? 1 : 0 }}
                  transition={SPRING}
                />
              </span>
            )}
            {state === "current" ? step : <Tooltip content={s}>{step}</Tooltip>}
          </motion.li>
        );
      })}
    </ol>
  );
}

/** Part is one hairline-divided part of a step's panel. */
export function Part({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div variants={STAGGER.item} className={`flex flex-col gap-3 px-4 py-4 ${className}`}>
      {children}
    </motion.div>
  );
}
