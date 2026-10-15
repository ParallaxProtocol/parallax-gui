import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** How far a pop-up menu keeps from the window's edges, and from its button. */
const MARGIN = 8;
const GAP = 4;

export type PopupPosition = {
  x: number;
  y: number;
  width: number;
  up: boolean;
  /** Above its button, how far its foot is from the window's: for a menu whose height changes as it shows, so it stays on its button. */
  bottom: number;
};

/**
 * usePopup places a pop-up menu that floats over the window (portalled,
 * so a scrolling or clipped panel can't cut it) by its button: under it,
 * or above it where the window has no room below, at least as wide as it.
 * A click elsewhere, a scroll or a resize closes it. Null until placed:
 * the menu stays hidden until then.
 */
export function usePopup(
  open: boolean,
  setOpen: (open: boolean) => void,
  button: RefObject<HTMLElement | null>,
  menu: RefObject<HTMLElement | null>,
): PopupPosition | null {
  const [pos, setPos] = useState<PopupPosition | null>(null);

  // Placed once it has rendered and has a size
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = button.current?.getBoundingClientRect();
    const m = menu.current;
    if (!b || !m) return;
    const h = m.offsetHeight;
    const width = Math.max(b.width, m.offsetWidth);
    const up = b.bottom + GAP + h > window.innerHeight - MARGIN && b.top - GAP - h > MARGIN;
    const x = Math.min(Math.max(b.left, MARGIN), window.innerWidth - width - MARGIN);
    setPos({ x, y: up ? b.top - GAP - h : b.bottom + GAP, width, up, bottom: window.innerHeight - b.top + GAP });
  }, [open, button, menu]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, setOpen, button, menu]);

  return pos;
}
