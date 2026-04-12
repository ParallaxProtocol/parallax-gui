import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../i18n";

/**
 * ClientStatus is the live client-state indicator that lives in the TopBar.
 *
 * It polls node status on its own short interval (independent of any page)
 * so the badge stays accurate as you navigate around the app. Three states:
 *
 *   ● Online     (green pulse) — node running and synced
 *   ● Syncing    (blue pulse)
 *   ● Offline    (red, no pulse) — node not running
 */
type Kind = "synced" | "syncing" | "stopped";

const VARIANTS: Record<Kind, { dot: string; labelKey: string }> = {
  synced: { dot: "live-dot-success", labelKey: "status.online" },
  syncing: { dot: "live-dot-info", labelKey: "status.syncing" },
  stopped: { dot: "live-dot-err", labelKey: "status.offline" },
};

export default function ClientStatus() {
  const [kind, setKind] = useState<Kind>("stopped");
  const t = useT();

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const s = await api.nodeStatus();
        if (!alive) return;
        const next: Kind = !s.running
          ? "stopped"
          : s.syncing
          ? "syncing"
          : "synced";
        setKind((prev) => (prev === next ? prev : next));
      } catch {
        /* swallow — the dashboard surfaces real errors */
      }
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const v = VARIANTS[kind];
  return (
    <div className="flex items-center gap-2.5">
      <span className={v.dot} />
      <span className="eyebrow">{t(v.labelKey)}</span>
    </div>
  );
}
