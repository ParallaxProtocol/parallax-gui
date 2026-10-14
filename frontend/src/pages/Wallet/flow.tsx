import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { PAGE, STAGGER, useStagger } from "../../lib/motion";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useT } from "../../i18n";
import { Section } from "../../components/ui/Panel";
import { StepMark } from "../../components/ui/StepMark";
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
          <Section title={title}>
            {children}
          </Section>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Steps is a flow's progress, small, in the toolbar: steps behind ticked off, the current one in the accent. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          {i > 0 && <span className="h-px w-4 bg-border-strong" aria-hidden />}
          <StepMark state={i < current ? "done" : i === current ? "current" : "todo"} size={14} />
          <span className={i === current ? "text-foreground" : ""}>{s}</span>
        </li>
      ))}
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
