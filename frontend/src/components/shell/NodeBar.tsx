import { createContext, lazy, ReactNode, Suspense, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Maximize2, Minimize2, Power, Server } from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, formatInt } from "../../lib/format";
import { nodeState, syncProgress, useNode, useRefresh } from "../../lib/live";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../ui/Indicator";
import { Meter } from "../ui/bits";
import { Counter } from "../ui/Counter";
import { Tooltip } from "../ui/Tooltip";
import { IconBadge } from "../ui/IconBadge";
import { TOP_BAR_HEIGHT } from "./TopBar";

const NodePage = lazy(() => import("../../pages/Overview"));

/** The bar's height, collapsed. */
export const NODE_BAR_HEIGHT = 56;
/** How far the collapsed bar floats from the window's edges. */
export const NODE_BAR_GAP = 12;
/** The room the shell keeps at the window's foot for the floating bar. */
export const NODE_BAR_ROOM = NODE_BAR_HEIGHT + 2 * NODE_BAR_GAP;

const STATE_GRADE: Record<ReturnType<typeof nodeState>, Grade> = {
  stopped: "off",
  syncing: "info",
  synced: "good",
};

// Whether the node bar is opened into the node's page, for the shell and
// for whatever opens it (the /node route)
type Sheet = { open: boolean; setOpen: (open: boolean) => void };
const SheetContext = createContext<Sheet>({ open: false, setOpen: () => {} });

export function NodeSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>;
}

export const useNodeSheet = () => useContext(SheetContext);

/**
 * NodeBar floats along the window's foot, under the sidebar too: the node at
 * a glance from every page (its state, the sync's progress, the best
 * block, peers and uptime) and its power switch. Opened, it rises into a
 * floating panel up to the window's title bar and becomes the node's page,
 * its bar staying on as the page's header; closed, it sinks back. Escape
 * closes it.
 */
export default function NodeBar({ version }: { version: string }) {
  const t = useT();
  const node = useNode();
  const refresh = useRefresh();
  const { open, setOpen } = useNodeSheet();
  const state = nodeState(node);
  const progress = syncProgress(node);
  const running = !!node?.running;
  const [busy, setBusy] = useState(false);
  // The window's height, which the open panel fills under the title bar
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const toggle = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (running) await api.stopNode();
      else await api.startNode();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const switchLabel = busy ? (running ? t("node.stopping") : t("node.starting")) : running ? t("node.stop") : t("node.start");
  const openLabel = open ? t("node.collapse") : t("node.expand");

  return (
    <motion.section
      aria-label={t("nav.node")}
      className="no-drag fixed z-40 flex flex-col overflow-hidden border border-glass-edge bg-popover/80 shadow-[var(--glass-shine),var(--shadow-popover)] backdrop-blur-2xl"
      style={{ left: NODE_BAR_GAP, right: NODE_BAR_GAP, bottom: NODE_BAR_GAP, borderRadius: 16 }}
      initial={false}
      animate={{ height: open ? Math.max(NODE_BAR_HEIGHT, vh - TOP_BAR_HEIGHT - NODE_BAR_GAP) : NODE_BAR_HEIGHT }}
      transition={{ type: "spring", bounce: 0, visualDuration: 0.35 }}
    >
      {/* The bar: a click anywhere on it opens the page, whose header it then is */}
      <div
        className={`flex shrink-0 items-center gap-5 border-b pr-3 pl-3 text-sm text-muted-foreground tabular-nums transition-colors ${
          open ? "border-border" : "cursor-pointer border-transparent"
        }`}
        style={{ height: NODE_BAR_HEIGHT }}
        onClick={(e) => {
          if (!open && !(e.target as HTMLElement).closest("button")) setOpen(true);
        }}
      >
        {/* What the node is doing: its badge, with the live dot on it, the
            state, and a line of figures under it */}
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative shrink-0">
            <IconBadge icon={Server} size="sm" />
            <span className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-popover p-[3px]">
              <Indicator grade={STATE_GRADE[state]} ping={running} cause={state} />
            </span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-foreground">{open ? t("nav.node") : t(`node.state.${state}`)}</span>
            <span className="truncate text-xs">
              {running ? (
                <>
                  <Tooltip content={t("clock.bestBlock")}>
                    <span>
                      {t("status.block")}{" "}
                      <Counter value={node.currentBlock} format={(v) => formatInt(Math.round(v))} />
                    </span>
                  </Tooltip>
                  {" · "}
                  {t(node.peers === 1 ? "node.peer" : "node.peers", { n: node.peers })}
                  <span className="hidden lg:inline">
                    {" · "}
                    {t("status.uptime", { time: formatDuration(node.uptimeSeconds) })}
                  </span>
                </>
              ) : (
                node && t("node.offlineHint")
              )}
            </span>
          </span>
        </span>

        {running && state === "syncing" && (
          <span className="flex items-center gap-2.5">
            <Meter value={progress} live thick className="w-48" label={t("node.state.syncing")} />
            <Counter value={progress * 100} format={(v) => `${v.toFixed(1)}%`} className="font-medium text-foreground" />
          </span>
        )}

        {err && <span className="selectable min-w-0 truncate text-critical-ink">{err}</span>}

        <span className="flex-1" />
        {version && !open && <span className="text-xs text-faint">{version}</span>}

        {running ? (
          <Tooltip content={switchLabel}>
            <button
              type="button"
              className="btn btn-tinted btn-icon"
              onClick={toggle}
              disabled={busy || !node}
              aria-label={switchLabel}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
            </button>
          </Tooltip>
        ) : (
          node && (
            <button type="button" className="btn btn-primary rounded-full px-4" onClick={toggle} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
              {switchLabel}
            </button>
          )
        )}
        <Tooltip content={openLabel}>
          <button
            type="button"
            className="btn btn-tinted btn-icon"
            onClick={() => setOpen(!open)}
            aria-label={openLabel}
            aria-expanded={open}
          >
            {open ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </Tooltip>
      </div>

      {/* The node's page, arriving as the bar rises */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="page"
            className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            <Suspense fallback={null}>
              <NodePage />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
