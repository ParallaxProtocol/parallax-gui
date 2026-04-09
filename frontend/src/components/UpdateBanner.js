import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, openExternal } from "../lib/api";
export default function UpdateBanner() {
    const [state, setState] = useState({ kind: "hidden" });
    const infoRef = useRef(null);
    // Check for updates on mount.
    useEffect(() => {
        let cancelled = false;
        const check = () => {
            api.getLatestUpdate().then((info) => {
                if (cancelled)
                    return;
                if (info) {
                    infoRef.current = info;
                    setState({ kind: "available", info });
                }
            }).catch(() => { });
        };
        check();
        // Re-check periodically (in case the background check found something).
        const id = setInterval(check, 60_000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);
    // Subscribe to update-progress events from the backend.
    useEffect(() => {
        if (!window.runtime?.EventsOn)
            return;
        const unsub = window.runtime.EventsOn("update-progress", (p) => {
            const info = infoRef.current;
            if (!info)
                return;
            switch (p.step) {
                case "downloading":
                    setState({ kind: "downloading", info, percent: p.percent });
                    break;
                case "verifying":
                    setState({ kind: "verifying", info });
                    break;
                case "extracting":
                    setState({ kind: "extracting", info });
                    break;
                case "ready":
                    setState({ kind: "ready", info });
                    break;
                case "error":
                    setState({ kind: "error", info, message: p.detail });
                    break;
            }
        });
        return unsub;
    }, []);
    const handleUpdate = () => {
        api.applyUpdate().catch((err) => {
            const info = infoRef.current;
            if (info) {
                setState({ kind: "error", info, message: String(err) });
            }
        });
    };
    const handleDismiss = () => {
        api.dismissUpdate().catch(() => { });
        setState({ kind: "hidden" });
    };
    const handleRestart = () => {
        api.restartApp().catch(() => { });
    };
    const handleRetry = () => {
        const info = infoRef.current;
        if (info) {
            setState({ kind: "available", info });
        }
    };
    const visible = state.kind !== "hidden";
    return (_jsx(AnimatePresence, { children: visible && (_jsxs(motion.div, { className: "fixed bottom-8 left-8 z-40 flex items-center gap-3 rounded-full border border-border-strong bg-bg-elev/95 backdrop-blur px-4 py-2.5 shadow-2xl max-w-[90vw]", initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 20 }, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] }, children: [state.kind === "available" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-2 pl-1 pr-1", children: [_jsx("span", { className: "live-dot-warn" }), _jsxs("span", { className: "text-xs text-fg", children: ["Update available:", " ", _jsxs("span", { className: "text-gold font-medium", children: ["v", state.info.latestVersion] })] })] }), _jsx("button", { type: "button", onClick: () => openExternal(state.info.releaseURL), className: "text-[11px] uppercase tracking-wider text-muted hover:text-fg transition-colors px-1", children: "Notes" }), _jsx("button", { type: "button", onClick: handleUpdate, className: "btn-primary !py-1.5 !px-4", children: "Update" }), _jsx("button", { type: "button", onClick: handleDismiss, className: "text-muted hover:text-fg transition-colors px-1 text-sm leading-none", "aria-label": "Dismiss", children: "\u00D7" })] })), state.kind === "downloading" && (_jsx(_Fragment, { children: _jsxs("div", { className: "flex items-center gap-3 pl-1 pr-1 min-w-[180px]", children: [_jsxs("span", { className: "text-xs text-fg whitespace-nowrap", children: ["Downloading v", state.info.latestVersion] }), _jsx("div", { className: "flex-1 progress-track !h-1", children: _jsx("div", { className: "progress-fill", style: { width: `${state.percent}%` } }) }), _jsxs("span", { className: "text-xs text-muted tabular-nums w-8 text-right", children: [state.percent, "%"] })] }) })), state.kind === "verifying" && (_jsxs("div", { className: "flex items-center gap-2 pl-1 pr-1", children: [_jsx("span", { className: "live-dot-warn" }), _jsx("span", { className: "text-xs text-fg", children: "Verifying integrity..." })] })), state.kind === "extracting" && (_jsxs("div", { className: "flex items-center gap-2 pl-1 pr-1", children: [_jsx("span", { className: "live-dot-warn" }), _jsx("span", { className: "text-xs text-fg", children: "Installing update..." })] })), state.kind === "ready" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-2 pl-1 pr-1", children: [_jsx("span", { className: "live-dot-success" }), _jsxs("span", { className: "text-xs text-fg", children: ["v", state.info.latestVersion, " installed"] })] }), _jsx("button", { type: "button", onClick: handleRestart, className: "btn-primary !py-1.5 !px-4", children: "Restart now" })] })), state.kind === "error" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-2 pl-1 pr-1", children: [_jsx("span", { className: "live-dot-err" }), _jsx("span", { className: "text-xs text-danger max-w-[260px] truncate", children: state.message })] }), _jsx("button", { type: "button", onClick: handleRetry, className: "text-[11px] uppercase tracking-wider text-muted hover:text-fg transition-colors px-2", children: "Retry" }), _jsx("button", { type: "button", onClick: handleDismiss, className: "text-muted hover:text-fg transition-colors px-1 text-sm leading-none", "aria-label": "Dismiss", children: "\u00D7" })] }))] }, "update-banner")) }));
}
