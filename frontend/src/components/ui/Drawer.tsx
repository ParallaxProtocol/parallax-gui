import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { FADE_OUT, SPRING } from "../../lib/motion";
import { useT } from "../../i18n";

/**
 * Drawer is an inspector panel that slides in from the window's right edge
 * over a dimmed view, for detail that should not leave the current page:
 * the peer list, a pool editor. Escape or a click outside closes it.
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        // Below the toolbar, so the window stays draggable and its controls reachable.
        // Clipped there too: the panel's shadow would otherwise shade the toolbar,
        // around the window controls the OS paints over it in a solid colour
        <div className="fixed inset-x-0 top-11 bottom-0 z-[90] overflow-hidden" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            className="absolute inset-0 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            onClick={onClose}
          />
          <motion.aside
            className={`absolute inset-y-0 right-0 flex w-full ${width} flex-col border-l border-border-strong bg-background shadow-[-8px_0_32px_rgb(0_0_0/18%)]`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={SPRING}
          >
            <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border pr-2 pl-4">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="truncate font-semibold">{title}</h2>
                {meta && <span className="truncate text-sm text-muted-foreground tabular-nums">{meta}</span>}
              </div>
              <button type="button" onClick={onClose} aria-label={t("common.close")} className="btn btn-ghost btn-icon">
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
