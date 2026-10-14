import { ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Bell, CheckCircle2, Download, HardDrive, Loader2, XCircle } from "lucide-react";
import { FADE_OUT, GLIDE } from "../../lib/motion";
import { useNotifications, type NoticeKind } from "../../lib/notifications";
import { useUpdate } from "../../lib/update";
import { useAgo, useT } from "../../i18n";
import { useNow } from "../../lib/useNow";
import { Tooltip } from "../ui/Tooltip";
import UpdatePanel from "../UpdatePanel";
import { IconBadge } from "../ui/IconBadge";

/** The top bar's height, the window's title bar. */
export const TOP_BAR_HEIGHT = 52;

/**
 * TopBar is the window's title bar over the page (the sidebar has its own
 * part, with the app's name): on the right the update on offer (only while
 * there is one) and the notifications. It is the window's drag area, and
 * leaves room for the window controls.
 */
export default function TopBar() {
  const t = useT();
  const { state } = useUpdate();
  const { unread, markRead } = useNotifications();

  return (
    <header className="drag relative z-20 flex shrink-0 items-center gap-2 border-b border-border px-4" style={{ height: TOP_BAR_HEIGHT }}>
      <span className="flex-1" />

      {state.kind !== "hidden" && (
        <Popover
          label={t("updater.available")}
          button={(open) => (
            <span
              className={`btn btn-sm ${state.kind === "available" ? "btn-primary" : "btn-secondary"} ${open ? "brightness-95" : ""}`}
            >
              {state.kind === "downloading" ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  {state.percent}%
                </>
              ) : (
                <>
                  <Download className="size-3" />
                  {t("updater.update")}
                </>
              )}
            </span>
          )}
        >
          <UpdatePanel />
        </Popover>
      )}

      <Popover
        label={t("notifications.title")}
        onOpen={markRead}
        button={() => (
          <span className="btn btn-ghost btn-icon relative">
            <Bell className="size-4" />
            {unread > 0 && <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-critical ring-2 ring-background" />}
          </span>
        )}
      >
        <Notifications />
      </Popover>

      <span className="window-controls-gap" />
    </header>
  );
}

/**
 * Popover is a button that opens a panel hanging from it, right-aligned.
 * Escape or a click outside closes it.
 */
function Popover({
  label,
  button,
  onOpen,
  children,
}: {
  label: string;
  button: (open: boolean) => ReactNode;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    onOpen?.();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={box} className="relative">
      <Tooltip content={label}>
        <button type="button" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
          {button(open)}
        </button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={label}
            className="menu no-drag absolute top-full right-0 z-50 mt-2 w-[360px] p-3"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            transition={GLIDE}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const KIND_ICON: Record<NoticeKind, typeof Bell> = {
  synced: CheckCircle2,
  lowdisk: HardDrive,
  update: Download,
  received: ArrowDownLeft,
  sent: ArrowUpRight,
  failed: XCircle,
};

const KIND_TONE: Record<NoticeKind, "critical" | "good" | "brand" | "neutral"> = {
  synced: "good",
  lowdisk: "critical",
  update: "brand",
  received: "good",
  sent: "neutral",
  failed: "critical",
};

/**
 * Notifications lists what the app has had to tell the user, newest first,
 * as Notification Center does: each its own rounded card, its icon, title,
 * how long ago, and what happened.
 */
function Notifications() {
  const t = useT();
  const ago = useAgo();
  const now = useNow(30_000);
  const { notices, clear } = useNotifications();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-base font-semibold">{t("notifications.title")}</span>
        {notices.length > 0 && (
          <button type="button" className="btn btn-tinted btn-sm" onClick={clear}>
            {t("notifications.clear")}
          </button>
        )}
      </div>
      {notices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <IconBadge icon={Bell} size="lg" />
          <p className="text-sm text-muted-foreground">{t("notifications.empty")}</p>
        </div>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {notices.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-xl bg-muted/60 p-3">
              <IconBadge
                icon={KIND_ICON[n.kind]}
                tone={KIND_TONE[n.kind]}
                size="sm"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{n.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{ago(n.at / 1000, now)}</span>
                </span>
                <span className="text-sm text-muted-foreground">{n.body}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
