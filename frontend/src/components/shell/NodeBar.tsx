import { lazy, ReactNode, Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Power,
  RadioTower,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, formatInt } from "../../lib/format";
import { nodeState, syncProgress, useNode, useRefresh } from "../../lib/live";
import { useT } from "../../i18n";
import { NodeSheetContext, useNodeSheet } from "../../lib/nodeSheet";
import { Indicator, type Grade } from "../ui/Indicator";
import { Meter } from "../ui/bits";
import { Counter } from "../ui/Counter";
import { Tooltip } from "../ui/Tooltip";
import { TOP_BAR_HEIGHT } from "./TopBar";
import { useAssistant } from "../../lib/assistantContext";
import { NodeSwitchContext, useNodeSwitch } from "../../lib/nodeSwitch";
import { BAR_FADE, BAR_GLASS, BAR_SURFACE } from "./barSurface";

const NodePage = lazy(() => import("../../pages/Overview"));

/** The node's icon, wherever the app shows it: the bar, and setup's choice to run one. */
export const NODE_ICON: LucideIcon = RadioTower;
/** Its stroke, lighter than Lucide's 2, and the offline signer's shield's beside or in place of it. */
export const NODE_ICON_STROKE = 1.5;

/** The bar's height, collapsed. */
export const NODE_BAR_HEIGHT = 64;
/** How far the collapsed bar floats from the window's edges. */
export const NODE_BAR_GAP = 12;
/** The room the shell keeps at the window's foot for the floating bar. */
export const NODE_BAR_ROOM = NODE_BAR_HEIGHT + 2 * NODE_BAR_GAP;

const STATE_GRADE: Record<ReturnType<typeof nodeState>, Grade> = {
  stopped: "off",
  syncing: "info",
  synced: "good",
};

export function NodeSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <NodeSheetContext.Provider value={{ open, setOpen }}>{children}</NodeSheetContext.Provider>;
}

export { useNodeSheet };

/** NodeSwitchProvider holds the node's power switch for the whole shell: the bar, the node's page and Send's Connect show one state. */
export function NodeSwitchProvider({ children }: { children: ReactNode }) {
  const node = useNode();
  const refresh = useRefresh();
  const running = !!node?.running;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
  return <NodeSwitchContext.Provider value={{ busy, err, toggle }}>{children}</NodeSwitchContext.Provider>;
}

/**
 * NodeBar floats along the window's foot, under the sidebar too: the node at
 * a glance from every page (its state, the sync's progress, the best
 * block, peers and uptime) and its power switch, in a capsule as the
 * assistant bar beside it. Opened, it rises into a
 * floating panel up to the window's title bar and becomes the node's page,
 * its bar staying on as the page's header; closed, it sinks back. Escape
 * closes it.
 */
export default function NodeBar() {
  const t = useT();
  const node = useNode();
  const { open, setOpen } = useNodeSheet();
  const state = nodeState(node);
  const progress = syncProgress(node);
  const running = !!node?.running;
  const { busy, err, toggle } = useNodeSwitch();
  // The window's height, which the open panel fills under the title bar
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // The assistant bar sits at the right end of the foot: this bar keeps
  // clear of it, moving aside as it opens on a request. Opened into the
  // node's page it takes the whole width, the assistant bar stepping
  // away meanwhile, unless a request has it open
  const { width: assistantWidth, shown, sent } = useAssistant();
  const asking = !!shown || !!sent;
  const right = NODE_BAR_GAP + (assistantWidth > 0 && (!open || asking) ? assistantWidth + NODE_BAR_GAP : 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const switchLabel = busy
    ? running
      ? t("node.stopping")
      : t("node.starting")
    : running
      ? t("node.stop")
      : t("node.start");
  const openLabel = open ? t("node.collapse") : t("node.expand");

  return (
    <>
      <motion.section
        aria-label={t("nav.network")}
        // At rest the cards' glass, as the empty wallet's Settings pill, lit under the pointer as it opens on a click; opened, the page's thicker glass
        className={`no-drag fixed z-40 flex flex-col overflow-hidden ${open ? BAR_SURFACE : `${BAR_GLASS} hover:bg-[var(--glass-hover)]`} ${BAR_FADE}`}
        style={{ left: NODE_BAR_GAP, bottom: NODE_BAR_GAP }}
        initial={false}
        // A capsule at rest, as the assistant bar; opened, a panel's corners
        animate={{
          right,
          height: open ? Math.max(NODE_BAR_HEIGHT, vh - TOP_BAR_HEIGHT - NODE_BAR_GAP) : NODE_BAR_HEIGHT,
          borderRadius: open ? 16 : NODE_BAR_HEIGHT / 2,
        }}
        transition={{ type: "spring", bounce: 0, visualDuration: 0.35 }}
      >
        {/* The bar: a click anywhere on it opens the page, whose header it then is.
            Its buttons sit as far from the end as from the top and bottom,
            their circles concentric with the capsule's; its symbol, bare as
            Apple leaves a status's, is inset as a glyph in the capsule's curve */}
        <div
          className={`flex shrink-0 items-center gap-5 border-b pr-[15px] pl-5 text-sm text-muted-foreground tabular-nums transition-colors ${
            open ? "border-border" : "border-transparent"
          }`}
          style={{ height: NODE_BAR_HEIGHT }}
          onClick={(e) => {
            if (!open && !(e.target as HTMLElement).closest("button")) setOpen(true);
          }}
        >
          {/* What the node is doing: its symbol, the state led by its live dot
            (as System Settings marks a connection), and a line of figures under
            it, starting where the dot does */}
          {/* The symbol as far from its text as the buttons at the other end are apart */}
          <span className="flex min-w-0 items-center gap-5">
            <NODE_ICON className="size-5 shrink-0" strokeWidth={NODE_ICON_STROKE} aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <Indicator grade={STATE_GRADE[state]} ping={running} cause={state} />
                <span className="truncate text-[15px] font-semibold text-foreground">
                  {open ? t("nav.network") : t(`node.state.${state}`)}
                </span>
              </span>
              <span className="truncate text-sm">
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
                  // Opened, the page under it says why and offers the switch
                  node && !open && t("node.offlineHint")
                )}
              </span>
            </span>
          </span>

          {running && state === "syncing" && (
            <span className="flex items-center gap-2.5">
              <Meter value={progress} live thick className="w-56" label={t("node.state.syncing")} />
              <Counter
                value={progress * 100}
                format={(v) => `${v.toFixed(1)}%`}
                className="font-medium text-foreground"
              />
            </span>
          )}

          <span className="flex-1" />

          {/* A failed switch: its symbol, the message on hover. Opened on a
              stopped node, the page shows the error by its button */}
          {err && (running || !open) && (
            <Tooltip content={err}>
              <span
                className="grid shrink-0 place-items-center text-critical-ink"
                role="img"
                aria-label={err}
                tabIndex={0}
              >
                <TriangleAlert className="size-4" />
              </span>
            </Tooltip>
          )}

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
            // Opened, the page's own button is the one; a second would compete with it
            node &&
            !open && (
              <button type="button" className="btn btn-primary rounded-full px-4" onClick={toggle} disabled={busy}>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
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
              {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
            </button>
          </Tooltip>
        </div>

        {/* The node's page, arriving as the bar rises */}
        <AnimatePresence>
          {open && (
            <motion.div
              key="page"
              className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
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
    </>
  );
}

/**
 * OfflineBar takes the node bar's place when the app is an offline signer:
 * there is no node to show, only the promise that nothing goes online.
 */
export function OfflineBar() {
  const t = useT();
  return (
    <section
      aria-label={t("offline.mode")}
      className={`no-drag fixed z-40 flex items-center gap-5 pr-[15px] pl-5 text-sm text-muted-foreground ${BAR_GLASS}`}
      style={{
        left: NODE_BAR_GAP,
        right: NODE_BAR_GAP,
        bottom: NODE_BAR_GAP,
        height: NODE_BAR_HEIGHT,
        borderRadius: NODE_BAR_HEIGHT / 2,
      }}
    >
      <ShieldCheck className="size-5 shrink-0 text-good-ink" strokeWidth={NODE_ICON_STROKE} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-foreground">{t("offline.mode")}</span>
        <span className="truncate">{t("offline.mode.bar")}</span>
      </span>
    </section>
  );
}
