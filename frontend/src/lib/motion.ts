import { useEffect, useRef } from "react";
import type { Transition } from "motion/react";
import { useAnimationsOff } from "./prefs";

/** What opens, closes, arrives and leaves moves on a spring without bounce: quick, and interruptible midway. */
export const SPRING: Transition = { type: "spring", bounce: 0, visualDuration: 0.38 };
/** A selection moving between items (sidebar, segments, panes): quicker, with a hint of settle. */
export const GLIDE: Transition = { type: "spring", bounce: 0.12, visualDuration: 0.3 };
/** What goes fades out quickly; what comes fades in a beat later, once there is room for it. */
export const FADE_OUT: Transition = { duration: 0.12, ease: "easeOut" };
export const FADE_IN: Transition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] };

/**
 * A page or pane changing in place: the new one grows from a hair smaller
 * as it fades in. Scale rather than a slide, so it never reaches past the
 * window's edge and flashes a scrollbar.
 */
export const PAGE = {
  initial: { opacity: 0, scale: 0.995 },
  animate: { opacity: 1, scale: 1, transition: FADE_IN },
  exit: { opacity: 0, transition: FADE_OUT },
};

/**
 * usePageSwap is PAGE for a page or pane keyed by what it shows, without
 * AnimatePresence: the new one arrives as PAGE has it, and the old one goes
 * at once rather than fading first. Waiting on that fade (mode="wait")
 * could stall, keeping the old one mounted, its effects still running, and
 * the new one out. The first one shown doesn't arrive, as with
 * `initial={false}`.
 */
export function usePageSwap() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return { initial: mounted.current ? PAGE.initial : false, animate: PAGE.animate };
}

/**
 * Items of a list shown for the first time arrive one after another.
 *
 * `rise` and `fade` are `item` split in two, for an item holding glass (a
 * `.btn-secondary`): while an element fades, a backdrop-filter inside it
 * blurs only what is inside it too, so the glass shows its bare tint and
 * takes on what is behind it with a jump on the last frame. The item
 * rises (a transform doesn't bound the blur) and the glass fades itself.
 */
export const STAGGER = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.035 } } },
  item: { hidden: { opacity: 0, y: 6 }, visible: { opacity: 1, y: 0, transition: SPRING } },
  rise: { hidden: { y: 6 }, visible: { y: 0, transition: SPRING } },
  fade: { hidden: { opacity: 0 }, visible: { opacity: 1, transition: SPRING } },
};

/**
 * ROW_IN is STAGGER's arrival for a pop-up list's rows, settling down from
 * above instead of rising: in the list's scroll box a row still below its
 * place would overflow the bottom and flash a scrollbar, the top doesn't.
 */
export const ROW_IN = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0, transition: SPRING },
};

/**
 * A field's pop-up (a picker's list under its field) opens quicker than a
 * menu off the shell, and its rows follow closer on one another: it is
 * part of the form, not a panel of its own. POPUP is the list itself,
 * POPUP_ROWS and POPUP_ROW its rows' arrival.
 */
const POP: Transition = { type: "spring", bounce: 0, visualDuration: 0.22 };
export const POPUP = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: POP },
  exit: { opacity: 0, scale: 0.98, transition: FADE_OUT },
};
export const POPUP_ROWS = { hidden: {}, visible: { transition: { staggerChildren: 0.02 } } };
export const POPUP_ROW = { hidden: { opacity: 0, y: -4 }, visible: { opacity: 1, y: 0, transition: POP } };

/**
 * The props for a STAGGER container. With animations off it starts
 * visible: otherwise Motion commits the hidden state for one frame before
 * snapping, which reads as a flicker.
 */
export function useStagger() {
  const off = useAnimationsOff();
  return { variants: STAGGER.container, initial: off ? false : "hidden", animate: "visible" } as const;
}

/**
 * useStepSwap is PAGE for a flow's step (Send, a message's signing), keyed
 * by `step` under AnimatePresence: the step the page opens on doesn't
 * arrive, those after it do. AnimatePresence's own `initial={false}` would
 * hold the first step still too, but it holds back everything beneath it
 * as well, so the step's own parts (a GlowCard's rows) wouldn't arrive.
 */
export function useStepSwap(step: string) {
  const first = useRef(step);
  const moved = useRef(false);
  if (step !== first.current) moved.current = true;
  return moved.current ? PAGE : { ...PAGE, initial: false as const };
}
