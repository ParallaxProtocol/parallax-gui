import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { FADE_OUT, SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { TONE_WASH } from "./tone";

/**
 * Modal is a dialog over the whole window, for a decision that must be
 * made before going on: removing something for good, confirming a
 * consequence. It rises from a hair below over a dimmed window; Escape,
 * the close button or a click outside dismisses it. Focus moves into it
 * when it opens, stays within it while open, and goes back where it was
 * when it closes. Detail that only accompanies a page goes in a Drawer.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = "default",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What the decision is about, under the title: an account's name. */
  subtitle?: string;
  icon?: ReactNode;
  /** "danger" colours the icon's disc for a destructive decision. */
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  // The latest onClose, so a parent passing a new function each render
  // doesn't rerun the effect below and pull focus back to the first field
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    // Into the dialog: its first field if it has one, else the dialog itself
    const id = requestAnimationFrame(() => {
      const first = box.current?.querySelector<HTMLElement>("input, textarea, select");
      (first ?? box.current)?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      // Keep Tab within the dialog
      const items = [...box.current.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href]")].filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="no-drag fixed inset-0 z-[100] grid place-items-center p-6">
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            onClick={onClose}
          />
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className="relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border-strong bg-popover shadow-[var(--shadow-popover)] outline-none"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4, transition: FADE_OUT }}
            transition={SPRING}
          >
            <header className="flex items-center gap-3 px-5 pt-5">
              {icon && (
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full ${
                    TONE_WASH[tone === "danger" ? "critical" : "brand"]
                  }`}
                >
                  {icon}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="truncate text-[15px] font-semibold">{title}</h2>
                {subtitle && <span className="truncate text-sm text-muted-foreground">{subtitle}</span>}
              </div>
              <button type="button" onClick={onClose} aria-label={t("common.close")} className="btn btn-ghost btn-icon -mr-2">
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * ModalForm is a dialog's content as a form: its fields, then a footer
 * holding its actions, the default one last.
 */
export function ModalForm({
  onSubmit,
  footer,
  children,
}: {
  onSubmit: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-4 px-5 pt-4 pb-5">{children}</div>
      <div className="flex justify-end gap-2 border-t border-border bg-surface/60 px-5 py-3">{footer}</div>
    </form>
  );
}
