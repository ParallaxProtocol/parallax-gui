import { createContext, type MutableRefObject } from "react";

// The drill-in's context (flow.tsx), apart so a hot update of the flow's
// layout never makes a second one

export type Progressed = { steps: string[]; current: number; skipped?: number[] };

export type Drill = {
  /** Shows the flow's progress in the drill-in's header (none when null). */
  setProgress: (p: Progressed | null) => void;
  /** The Back of the step at hand, for Escape. */
  back: MutableRefObject<(() => void) | null>;
};

export const DrillContext = createContext<Drill>({ setProgress: () => {}, back: { current: null } });
