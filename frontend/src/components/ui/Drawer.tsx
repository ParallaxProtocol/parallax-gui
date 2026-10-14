import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { FADE_OUT, SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { TOP_BAR_HEIGHT } from "../shell/TopBar";
import { NODE_BAR_GAP, NODE_BAR_ROOM } from "../shell/NodeBar";

/** How far the drawer floats in from the panel it opens over. */
const INSET = 8;

/**
 * Drawer is an inspector that floats in from the right over a dimmed view,
 * for detail that should not leave the current page: a setting's full
 * explanation. It is a pane of the same frosted glass as the Settings
 * panel and the node bar, inset from the edges and rounded as they are,
 * inside the area they leave. Escape or a click outside closes it.
 */
export function Drawer({
  open,
  onClose,
  title,
  meta,
  width = "max-w-lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  meta?: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only the drawer closes: not the Settings panel under it
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        // Below the title bar, so the window stays draggable and its controls reachable
        <div
          className="no-drag fixed inset-x-0 bottom-0 z-[90]"
          style={{ top: TOP_BAR_HEIGHT }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            className="absolute inset-0 bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            onClick={onClose}
          />
          <motion.aside
            className={`absolute flex w-full ${width} flex-col overflow-hidden border border-glass-edge bg-popover/85 shadow-[var(--glass-shine),var(--shadow-popover)] backdrop-blur-2xl`}
            style={{ top: INSET, right: NODE_BAR_GAP + INSET, bottom: NODE_BAR_ROOM + INSET, borderRadius: 16 }}
            initial={{ opacity: 0, x: 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 48, transition: { duration: 0.18, ease: "easeIn" } }}
            transition={SPRING}
          >
            <header className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4 pb-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-[17px] leading-snug font-semibold tracking-tight">{title}</h2>
                {meta && <span className="truncate text-sm text-muted-foreground tabular-nums">{meta}</span>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-selected hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={2.5} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
