import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft } from "lucide-react";
import { FADE_IN, PAGE, SPRING } from "../../../lib/motion";
import { useT } from "../../../i18n";
import { Row } from "../../../components/ui/Panel";
import Toggle from "../../../components/ui/Toggle";
import { StepMark } from "../../../components/ui/StepMark";

/**
 * The layout of the pages Settings drills into from a section, as System
 * Settings opens a page within a pane: the way back to the section above
 * the page's name, the flow's progress beside it, and the step at hand
 * below, in groups of rows as a Settings section is. Escape goes back a
 * step, as the step's own Back does, rather than closing Settings.
 */

type Progressed = { steps: string[]; current: number; skipped?: number[] };

type Drill = {
  /** Shows the flow's progress in the drill-in's header (none when null). */
  setProgress: (p: Progressed | null) => void;
  /** The Back of the step at hand, for Escape. */
  back: MutableRefObject<(() => void) | null>;
};

const DrillContext = createContext<Drill>({ setProgress: () => {}, back: { current: null } });

/** DrillIn is a page within a Settings section: the way back to it, the page's name, and the page. */
export function DrillIn({
  title,
  subtitle,
  parent,
  onLeave,
  children,
}: {
  title: string;
  /** What the page is about, under its name: a recovery phrase's. */
  subtitle?: ReactNode;
  /** The section's name, on the way back to it. */
  parent: string;
  onLeave: () => void;
  children: ReactNode;
}) {
  // The header draws the progress, not the flow, so it stays put (its
  // marks moving on) as the flow below changes, from a choice to the flow
  // chosen as from step to step
  const [progress, setProgress] = useState<Progressed | null>(null);
  const back = useRef<(() => void) | null>(null);

  // On the document as it bubbles, so a menu or field that takes its own
  // Escape (and marks it handled) keeps it, and before Settings' own, on
  // the window, which would close it and lose the flow
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog][aria-modal=true]")) return;
      e.preventDefault();
      // A step with no Back (the words just made, the flow done) has its
      // own ways on, and Escape mustn't skip them
      back.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <DrillContext.Provider value={{ setProgress, back }}>
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm -ml-2 self-start text-muted-foreground"
            onClick={onLeave}
          >
            <ChevronLeft className="size-4" />
            {parent}
          </button>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            {subtitle && <div className="text-muted-foreground">{subtitle}</div>}
          </div>
          {/* The flow's progress, across the page under its name */}
          {progress && progress.steps.length > 1 && (
            <motion.div
              className="mt-3"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: FADE_IN }}
            >
              <Progress steps={progress.steps} current={progress.current} skipped={progress.skipped} />
            </motion.div>
          )}
        </div>
        {children}
      </div>
    </DrillContext.Provider>
  );
}

/**
 * SettingsFlow is a drill-in's flow of steps: the step at hand changing in
 * place, its progress across the drill-in's header. A step is laid out as a
 * Settings section is, in groups (Group) of rows (FieldRow, ToggleRow),
 * its actions at its foot (StepFooter), so its name is the step's own
 * title, read out but not drawn twice over the groups that name its parts.
 */
export function SettingsFlow({
  title,
  steps,
  current,
  skipped,
  children,
}: {
  title: string;
  steps: string[];
  current: number;
  /** The steps behind passed without being done. */
  skipped?: number[];
  children: ReactNode;
}) {
  const { setProgress } = useContext(DrillContext);
  const key = steps.join("\n");
  const skips = (skipped ?? []).join();
  useEffect(() => {
    setProgress({ steps, current, skipped });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, current, skips, setProgress]);
  // Leaving the flow takes its progress with it; one coming in (from a
  // choice to the flow chosen) sets its own in the same commit
  useEffect(() => () => setProgress(null), [setProgress]);
  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {/* Keyed by the step's name, not its index: the backup step ticks
            its progress on once saved without arriving all over again */}
        <motion.div key={title} {...PAGE}>
          <h3 className="sr-only">{title}</h3>
          {children}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

/**
 * Progress is a flow's steps across the page: each one's mark and name,
 * those behind ticked off (or marked skipped, if passed without being done), the one at hand in full, and the lines between
 * them stretching to fill the width, each filling in as the step before
 * it is done.
 */
function Progress({ steps, current, skipped = [] }: { steps: string[]; current: number; skipped?: number[] }) {
  const t = useT();
  return (
    // Where the page is too narrow for every name, the one at hand alone keeps its
    <ol className="@container flex w-full items-center gap-2.5">
      {steps.map((s, i) => {
        const state = i < current ? (skipped.includes(i) ? "skipped" : "done") : i === current ? "current" : "todo";
        return (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden className="relative h-px min-w-3 flex-1 overflow-hidden rounded-full bg-border-strong">
                <motion.span
                  className="absolute inset-0 origin-left bg-brand-mark"
                  initial={false}
                  animate={{ scaleX: i <= current ? 1 : 0 }}
                  transition={SPRING}
                />
              </li>
            )}
            <li className="flex shrink-0 items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
              <StepMark state={state} size={18} />
              <span
                className={`text-sm whitespace-nowrap transition-colors ${
                  state === "current" ? "font-medium text-foreground" : "hidden text-muted-foreground @xl:inline"
                }`}
              >
                {s}
              </span>
              {state === "skipped" && <span className="sr-only">{t("common.skipped")}</span>}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/** Step is one step's groups and its actions, a form when it submits. */
export function Step({ onSubmit, children }: { onSubmit?: () => void; children: ReactNode }) {
  const className = "flex flex-col gap-7";
  if (onSubmit) {
    return (
      <form
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    );
  }
  return <div className={className}>{children}</div>;
}

/**
 * FieldRow is a field as a Settings row: what it is (and a line on it) on
 * the left, the control on the right; what's wrong with the value under it.
 */
export function FieldRow({
  label,
  desc,
  error,
  wide,
  children,
}: {
  label: string;
  desc?: ReactNode;
  error?: string | null;
  /** A control that needs more room: an address, a key. */
  wide?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-h-14 items-center justify-between gap-8 px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id}>{label}</label>
        {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
        {error && <p className="mt-0.5 text-sm text-critical-ink">{error}</p>}
      </div>
      <div className={`shrink-0 ${wide ? "w-96 max-w-[60%]" : "w-64"}`}>{children(id)}</div>
    </div>
  );
}

/** ToggleRow is an on/off choice as a Settings row. */
export function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc?: ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Row title={title} desc={desc}>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </Row>
  );
}

/** useDrillBack makes back what Escape does on the page at hand (nothing when undefined). */
export function useDrillBack(onBack: (() => void) | undefined) {
  const { back } = useContext(DrillContext);
  useEffect(() => {
    back.current = onBack ?? null;
    return () => {
      if (back.current === onBack) back.current = null;
    };
  }, [back, onBack]);
}

/**
 * StepFooter is a step's actions, at its foot under its groups, as a
 * Settings sheet's buttons are: a line on what comes next, Back (Escape's,
 * too), and the step's own actions on the right.
 */
export function StepFooter({ onBack, hint, children }: { onBack?: () => void; hint?: ReactNode; children: ReactNode }) {
  const t = useT();
  useDrillBack(onBack);
  return (
    <div className="flex flex-wrap items-center gap-3 px-1">
      <div className="min-w-0 flex-1 text-sm text-muted-foreground">{hint}</div>
      {onBack && (
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          {t("common.back")}
        </button>
      )}
      {children}
    </div>
  );
}
