import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { FADE_OUT, SPRING } from "../../lib/motion";
import { Label } from "./Plate";
import { useT } from "../../i18n";

/**
 * Drawer is a panel that slides in from the right edge over a dimmed page,
 * for detail that should not leave the current view: the peer list, a
 * pool editor. Escape or a click outside closes it.
 */
export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  meta,
  width = "max-w-xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
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
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            className="absolute inset-0 bg-background/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            onClick={onClose}
          />
          <motion.aside
            className={`absolute inset-y-0 right-0 flex w-full ${width} flex-col border-l border-border-strong bg-surface-elevated shadow-2xl`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={SPRING}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
              <div className="min-w-0">
                {eyebrow && <Label as="div" className="mb-1">{eyebrow}</Label>}
                <h2 className="text-2xl leading-tight">{title}</h2>
                {meta && <div className="mt-1 text-xs text-muted-foreground tabular-nums">{meta}</div>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="btn btn-ghost btn-sm -mr-2 px-2"
              >
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
