import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { FADE_OUT, SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { ActivitySpinner } from "./ActivitySpinner";

/**
 * Modal is a dialog over the whole window, for a decision that must be
 * made before going on: removing something for good, confirming a
 * consequence. A sheet of frosted glass, it rises from a hair below over
 * a dimmed window; Escape, the close button or a click outside dismisses
 * it. Focus moves into it when it opens, stays within it while open, and
 * goes back where it was when it closes. Detail that only accompanies a page goes in a Drawer.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = "default",
  wide,
  footer,
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
  /** Wider and less tall, for reading: a release's notes. */
  wide?: boolean;
  /** Held under what scrolls, never scrolled with it: its scrollbar ends above it. */
  footer?: ReactNode;
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
            // Dimmed lightly enough for the window to show through the dialog's glass
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
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
            // Frosted glass, as the Settings sheet and drawers: what's behind shows through, blurred
            className={`relative flex w-full ${wide ? "max-h-[min(100%,52rem)] max-w-3xl" : "max-h-full max-w-md"} flex-col overflow-hidden rounded-2xl border border-glass-edge bg-popover/80 shadow-[var(--glass-shine),var(--shadow-popover)] backdrop-blur-2xl backdrop-saturate-150 outline-none`}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4, transition: FADE_OUT }}
            transition={SPRING}
          >
            <header
              // Wide, what's under it scrolls: a hairline parts the two, as the footer's does below
              className={`flex shrink-0 items-center gap-3 px-5 pt-5 ${wide ? "border-b border-border pb-4" : ""}`}
            >
              {/* Its symbol bare, as a sheet leads with one, in its tone; given
                  at any size, it's drawn at the title's, at the app's weight */}
              {icon && (
                <span
                  aria-hidden
                  className={`grid shrink-0 place-items-center [&_svg]:size-5 [&_svg]:stroke-[1.75] ${
                    tone === "danger" ? "text-critical-ink" : "text-brand"
                  }`}
                >
                  {icon}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="truncate text-[15px] font-semibold">{title}</h2>
                {subtitle && <span className="truncate text-sm text-muted-foreground">{subtitle}</span>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="btn btn-ghost btn-icon -mr-2"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 overflow-y-auto">{children}</div>
            {footer && <div className="shrink-0">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * ModalForm is a dialog's content as a form: its fields, then a footer
 * holding its actions, the default one last. While busy, as a Mac's sheet
 * while it works, the form gives way to a large spinner (and busyLabel
 * under it), coming back as it was once done: its fields' values live with
 * the dialog, so nothing typed is lost. The dialog glides to each one's
 * height rather than jumping.
 */
export function ModalForm({
  onSubmit,
  footer,
  footerClassName = "border-border bg-surface/60",
  busy = false,
  busyLabel,
  children,
}: {
  onSubmit: () => void;
  footer: ReactNode;
  /** The footer's separator and ground, for a form on another surface than a dialog's. */
  footerClassName?: string;
  /** Whether what the form asked for is under way: the spinner shows in its place. */
  busy?: boolean;
  /** What is under way, under the spinner. */
  busyLabel?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const [measure, height] = useHeight();
  const form = useRef<HTMLFormElement>(null);
  // Back from the spinner, the focus goes back into the form, which it left as the form went
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("input:not(:disabled), textarea")?.focus());
    }
    wasBusy.current = busy;
  }, [busy]);
  return (
    <motion.div className="overflow-hidden" animate={{ height: height ?? "auto" }} transition={SPRING}>
      <div ref={measure}>
        <AnimatePresence mode="wait" initial={false}>
          {busy ? (
            <motion.div
              key="busy"
              className="flex flex-col items-center gap-4 px-5 py-16 text-foreground/70"
              initial={{ opacity: 0, scale: 0.6, filter: "blur(6px)" }}
              animate={{
                opacity: 1,
                scale: 1,
                filter: "blur(0px)",
                transition: { type: "spring", bounce: 0.3, visualDuration: 0.45 },
              }}
              exit={{ opacity: 0, scale: 0.85, filter: "blur(6px)", transition: { duration: 0.18, ease: "easeIn" } }}
            >
              <ActivitySpinner size={72} label={typeof busyLabel === "string" ? busyLabel : t("splash.loading")} />
              {busyLabel && <p className="text-center text-sm text-muted-foreground">{busyLabel}</p>}
            </motion.div>
          ) : (
            <motion.form
              key="form"
              ref={form}
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
              initial={{ opacity: 0, scale: 0.98, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: SPRING }}
              exit={{ opacity: 0, scale: 0.98, filter: "blur(4px)", transition: { duration: 0.15, ease: "easeIn" } }}
            >
              <div className="flex flex-col gap-4 px-5 pt-4 pb-5">{children}</div>
              <div className={`flex justify-end gap-2 border-t px-5 py-3 ${footerClassName}`}>{footer}</div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** useHeight measures an element's height as it changes, for a container to glide to. */
function useHeight(): [(el: HTMLDivElement | null) => void, number | undefined] {
  const [height, setHeight] = useState<number>();
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize[0].blockSize));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [measure, height];
}
