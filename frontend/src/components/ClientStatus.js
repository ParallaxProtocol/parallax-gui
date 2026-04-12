import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../i18n";
const VARIANTS = {
    synced: { dot: "live-dot-success", labelKey: "status.online" },
    syncing: { dot: "live-dot-info", labelKey: "status.syncing" },
    stopped: { dot: "live-dot-err", labelKey: "status.offline" },
};
export default function ClientStatus() {
    const [kind, setKind] = useState("stopped");
    const t = useT();
    useEffect(() => {
        let alive = true;
        const refresh = async () => {
            try {
                const s = await api.nodeStatus();
                if (!alive)
                    return;
                const next = !s.running
                    ? "stopped"
                    : s.syncing
                        ? "syncing"
                        : "synced";
                setKind((prev) => (prev === next ? prev : next));
            }
            catch {
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
    return (_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx("span", { className: v.dot }), _jsx("span", { className: "eyebrow", children: t(v.labelKey) })] }));
}
