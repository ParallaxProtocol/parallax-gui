import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../lib/api";
import { useT } from "../i18n";
export default function PeersModal({ open, onClose, }) {
    const [peers, setPeers] = useState([]);
    const [expanded, setExpanded] = useState(null);
    const [filter, setFilter] = useState("all");
    const [error, setError] = useState(null);
    const t = useT();
    // Poll only while open. Closing the modal stops the 2s peer fetch
    // immediately so the dashboard isn't paying for a list nobody is
    // looking at.
    useEffect(() => {
        if (!open)
            return;
        let alive = true;
        const refresh = async () => {
            try {
                const p = await api.peers();
                if (alive)
                    setPeers(p);
            }
            catch (e) {
                if (alive)
                    setError(e?.message || String(e));
            }
        };
        refresh();
        const id = setInterval(refresh, 2000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [open]);
    // Esc to close.
    useEffect(() => {
        if (!open)
            return;
        const onKey = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);
    const filtered = peers.filter((p) => {
        if (filter === "in")
            return p.inbound;
        if (filter === "out")
            return !p.inbound;
        return true;
    });
    const inCount = peers.filter((p) => p.inbound).length;
    const outCount = peers.length - inCount;
    return (_jsx(AnimatePresence, { children: open && (_jsxs(motion.div, { className: "fixed inset-0 z-[100] flex items-center justify-center px-6 py-10", initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] }, onClick: onClose, children: [_jsx("div", { className: "absolute inset-0 bg-bg/80 backdrop-blur-sm" }), _jsxs(motion.div, { className: "relative w-full max-w-3xl max-h-full flex flex-col rounded-lg border border-border-strong bg-bg-elev shadow-card-hover", initial: { opacity: 0, y: 12, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 8, scale: 0.98 }, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] }, onClick: (e) => e.stopPropagation(), children: [_jsxs("header", { className: "flex items-start justify-between gap-4 px-7 pt-6 pb-5 border-b border-border", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow mb-1", children: t("peers.eyebrow") }), _jsx("h2", { className: "font-serif text-2xl text-fg leading-tight", children: t("peers.title") }), _jsxs("div", { className: "text-xs text-muted tabular-nums mt-1", children: [peers.length, " ", t("peers.totalStats"), " \u00B7 ", inCount, " ", t("peers.inbound"), " \u00B7 ", outCount, " ", t("peers.outbound")] })] }), _jsx("button", { type: "button", onClick: onClose, "aria-label": t("common.close"), className: "text-muted hover:text-fg transition-colors text-xl leading-none px-2 py-1", children: "\u2715" })] }), _jsxs("div", { className: "flex items-center justify-between px-7 py-4 border-b border-border", children: [_jsx("div", { className: "flex gap-2", children: ["all", "in", "out"].map((k) => (_jsx("button", { onClick: () => setFilter(k), className: `px-3.5 py-1.5 rounded text-[11px] uppercase tracking-wider transition-all duration-200 ${filter === k
                                            ? "bg-gold text-gold-fg shadow-gold-glow"
                                            : "border border-border-strong text-muted hover:text-fg hover:border-fg/30"}`, children: k === "all" ? t("peers.filter.all") : k === "in" ? t("peers.filter.in") : t("peers.filter.out") }, k))) }), _jsxs("div", { className: "text-xs text-muted tabular-nums", children: [t("peers.showing"), " ", filtered.length, " ", t("peers.of"), " ", peers.length] })] }), error && (_jsx("div", { className: "mx-7 mt-5 card border-danger/40 bg-danger/10 text-danger text-sm", children: error })), _jsx("div", { className: "flex-1 min-h-0 overflow-y-auto px-7 py-3", children: filtered.length === 0 ? (_jsx("p", { className: "text-muted text-sm py-8 text-center", children: t("peers.empty") })) : (_jsx("ul", { className: "divide-y divide-border", children: filtered.map((p) => {
                                    const isExpanded = expanded === p.fullId;
                                    return (_jsxs("li", { className: "py-4", children: [_jsxs("button", { type: "button", onClick: () => setExpanded(isExpanded ? null : p.fullId), className: "w-full flex items-center gap-4 text-left group", children: [_jsxs("span", { className: p.inbound ? "pill-warn" : "pill-ok", title: p.inbound ? t("peers.tooltip.in") : t("peers.tooltip.out"), children: [_jsx("span", { className: p.inbound
                                                                    ? "live-dot-warn"
                                                                    : "live-dot-success" }), p.inbound ? t("peers.in") : t("peers.out")] }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-baseline gap-3", children: [_jsx("span", { className: "font-mono text-xs text-fg", children: p.id }), _jsx("span", { className: "text-sm text-fg/80 truncate group-hover:text-fg transition-colors", children: p.name || t("peers.unknown") }), p.trusted && (_jsx("span", { className: "pill-ok", children: t("peers.trusted") })), p.static && (_jsx("span", { className: "pill-warn", children: t("peers.static") }))] }), _jsxs("div", { className: "font-mono text-[11px] text-muted truncate mt-0.5", children: [p.remoteAddr, " \u00B7 ", p.caps.join(", ")] })] }), _jsx(motion.span, { className: "text-muted text-xs", animate: { rotate: isExpanded ? 90 : 0 }, transition: {
                                                            duration: 0.3,
                                                            ease: [0.16, 1, 0.3, 1],
                                                        }, children: "\u25B8" })] }), _jsx(AnimatePresence, { initial: false, children: isExpanded && (_jsx(motion.div, { initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: {
                                                        duration: 0.4,
                                                        ease: [0.16, 1, 0.3, 1],
                                                    }, className: "overflow-hidden", children: _jsxs("div", { className: "mt-4 ml-12 space-y-3 text-sm", children: [_jsx(Detail, { label: t("peers.fullId"), value: p.fullId, mono: true }), _jsx(Detail, { label: t("peers.enode"), value: p.enode, mono: true, wrap: true }), _jsx(Detail, { label: t("peers.remoteAddr"), value: p.remoteAddr, mono: true }), _jsx(Detail, { label: t("peers.localAddr"), value: p.localAddr, mono: true }), _jsx(Detail, { label: t("peers.caps"), value: p.caps.join(", ") || t("peers.none"), mono: true }), p.protocols &&
                                                                Object.keys(p.protocols).length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "eyebrow mb-2", children: t("peers.protocols") }), _jsx("pre", { className: "font-mono text-[11px] text-muted bg-bg-elev-2 rounded p-3 overflow-x-auto border border-border", children: JSON.stringify(p.protocols, null, 2) })] }))] }) }, "content")) })] }, p.fullId));
                                }) })) })] }, "peers-panel")] }, "peers-backdrop")) }));
}
function Detail({ label, value, mono, wrap, }) {
    return (_jsxs("div", { className: "grid grid-cols-[140px_1fr] gap-4 items-baseline", children: [_jsx("div", { className: "eyebrow", children: label }), _jsx("div", { className: `text-fg/90 ${mono ? "font-mono text-xs" : ""} ${wrap ? "break-all" : "truncate"}`, children: value || "—" })] }));
}
