import {
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

/** How long the pointer rests before a tooltip shows. */
const DELAY_MS = 450;
/** Moving to another target within this long of one closing shows it at once, as native tooltips do. */
const WARM_MS = 400;
const GAP = 6;
const MARGIN = 8;

/**
 * controlsFloor is how far down the window's own controls reach (Windows
 * and Linux draw them over the page, above anything in it) where a tip
 * spanning x..x+w would meet them, or 0 where it wouldn't.
 */
function controlsFloor(x: number, w: number): number {
  const wco = (
    navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect: () => DOMRect } }
  ).windowControlsOverlay;
  if (!wco?.visible) return 0;
  const area = wco.getTitlebarAreaRect();
  // The controls are what the title bar area leaves: on its right, or its left
  const meets = x + w > area.right || x < area.left;
  return meets ? area.bottom + MARGIN : 0;
}

let lastHidden = 0;

type Pos = { x: number; y: number; below: boolean };

/**
 * Tooltip shows a small popover by its child on hover or keyboard focus:
 * the app's own in place of the browser's plain title tooltips. It renders
 * in a layer above the window, so a panel that clips its overflow can't
 * cut it off; it opens above its target, below when there is no room, and
 * stays inside the window.
 *
 * The child must be a single element that accepts a ref and pointer and
 * focus handlers (a DOM element). With `overflowOnly`, the tooltip shows
 * only while the child's text is cut off, for values that truncate.
 */
export function Tooltip({
  content,
  children,
  overflowOnly,
  mono,
}: {
  content: ReactNode;
  children: ReactElement;
  overflowOnly?: boolean;
  /** Set the content in monospace, for hashes and addresses. */
  mono?: boolean;
}) {
  const target = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  const show = useCallback(() => {
    const el = target.current;
    if (!el || content === undefined || content === null || content === "") return;
    if (overflowOnly && el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return;
    window.clearTimeout(timer.current);
    const delay = Date.now() - lastHidden < WARM_MS ? 0 : DELAY_MS;
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [content, overflowOnly]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen((o) => {
      if (o) lastHidden = Date.now();
      return false;
    });
  }, []);

  // Placed once it has rendered and has a size: above the target, or below
  // without room, its center on the target's, kept inside the window
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = target.current;
    const t = tip.current;
    if (!el || !t) return;
    const r = el.getBoundingClientRect();
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const x = Math.min(Math.max(r.left + r.width / 2 - w / 2, MARGIN), window.innerWidth - w - MARGIN);
    const below = r.top - GAP - h < Math.max(MARGIN, controlsFloor(x, w));
    const y = below ? r.bottom + GAP : r.top - GAP - h;
    setPos({ x, y, below });
  }, [open]);

  // Gone on scroll, a click, or Escape, as a native tooltip is
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, hide]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const child = children as ReactElement<any>;
  const trigger = cloneElement(child, {
    ref: (el: HTMLElement | null) => {
      target.current = el;
      const { ref } = child as any;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    onPointerEnter: (e: React.PointerEvent) => {
      child.props.onPointerEnter?.(e);
      if (e.pointerType !== "touch") show();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      child.props.onPointerLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      child.props.onFocus?.(e);
      // Keyboard focus only: a click focuses too, and should not pop a tooltip
      if ((e.target as HTMLElement).matches?.(":focus-visible")) show();
    },
    onBlur: (e: React.FocusEvent) => {
      child.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={tip}
              role="tooltip"
              // Monospace values (hashes, addresses) run wider and a size
              // smaller, so a whole transaction hash fits on one line, and
              // break evenly rather than at a hyphen when they must wrap
              className={`pointer-events-none fixed top-0 left-0 z-[200] rounded-md border border-border-strong bg-popover px-2 py-1 text-foreground shadow-[var(--shadow-popover)] ${
                mono ? "max-w-[34rem] font-mono text-xs leading-4 break-all" : "max-w-80 text-sm break-words"
              }`}
              style={{ x: pos?.x ?? -9999, y: pos?.y ?? -9999, visibility: pos ? "visible" : "hidden" }}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1, transition: { type: "spring", bounce: 0, visualDuration: 0.18 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
