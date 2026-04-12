import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../lib/api";
import SectionHeading from "../../components/SectionHeading";
import { PageStagger, StaggerItem } from "../../components/PageStagger";
import Toggle from "../../components/Toggle";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { useLang, useT, LANG_NAMES } from "../../i18n";
// Fields that only take effect after a fresh node start. Touching any of
// these flips `restartPending` so we can warn the user in the save bar.
const RESTART_FIELDS = [
    "dataDir",
    "syncMode",
    "httpRpcEnabled",
    "httpRpcPort",
    "blockInbound",
    "maxPeers",
    "enableSmartFee",
    "databaseCacheMB",
    "trieCleanCacheMB",
    "trieDirtyCacheMB",
    "snapshotCacheMB",
];
export default function Settings() {
    const [cfg, setCfg] = useState(null);
    const [orig, setOrig] = useState(null);
    const [advanced, setAdvanced] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState(null);
    // Sticks around even after Save until the user restarts the node.
    const [restartPending, setRestartPending] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [appVersion, setAppVersion] = useState("");
    const [clientVersion, setClientVersion] = useState("");
    const [checking, setChecking] = useState(false);
    const [checkResult, setCheckResult] = useState(null);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [updating, setUpdating] = useState(false);
    const { lang, setLang } = useLang();
    const t = useT();
    useEffect(() => {
        api.getConfig().then((c) => {
            setCfg(c);
            setOrig(c);
        });
        api.version().then(setAppVersion).catch(() => { });
        api.clientVersion().then(setClientVersion).catch(() => { });
    }, []);
    if (!cfg)
        return null;
    const update = (patch) => setCfg({ ...cfg, ...patch });
    const dirty = !!orig && JSON.stringify(cfg) !== JSON.stringify(orig);
    // True when the *currently dirty* changes include any restart-only field.
    const dirtyNeedsRestart = !!orig && RESTART_FIELDS.some((k) => cfg[k] !== orig[k]);
    const save = async () => {
        setErr(null);
        try {
            await api.updateConfig(cfg);
            if (dirtyNeedsRestart)
                setRestartPending(true);
            setOrig(cfg);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            // Notify App so globally-applied flags (e.g. animation kill
            // switch) re-read the latest config without a reload.
            window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
        }
        catch (e) {
            setErr(e?.message || String(e));
        }
    };
    const discard = () => {
        if (orig)
            setCfg(orig);
        setErr(null);
    };
    const restartNode = async () => {
        setRestarting(true);
        setErr(null);
        try {
            await api.stopNode();
            await api.startNode();
            setRestartPending(false);
        }
        catch (e) {
            setErr(e?.message || String(e));
        }
        finally {
            setRestarting(false);
        }
    };
    return (_jsxs(PageStagger, { className: "space-y-12 max-w-3xl mx-auto", children: [_jsx(StaggerItem, { children: _jsx(SectionHeading, { eyebrow: t("settings.eyebrow"), title: t("settings.title") }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-5", children: [_jsx("div", { className: "card-title", children: t("settings.language") }), _jsx("p", { className: "text-sm text-muted leading-relaxed", children: t("settings.language.desc") }), _jsx(Field, { label: t("settings.language.label"), children: _jsx("select", { className: "input", value: lang, onChange: (e) => setLang(e.target.value), children: Object.keys(LANG_NAMES).map((l) => (_jsx("option", { value: l, children: LANG_NAMES[l] }, l))) }) })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-5", children: [_jsx("div", { className: "card-title", children: t("settings.node") }), _jsx(Field, { label: t("settings.dataDir"), children: _jsx("input", { className: "input font-mono", value: cfg.dataDir, onChange: (e) => update({ dataDir: e.target.value }) }) }), _jsx(Field, { label: t("settings.syncMode"), children: _jsxs("select", { className: "input", value: cfg.syncMode, onChange: (e) => update({ syncMode: e.target.value }), children: [_jsx("option", { value: "snap", children: t("settings.syncMode.snap") }), _jsx("option", { value: "full", children: t("settings.syncMode.full") })] }) }), _jsx(Field, { label: t("settings.maxPeers"), children: _jsx("input", { type: "number", className: "input", value: cfg.maxPeers, onChange: (e) => update({ maxPeers: parseInt(e.target.value, 10) || 0 }) }) }), _jsx(Field, { label: t("settings.autoStart"), children: _jsx(Toggle, { checked: cfg.autoStartNode, onChange: (v) => update({ autoStartNode: v }) }) })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-5", children: [_jsx("div", { className: "card-title", children: t("settings.appearance") }), _jsx("p", { className: "text-sm text-muted leading-relaxed", children: t("settings.appearance.desc") }), _jsx(Field, { label: t("settings.disableAnimations"), children: _jsx(Toggle, { checked: cfg.disableAnimations, onChange: (v) => update({ disableAnimations: v }) }) })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-5", children: [_jsx("div", { className: "card-title", children: t("settings.networking") }), _jsx("p", { className: "text-sm text-muted leading-relaxed", children: t("settings.networking.desc") }), _jsx(Field, { label: t("settings.allowInbound"), children: _jsx(Toggle, { checked: !cfg.blockInbound, onChange: (v) => update({ blockInbound: !v }) }) })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-5", children: [_jsx("div", { className: "card-title", children: t("settings.rpc.title") }), _jsx("p", { className: "text-sm text-muted leading-relaxed", children: t("settings.rpc.desc") }), _jsx(Field, { label: t("settings.rpc.enable"), children: _jsx(Toggle, { checked: cfg.httpRpcEnabled, onChange: (v) => update({ httpRpcEnabled: v }) }) }), _jsx(AnimatePresence, { initial: false, children: cfg.httpRpcEnabled && (_jsx(motion.div, { initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] }, className: "overflow-hidden", children: _jsx(Field, { label: t("settings.rpc.port"), children: _jsx("input", { type: "number", className: "input", value: cfg.httpRpcPort, onChange: (e) => update({
                                            httpRpcPort: parseInt(e.target.value, 10) || 8545,
                                        }) }) }) })) })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-5", children: [_jsx("div", { className: "card-title", children: t("settings.fee.title") }), _jsxs("p", { className: "text-sm text-muted leading-relaxed", children: [t("settings.fee.desc1a"), " ", _jsx("span", { className: "font-mono text-fg/80", children: "estimateSmartFee" }), " ", t("settings.fee.desc1b")] }), _jsxs("p", { className: "text-sm text-muted leading-relaxed", children: [_jsx("span", { className: "text-gold", children: t("settings.fee.recommended") }), " ", t("settings.fee.desc2")] }), _jsx(Field, { label: t("settings.smartFee"), children: _jsx(Toggle, { checked: cfg.enableSmartFee, onChange: (v) => update({ enableSmartFee: v }) }) })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card", children: [_jsx("div", { className: "card-title mb-4", children: t("settings.diagnostics") }), _jsxs("div", { className: "flex items-center justify-between gap-6", children: [_jsx("p", { className: "text-sm text-muted leading-relaxed max-w-md", children: t("settings.diagnostics.desc") }), _jsx(Link, { to: "/logs", className: "btn-ghost shrink-0", children: t("settings.showLogs") })] })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-3", children: [_jsx("button", { className: "btn-ghost", onClick: () => setAdvanced(!advanced), children: advanced ? t("settings.advanced.hide") : t("settings.advanced.show") }), _jsx(AnimatePresence, { initial: false, children: advanced && (_jsx(motion.div, { initial: { height: 0, opacity: 0 }, animate: { height: "auto", opacity: 1 }, exit: { height: 0, opacity: 0 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] }, className: "overflow-hidden", children: _jsxs("div", { className: "space-y-5 pt-4", children: [_jsx(Field, { label: t("settings.dbCache"), children: _jsx("input", { type: "number", className: "input", value: cfg.databaseCacheMB, onChange: (e) => update({
                                                    databaseCacheMB: parseInt(e.target.value, 10) || 0,
                                                }) }) }), _jsx(Field, { label: t("settings.trieClean"), children: _jsx("input", { type: "number", className: "input", value: cfg.trieCleanCacheMB, onChange: (e) => update({
                                                    trieCleanCacheMB: parseInt(e.target.value, 10) || 0,
                                                }) }) }), _jsx(Field, { label: t("settings.trieDirty"), children: _jsx("input", { type: "number", className: "input", value: cfg.trieDirtyCacheMB, onChange: (e) => update({
                                                    trieDirtyCacheMB: parseInt(e.target.value, 10) || 0,
                                                }) }) }), _jsx(Field, { label: t("settings.snapshotCache"), children: _jsx("input", { type: "number", className: "input", value: cfg.snapshotCacheMB, onChange: (e) => update({
                                                    snapshotCacheMB: parseInt(e.target.value, 10) || 0,
                                                }) }) })] }) })) })] }) }), _jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-5", children: [_jsx("div", { className: "card-title", children: t("settings.about") }), _jsxs("dl", { className: "grid grid-cols-3 gap-y-3 text-sm", children: [_jsx("dt", { className: "eyebrow self-center", children: t("settings.about.client") }), _jsxs("dd", { className: "col-span-2 font-mono text-fg", children: ["prlx ", clientVersion || "—"] }), _jsx("dt", { className: "eyebrow self-center", children: t("settings.about.desktop") }), _jsx("dd", { className: "col-span-2 font-mono text-fg", children: appVersion || "—" })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("button", { type: "button", className: "btn-ghost shrink-0", disabled: checking, onClick: async () => {
                                        setChecking(true);
                                        setCheckResult(null);
                                        setUpdateInfo(null);
                                        try {
                                            const info = await api.checkForUpdate();
                                            if (info) {
                                                setUpdateInfo(info);
                                                setCheckResult(t("settings.about.updateAvailable", {
                                                    version: info.latestVersion,
                                                }));
                                            }
                                            else {
                                                setCheckResult(t("settings.about.upToDate"));
                                            }
                                        }
                                        catch (e) {
                                            setCheckResult(e?.message || t("settings.about.checkFailed"));
                                        }
                                        setChecking(false);
                                    }, children: checking ? t("settings.about.checking") : t("settings.about.check") }), checkResult && (_jsx("span", { className: "text-sm text-muted", children: checkResult })), updateInfo && (_jsx("button", { type: "button", className: "btn-ghost shrink-0", disabled: updating, onClick: async () => {
                                        setUpdating(true);
                                        try {
                                            await api.applyUpdate();
                                        }
                                        catch (e) {
                                            setCheckResult(e?.message || t("settings.about.updateFailed"));
                                            setUpdating(false);
                                        }
                                    }, children: updating ? t("settings.about.updating") : t("settings.about.updateNow") }))] })] }) }), err && (_jsx(StaggerItem, { children: _jsx("div", { className: "card border-danger/40 bg-danger/10 text-danger", children: err }) })), _jsx("div", { className: "h-20" }), _jsx(FloatingSaveBar, { dirty: dirty, saved: saved, dirtyNeedsRestart: dirtyNeedsRestart, restartPending: restartPending, restarting: restarting, onSave: save, onDiscard: discard, onRestart: restartNode })] }));
}
function FloatingSaveBar({ dirty, saved, dirtyNeedsRestart, restartPending, restarting, onSave, onDiscard, onRestart, }) {
    const t = useT();
    const visible = dirty || saved || restartPending;
    return (_jsx(AnimatePresence, { children: visible && (_jsx(motion.div, { className: "fixed bottom-8 right-8 z-40 flex items-center gap-3 rounded-full border border-border-strong bg-bg-elev/95 backdrop-blur px-4 py-2.5 shadow-2xl max-w-[90vw]", initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: 20 }, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] }, children: dirty ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-col pl-1 pr-1 leading-tight", children: [_jsx("span", { className: "text-xs text-fg", children: t("settings.save.unsaved") }), dirtyNeedsRestart && (_jsx("span", { className: "text-[10px] uppercase tracking-wider text-gold", children: t("settings.save.needsRestart") }))] }), _jsx("button", { type: "button", onClick: onDiscard, className: "text-[11px] uppercase tracking-wider text-muted hover:text-fg transition-colors px-2", children: t("common.discard") }), _jsx("button", { type: "button", onClick: onSave, className: "btn-primary !py-1.5 !px-4", children: t("common.save") })] })) : restartPending ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-2 pl-1 pr-1", children: [_jsx("span", { className: "live-dot-warn" }), _jsx("span", { className: "text-xs text-fg", children: t("settings.save.restartRequired") })] }), _jsx("button", { type: "button", onClick: onRestart, disabled: restarting, className: "btn-primary !py-1.5 !px-4", children: restarting ? t("settings.save.restarting") : t("settings.save.restart") })] })) : (_jsxs("span", { className: "text-success text-sm flex items-center gap-2 px-2", children: [_jsx("span", { className: "live-dot-success" }), t("settings.save.saved")] })) }, "save-bar")) }));
}
function Field({ label, children }) {
    return (_jsxs("div", { className: "grid grid-cols-3 gap-4 items-center", children: [_jsx("label", { className: "eyebrow", children: label }), _jsx("div", { className: "col-span-2", children: children })] }));
}
