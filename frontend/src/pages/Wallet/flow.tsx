import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { PAGE, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useT } from "../../i18n";
import { Section } from "../../components/ui/Panel";
import { StepMark } from "../../components/ui/StepMark";
import { Tooltip } from "../../components/ui/Tooltip";
import { PAGE_NARROW } from "../../lib/layout";

/**
 * The layout of the pages made of steps, in the app's own terms: the
 * page's name is in the toolbar with its progress beside it, each step is
 * a section holding one panel, and the panel's parts are divided by
 * hairlines, its last one the step's actions, Back among them, as in
 * Settings.
 */

/** FlowPage is a page of steps: the step at hand as a section, changing in place. */
export function FlowPage({
  title,
  steps,
  current,
  children,
}: {
  title: string;
  steps: string[];
  current: number;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_NARROW}`}>
      {steps.length > 1 && (
        <ToolbarAccessory>
          <Steps steps={steps} current={current} />
        </ToolbarAccessory>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {/* Keyed by the step's name, not its index: the backup step ticks
            its progress on once saved without arriving all over again */}
        <motion.div key={title} {...PAGE}>
          <Section title={title}>{children}</Section>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

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

const PANEL =
  "flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-panel)]";

/**
 * StepPanel is a step's one panel, a form when it submits; its parts
 * arrive one after another.
 */
export function StepPanel({ onSubmit, children }: { onSubmit?: () => void; children: ReactNode }) {
  const stagger = useStagger();
  if (onSubmit) {
    return (
      <motion.form
        {...stagger}
        className={PANEL}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </motion.form>
    );
  }
  return (
    <motion.div {...stagger} className={PANEL}>
      {children}
    </motion.div>
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

/**
 * StepFooter is a step's last part: Back on the left, a line on what comes
 * next, and the step's own actions on the right.
 */
export function StepFooter({ onBack, hint, children }: { onBack?: () => void; hint?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <motion.div variants={STAGGER.item} className="flex flex-wrap items-center gap-3 bg-background/30 px-4 py-3">
      {onBack && (
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          {t("common.back")}
        </button>
      )}
      <div className="min-w-0 flex-1 text-right text-sm text-muted-foreground">{hint}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </motion.div>
  );
}
