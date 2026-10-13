import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, Power } from "lucide-react";
import { api } from "../../lib/api";
import { useNode, useRefresh } from "../../lib/live";
import { useT } from "../../i18n";

const TITLES: Record<string, string> = {
  "/": "nav.overview",
  "/wallet": "nav.wallet",
  "/mining": "nav.mining",
  "/settings": "nav.settings",
};

/**
 * Toolbar is the content's title bar: the page's name, and the node's
 * power switch, the one action that matters from every page. It is the
 * window's drag area, and leaves room for the window controls.
 */
export default function Toolbar() {
  const t = useT();
  const { pathname } = useLocation();

  return (
    <header className="drag flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background pl-5">
      <h1 className="flex-1 truncate text-lg font-semibold">{t(TITLES[pathname] ?? TITLES["/"])}</h1>
      <NodeSwitch />
      <span className="w-2 shrink-0" />
      <span className="window-controls-gap" />
    </header>
  );
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
        <span className="selectable max-w-80 truncate text-sm text-critical-ink" title={err}>
          {err}
        </span>
      )}
      <button type="button" onClick={toggle} disabled={busy} className="btn btn-secondary">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className={`size-3.5 ${running ? "" : "text-brand"}`} />}
        {busy ? (running ? t("node.stopping") : t("node.starting")) : running ? t("node.stop") : t("node.start")}
      </button>
    </>
  );
}
