import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, TriangleAlert } from "lucide-react";
import { api } from "../../lib/api";
import { useRefresh } from "../../lib/live";
import { FADE_IN, FADE_OUT, SPRING } from "../../lib/motion";
import { torBarKind, useTorBarFresh, useTorStatus } from "../../lib/torStatus";
import { useT } from "../../i18n";
import { OnionSymbol } from "../ui/symbols";
import { TOP_BAR_HEIGHT } from "./TopBar";

/** The Tor bar's height opened, under the pointer, and at rest, a line of Tor's purple. */
export const TOR_BAR_HEIGHT = 28;
export const TOR_LINE_HEIGHT = 4;
/**
 * The bar's tint: Tor's purple as a material, the way the window's other
 * bars are glass (barSurface.ts), one colour over the blurred page with no
 * gradient of its own. Translucent no further than white text keeps
 * 4.5:1 over the light theme's white: 5.6:1.
 */
const TOR_TINT = "rgb(108 59 135 / 0.86)";

/**
 * useTorBarHeight is the room the Tor bar takes under the title bar while
 * Tor is on, 0 otherwise: all of it while it's open of itself, on a new
 * message, its line after. Opened under the pointer, it lies over the page.
 */
export function useTorBarHeight(): number {
  const on = !!useTorStatus()?.enabled;
  const fresh = useTorBarFresh();
  return on ? (fresh ? TOR_BAR_HEIGHT : TOR_LINE_HEIGHT) : 0;
}

/**
 * TorBarSpacer keeps the Tor bar's room under a title bar's part (the
 * sidebar's, the page's), growing and shrinking with the bar.
 */
export function TorBarSpacer() {
  const height = useTorBarHeight();
  return <motion.div className="shrink-0" initial={false} animate={{ height }} transition={SPRING} aria-hidden />;
}

/**
 * TorBar runs across the whole window, sidebar and page, under the title
 * bar, while the Tor switch is on (TorBarSpacer keeps its room under each
 * part of the title bar; Settings, the node's page and the assistant
 * panel open over it): on every page, Tor's
 * purple saying that everything
 * the app sends goes through Tor, or that it's still connecting, or can't,
 * nothing going out meanwhile; and, for a node started before Tor was
 * turned on, that it goes behind Tor once it restarts, with the restart at
 * hand. Each new message shows for 30 seconds; then it is only a line of
 * the purple, opening over the page into its message under the pointer
 * (or the keyboard's focus). It slides
 * down as Tor is turned on and away as it's turned off, its message
 * swapping in place as the save bar's does.
 */
export default function TorBar() {
  const t = useT();
  const st = useTorStatus();
  const refresh = useRefresh();
  const [restarting, setRestarting] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const on = !!st?.enabled;
  const fresh = useTorBarFresh();
  const open = hovered || focused || fresh;

  const kind = torBarKind(st);
  const message =
    kind === "starting"
      ? t("tor.banner.starting", { n: st?.progress ?? 0 })
      : kind === "off"
        ? ""
        : t(`tor.banner.${kind}`);

  const restart = async () => {
    setRestarting(true);
    try {
      await api.stopNode();
      await api.startNode();
    } catch {
      /* the node bar shows why it didn't start */
    } finally {
      setRestarting(false);
      refresh();
    }
  };

  return (
    <AnimatePresence initial={false}>
      {on && (
        <motion.div
          key="tor-bar"
          // Not the window's drag area: it would take the pointer, and the bar never open
          className="no-drag absolute inset-x-0 z-10 overflow-hidden border-b border-black/15 text-white shadow-[var(--glass-shine)] backdrop-blur-2xl backdrop-saturate-150"
          style={{ top: TOP_BAR_HEIGHT, background: TOR_TINT }}
          initial={{ height: 0 }}
          animate={{ height: open ? TOR_BAR_HEIGHT : TOR_LINE_HEIGHT }}
          exit={{ height: 0 }}
          transition={SPRING}
          onHoverStart={() => setHovered(true)}
          onHoverEnd={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
          }}
          role="status"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={kind}
              className="flex items-center justify-center gap-2 px-4 text-[13px] font-medium"
              style={{ height: TOR_BAR_HEIGHT }}
              initial={{ opacity: 0, y: 8 }}
              // Shown only opened: the line at rest is the purple alone
              animate={{ opacity: open ? 1 : 0, y: 0, transition: FADE_IN }}
              exit={{ opacity: 0, y: -8, transition: FADE_OUT }}
            >
              {kind === "failed" ? (
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <OnionSymbol
                  className={`size-3.5 shrink-0 ${kind === "starting" ? "animate-pulse" : ""}`}
                  aria-hidden
                />
              )}
              <span className="min-w-0 truncate">{message}</span>
              {kind === "nodeRestart" && (
                <button
                  type="button"
                  onClick={restart}
                  disabled={restarting}
                  className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-white/20 px-2.5 text-xs font-medium transition-colors hover:bg-white/30 disabled:opacity-60"
                >
                  {restarting && <Loader2 className="size-3 animate-spin" />}
                  {t("settings.save.restart")}
                </button>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
