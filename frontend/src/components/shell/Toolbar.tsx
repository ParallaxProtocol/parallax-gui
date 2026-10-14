import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Power } from "lucide-react";
import { api } from "../../lib/api";
import { useNode, useRefresh } from "../../lib/live";
import { FADE_IN, FADE_OUT, GLIDE } from "../../lib/motion";
import { useT } from "../../i18n";
import { Tooltip } from "../ui/Tooltip";

const TITLES: Record<string, string> = {
  "/": "nav.account",
  "/connect": "nav.connect",
  "/node": "nav.node",
  "/settings": "nav.settings",
};

/**
 * Toolbar is the content's title bar: the page's name, and the node's
 * power switch, the one action that matters from every page. It is the
 * window's drag area, and leaves room for the window controls. Its
 * separator shows only once content scrolls beneath it, as on macOS.
 */
export default function Toolbar() {
  const t = useT();
  const { pathname } = useLocation();
  const scrolled = useScrolled(pathname);

  return (
    <header
      className={`drag relative z-10 flex h-11 shrink-0 items-center gap-3 border-b bg-background pl-5 transition-[border-color,box-shadow] duration-200 ${
        scrolled ? "border-border shadow-[0_6px_16px_-12px_rgb(0_0_0/40%)]" : "border-transparent"
      }`}
    >
      <div className="relative h-7 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.h1
            key={pathname}
            className="absolute inset-0 flex items-center truncate text-lg font-semibold"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: FADE_IN }}
            exit={{ opacity: 0, y: -8, transition: FADE_OUT }}
          >
            {t(TITLES[pathname] ?? TITLES["/"])}
          </motion.h1>
        </AnimatePresence>
      </div>
      <NodeSwitch />
      <span className="w-2 shrink-0" />
      <span className="window-controls-gap" />
    </header>
  );
}

/** Whether any scroll container of the page is scrolled from its top; reset on navigation. */
function useScrolled(pathname: string) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    setScrolled(false);
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLElement && el.closest("main")) setScrolled(el.scrollTop > 2);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [pathname]);
  return scrolled;
}

function NodeSwitch() {
  const t = useT();
  const node = useNode();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const running = !!node?.running;

  const toggle = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (running) await api.stopNode();
      else await api.startNode();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!node) return null;
  return (
    <>
      {err && (
        <Tooltip content={err} overflowOnly>
          <span className="selectable max-w-80 truncate text-sm text-critical-ink">{err}</span>
        </Tooltip>
      )}
      <motion.button layout transition={GLIDE} type="button" onClick={toggle} disabled={busy} className="btn btn-secondary overflow-hidden">
        <motion.span layout="position" className="grid place-items-center">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className={`size-3.5 ${running ? "" : "text-brand"}`} />}
        </motion.span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={busy ? "busy" : running ? "stop" : "start"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={GLIDE}
          >
            {busy ? (running ? t("node.stopping") : t("node.starting")) : running ? t("node.stop") : t("node.start")}
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </>
  );
}
