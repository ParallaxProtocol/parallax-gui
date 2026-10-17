import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Download,
  HardDrive,
  Lock,
  OctagonAlert,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  XCircle,
} from "lucide-react";
import { FADE_IN, FADE_OUT, GLIDE, SPRING } from "../../lib/motion";
import { useNotifications, type NoticeKind } from "../../lib/notifications";
import { TRAFFIC_LIGHTS_ROW, useSidebar } from "../../lib/sidebar";
import { useUpdate } from "../../lib/update";
import { api } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { useAgo, useT } from "../../i18n";
import { useNow } from "../../lib/useNow";
import { Tooltip } from "../ui/Tooltip";
import UpdateModal from "../UpdateModal";
import { IconBadge } from "../ui/IconBadge";
import { EmptySymbol } from "../ui/bits";
import { ActivitySpinner } from "../ui/ActivitySpinner";

/** The top bar's height, the window's title bar, with macOS's row for its traffic lights over it. */
export const TOP_BAR_HEIGHT = 52 + TRAFFIC_LIGHTS_ROW;

/**
 * TopBar is the window's title bar over the page (the sidebar has its own
 * part, with the app's name): on the left the button that collapses the
 * sidebar to its rail and back, on the right the update on offer (only
 * while there is one), the notifications, and the wallet's lock (while it
 * has a password). It is the window's drag area, and leaves room for the
 * window controls.
 */
export default function TopBar() {
  const t = useT();
  const { state } = useUpdate();
  const [updateOpen, setUpdateOpen] = useState(false);
  const { unread, markRead } = useNotifications();
  const sidebar = useSidebar();
  const sidebarLabel = sidebar.collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar");
  const { info } = useWallet();

  return (
    <header
      className="drag relative z-20 flex shrink-0 items-center gap-2 border-b border-border px-4"
      style={{ height: TOP_BAR_HEIGHT, paddingTop: TRAFFIC_LIGHTS_ROW }}
    >
      <Tooltip content={sidebarLabel}>
        <button
          type="button"
          onClick={sidebar.toggle}
          aria-label={sidebarLabel}
          className="btn btn-ghost btn-icon -ml-2"
        >
          {sidebar.collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </Tooltip>
      <span className="flex-1" />

      {state.kind !== "hidden" && (
        <>
          <Tooltip content={t("updater.available")}>
            <button
              type="button"
              aria-label={t("updater.available")}
              aria-haspopup="dialog"
              onClick={() => setUpdateOpen(true)}
              // A box of its face's size, as the popovers' buttons
              className="flex"
            >
              {/* The step it's at, at a glance: on offer and ready to restart in
                  the accent, working with the activity indicator, failed in red */}
              <span
                className={`btn btn-sm ${state.kind === "available" || state.kind === "ready" ? "btn-primary" : "btn-secondary"} ${updateOpen ? "brightness-95" : ""}`}
              >
                {state.kind === "downloading" ? (
                  <>
                    <ActivitySpinner size={12} />
                    <span className="tabular-nums">{state.percent}%</span>
                  </>
                ) : state.kind === "verifying" || state.kind === "extracting" ? (
                  <>
                    <ActivitySpinner size={12} />
                    {t("updater.update")}
                  </>
                ) : state.kind === "ready" ? (
                  <>
                    <RotateCw className="size-3" />
                    {t("updater.restart")}
                  </>
                ) : state.kind === "error" ? (
                  <>
                    <OctagonAlert className="size-3 text-critical-ink" />
                    {t("updater.update")}
                  </>
                ) : (
                  <>
                    <Download className="size-3" />
                    {t("updater.update")}
                  </>
                )}
              </span>
            </button>
          </Tooltip>
          <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} />
        </>
      )}

      <Popover
        label={t("notifications.title")}
        onOpen={markRead}
        button={() => (
          <span className="btn btn-ghost btn-icon relative">
            <Bell className="size-4" />
            {unread > 0 && (
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 size-2 rounded-full bg-critical ring-2 ring-background"
              />
            )}
          </span>
        )}
      >
        <Notifications />
      </Popover>

      {info?.hasPassword && (
        <Tooltip content={t("lock.now")}>
          <button
            type="button"
            onClick={() => api.walletLock().catch(() => {})}
            aria-label={t("lock.now")}
            className="btn btn-ghost btn-icon"
          >
            <Lock className="size-4" />
          </button>
        </Tooltip>
      )}

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
  // Somewhere else opened from it (a notification's transaction), it closes
  const { key } = useLocation();
  useEffect(() => setOpen(false), [key]);

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
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((o) => !o)}
          // A box of its face's size: inline, it would sit its face on the
          // text's baseline, below the bar's other buttons
          className="flex"
        >
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
  received: ArrowDownLeft,
  sent: ArrowUpRight,
  failed: XCircle,
};

const KIND_TONE: Record<NoticeKind, "critical" | "good" | "neutral"> = {
  synced: "good",
  lowdisk: "critical",
  received: "good",
  sent: "neutral",
  failed: "critical",
};

/** How long the cards take to fade away when the notifications are cleared. */
const CLEAR_FADE_MS = 180;

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
  const navigate = useNavigate();
  // Cleared, the cards fade away in place first; once they're gone the
  // list is emptied, and the panel eases to the empty state's height
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!clearing) return;
    const done = setTimeout(() => {
      clear();
      setClearing(false);
    }, CLEAR_FADE_MS);
    return () => clearTimeout(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearing]);
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-7 items-center justify-between px-1">
        <span className="text-base font-semibold">{t("notifications.title")}</span>
        <AnimatePresence initial={false}>
          {notices.length > 0 && !clearing && (
            <motion.button
              type="button"
              className="btn btn-tinted btn-sm"
              onClick={() => setClearing(true)}
              exit={{ opacity: 0, transition: FADE_OUT }}
            >
              {t("notifications.clear")}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <motion.div className="overflow-hidden" initial={false} animate={{ height }} transition={SPRING}>
        <div ref={inner}>
          {notices.length === 0 ? (
            <motion.div
              className="flex flex-col items-center gap-3 px-4 py-8 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: FADE_IN }}
            >
              <EmptySymbol icon={Bell} />
              <p className="text-sm text-muted-foreground">{t("notifications.empty")}</p>
            </motion.div>
          ) : (
            <ul className="flex max-h-96 flex-col gap-2 overflow-x-hidden overflow-y-auto">
              <AnimatePresence initial={false}>
                {notices.map((n, i) => (
                  <motion.li
                    key={n.id}
                    className="relative flex items-start gap-3 rounded-xl bg-muted/60 p-3"
                    initial={{ opacity: 0, y: -6 }}
                    animate={
                      clearing
                        ? { opacity: 0, scale: 0.97, transition: { duration: CLEAR_FADE_MS / 1000, ease: "easeOut" } }
                        : { opacity: 1, scale: 1, y: 0, transition: SPRING }
                    }
                  >
                    {/* One about a transaction opens it, the whole card its button, beneath what it shows */}
                    {n.link && (
                      <button
                        type="button"
                        className="absolute inset-0 rounded-xl transition-colors hover:bg-hover"
                        onClick={() => navigate(n.link!)}
                        aria-label={`${n.title}. ${t("notifications.open")}`}
                      />
                    )}
                    <span className="pointer-events-none relative flex">
                      <IconBadge icon={KIND_ICON[n.kind]} tone={KIND_TONE[n.kind]} size="sm" />
                    </span>
                    <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold">{n.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {ago(n.at / 1000, now)}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground">{n.body}</span>
                    </span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </motion.div>
    </div>
  );
}
