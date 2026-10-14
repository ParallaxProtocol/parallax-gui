import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { FADE_OUT, GLIDE } from "../../lib/motion";

export type SelectOption<T> = { value: T; label: string };

/** How far the menu keeps from the window's edges, and from its button. */
const MARGIN = 8;
const GAP = 4;

/**
 * Select is a pop-up button, as on a Mac: a tinted rounded button naming
 * the choice, with the up-and-down chevrons, that opens a menu of the
 * options with a check by the chosen one. The menu floats over the window
 * (it is portalled, so a scrolling or clipped panel can't cut it), below
 * the button or above it without room. The keyboard works as a listbox's:
 * the arrows move, Enter or Space picks, Escape closes.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  size,
  className = "",
  "aria-label": ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm";
  className?: string;
  "aria-label"?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number; width: number; up: boolean } | null>(null);
  const chosen = options.find((o) => o.value === value);

  const show = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    setOpen(false);
    button.current?.focus();
    if (o && o.value !== value) onChange(o.value);
  };

  // Placed once it has rendered and has a size: under the button, or above
  // it where the window has no room below
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
    setPos({ x, y: up ? b.top - GAP - h : b.bottom + GAP, width, up });
  }, [open]);

  // Closed by a click elsewhere, by scrolling or resizing, or by Escape
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
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      // Only the menu closes, not what it sits in
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        className={`btn btn-tinted justify-between gap-2 rounded-lg ${size === "sm" ? "btn-sm" : "pr-2.5 pl-3.5"} ${className}`}
      >
        <span className="truncate">{chosen?.label ?? ""}</span>
        <ChevronsUpDown className={`shrink-0 text-muted-foreground ${size === "sm" ? "size-3" : "size-3.5"}`} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menu}
              id={id}
              role="listbox"
              aria-label={ariaLabel}
              aria-activedescendant={`${id}-${active}`}
              className="menu no-drag fixed z-[150] flex max-h-80 flex-col gap-px overflow-y-auto p-1"
              // Placed by left/top: motion owns the transform, for the scale
              style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, minWidth: pos?.width, visibility: pos ? "visible" : "hidden" }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: FADE_OUT }}
              transition={GLIDE}
            >
              {options.map((o, i) => (
                <button
                  key={String(o.value)}
                  id={`${id}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  data-active={i === active || undefined}
                  className="menu-item pr-3 whitespace-nowrap"
                >
                  <Check className={`size-3.5 shrink-0 ${o.value === value ? "" : "invisible"}`} />
                  {o.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
