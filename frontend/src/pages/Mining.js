import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { api, } from "../lib/api";
import { formatHashrate, formatDuration, formatDifficulty } from "../lib/format";
import SectionHeading from "../components/SectionHeading";
import AnimatedNumber from "../components/AnimatedNumber";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import { useT } from "../i18n";
export default function Mining() {
    const t = useT();
    const [cfg, setCfg] = useState(null);
    const [status, setStatus] = useState(null);
    const [nodeStatus, setNodeStatus] = useState(null);
    const [gpus, setGpus] = useState([]);
    const [pools, setPools] = useState([]);
    const isMac = navigator.userAgent.includes("Mac");
    const [selectedMode, setSelectedMode] = useState(isMac ? "solo" : "pool");
    const [err, setErr] = useState(null);
    const [starting, setStarting] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [hashwarpFound, setHashwarpFound] = useState(null); // null = loading
    const [avBlocked, setAvBlocked] = useState(false); // Windows Defender blocked hashwarp
    const isWindows = navigator.userAgent.includes("Windows");
    // Form state (kept in sync with config)
    const [wallet, setWallet] = useState("");
    const [worker, setWorker] = useState("");
    const [poolUrl, setPoolUrl] = useState("");
    const [threads, setThreads] = useState(Math.max(1, Math.floor(navigator.hardwareConcurrency / 2)) || 2);
    const [selectedDevices, setSelectedDevices] = useState([]);
    const [showCustomPool, setShowCustomPool] = useState(false);
    const [editingPoolUrl, setEditingPoolUrl] = useState(null); // url of pool being edited, null = adding new
    const [customName, setCustomName] = useState("");
    const [customUrl, setCustomUrl] = useState("");
    const [customRegion, setCustomRegion] = useState("");
    // Load config, pools, GPUs, and check hashwarp on mount
    useEffect(() => {
        api.hashwarpInstalled().then(setHashwarpFound).catch(() => setHashwarpFound(false));
        api.getConfig().then((c) => {
            setCfg(c);
            if (c.miningWallet)
                setWallet(c.miningWallet);
            if (c.miningWorker)
                setWorker(c.miningWorker);
            if (c.miningPool)
                setPoolUrl(c.miningPool);
            if (c.miningThreads > 0)
                setThreads(c.miningThreads);
            if (c.miningDevices?.length)
                setSelectedDevices(c.miningDevices);
        });
        api.defaultPools().then((dp) => {
            api.getConfig().then((c) => {
                const custom = c.customPools || [];
                setPools([...dp, ...custom]);
                if (!c.miningPool && dp.length > 0) {
                    setPoolUrl(dp[0].url);
                }
            });
        });
        api.detectGPUs().then(setGpus).catch(() => setGpus([]));
    }, []);
    // Poll miner + node status every 2s
    useEffect(() => {
        let alive = true;
        const refresh = async () => {
            const [ms, ns] = await Promise.all([
                api.minerStatus().catch(() => null),
                api.nodeStatus().catch(() => null),
            ]);
            if (!alive)
                return;
            if (ms)
                setStatus(ms);
            if (ns)
                setNodeStatus(ns);
        };
        refresh();
        const id = setInterval(refresh, 2000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, []);
    const isRunning = status?.running ?? false;
    const persistConfig = (patch) => {
        if (!cfg)
            return;
        const updated = { ...cfg, ...patch };
        setCfg(updated);
        api.updateConfig(updated).catch(() => { });
    };
    const start = async () => {
        setErr(null);
        setStarting(true);
        try {
            // Persist settings before starting
            persistConfig({
                miningWallet: wallet,
                miningWorker: worker,
                miningPool: poolUrl,
                miningThreads: threads,
                miningDevices: selectedDevices,
            });
            await api.startMining(selectedMode);
        }
        catch (e) {
            const msg = e?.message || String(e);
            // If hashwarp is missing on Windows, it was likely deleted by Defender
            if (isWindows && msg.toLowerCase().includes("hashwarp") && msg.toLowerCase().includes("not found")) {
                setHashwarpFound(false);
                setAvBlocked(true);
            }
            else {
                setErr(msg);
            }
        }
        finally {
            setStarting(false);
        }
    };
    const stop = async () => {
        setErr(null);
        setStopping(true);
        try {
            await api.stopMining();
        }
        catch (e) {
            setErr(e?.message || String(e));
        }
        finally {
            setStopping(false);
        }
    };
    const resetPoolForm = () => {
        setShowCustomPool(false);
        setEditingPoolUrl(null);
        setCustomName("");
        setCustomUrl("");
        setCustomRegion("");
    };
    const openAddPool = () => {
        setEditingPoolUrl(null);
        setCustomName("");
        setCustomUrl("");
        setCustomRegion("");
        setShowCustomPool(true);
    };
    const openEditPool = (p) => {
        setEditingPoolUrl(p.url);
        setCustomName(p.name);
        setCustomUrl(p.url);
        setCustomRegion(p.region);
        setShowCustomPool(true);
    };
    const savePool = () => {
        if (!customUrl || !customName)
            return;
        const newPool = {
            name: customName,
            url: customUrl,
            region: customRegion,
            builtin: false,
        };
        let updated;
        if (editingPoolUrl) {
            // Replace existing
            updated = pools.map((p) => !p.builtin && p.url === editingPoolUrl ? newPool : p);
        }
        else {
            // Add new
            updated = [...pools, newPool];
        }
        setPools(updated);
        setPoolUrl(customUrl);
        resetPoolForm();
        persistConfig({
            customPools: updated.filter((p) => !p.builtin),
            miningPool: customUrl,
        });
    };
    const deletePool = (url) => {
        const updated = pools.filter((p) => p.url !== url);
        setPools(updated);
        if (poolUrl === url && updated.length > 0) {
            setPoolUrl(updated[0].url);
        }
        resetPoolForm();
        persistConfig({
            customPools: updated.filter((p) => !p.builtin),
            miningPool: poolUrl === url ? updated[0]?.url || "" : poolUrl,
        });
    };
    const toggleDevice = (idx) => {
        setSelectedDevices((prev) => prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx]);
    };
    const maxThreads = navigator.hardwareConcurrency || 16;
    const nodeSynced = nodeStatus?.running && !nodeStatus?.syncing;
    return (_jsxs(PageStagger, { className: "space-y-14 max-w-5xl mx-auto", children: [_jsxs(StaggerItem, { children: [_jsx(SectionHeading, { eyebrow: t("mining.eyebrow"), title: t("mining.title"), subtitle: t("mining.subtitle") }), _jsx("p", { className: "text-muted text-sm mt-5 max-w-2xl", children: t("mining.intro") })] }), err && (_jsx(StaggerItem, { children: _jsx("div", { className: "card border-danger/40 bg-danger/10 text-danger", children: err }) })), status?.error && !err && (_jsx(StaggerItem, { children: _jsx("div", { className: "card border-danger/40 bg-danger/10 text-danger", children: status.error }) })), !isRunning && (_jsxs(StaggerItem, { children: [_jsx("div", { className: "flex gap-2 p-1 rounded-lg bg-bg-elev border border-border w-fit", children: [
                            ["pool", t("mining.mode.pool")],
                            ["sologpu", t("mining.mode.sologpu")],
                            ["solo", t("mining.mode.solo")],
                        ].map(([mode, label]) => {
                            const gpuMode = mode === "pool" || mode === "sologpu";
                            const disabled = isMac && gpuMode;
                            return (_jsx("button", { className: `px-5 py-2.5 rounded-md text-sm font-medium transition-all ${disabled
                                    ? "text-muted/40 cursor-not-allowed"
                                    : selectedMode === mode
                                        ? "bg-gold text-gold-fg shadow-sm"
                                        : "text-muted hover:text-fg"}`, onClick: () => !disabled && setSelectedMode(mode), disabled: disabled, title: disabled ? t("mining.mac.disabled") : undefined, children: label }, mode));
                        }) }), _jsxs("p", { className: "text-xs text-muted mt-3", children: [selectedMode === "pool" && t("mining.mode.pool.desc"), selectedMode === "sologpu" && t("mining.mode.sologpu.desc"), selectedMode === "solo" && t("mining.mode.solo.desc")] }), isMac && (_jsx("p", { className: "text-xs text-muted/60 mt-1", children: t("mining.mac.help") }))] })), !isRunning && (selectedMode === "pool" || selectedMode === "sologpu") && (hashwarpFound === false || avBlocked) && (_jsx(StaggerItem, { children: _jsx(HashwarpSetupGuide, { avBlocked: avBlocked, setAvBlocked: setAvBlocked, onRetry: () => {
                        setAvBlocked(false);
                        setHashwarpFound(null);
                        api.hashwarpInstalled().then((found) => {
                            setHashwarpFound(found);
                            if (found)
                                api.detectGPUs().then(setGpus).catch(() => setGpus([]));
                        }).catch(() => setHashwarpFound(false));
                    } }) })), !isRunning && !avBlocked && !((selectedMode === "pool" || selectedMode === "sologpu") && hashwarpFound === false) && (_jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-6", children: [_jsx("div", { className: "eyebrow mb-2", children: t("mining.config") }), _jsxs("div", { children: [_jsx("label", { className: "label", children: t("mining.wallet") }), _jsx("input", { type: "text", className: "input font-mono", placeholder: t("mining.ph.wallet"), value: wallet, onChange: (e) => setWallet(e.target.value) })] }), selectedMode === "pool" && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "label", children: t("mining.worker") }), _jsx("input", { type: "text", className: "input", placeholder: t("mining.ph.worker"), value: worker, onChange: (e) => setWorker(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", children: t("mining.pool") }), _jsx("select", { className: "input", value: poolUrl, onChange: (e) => setPoolUrl(e.target.value), children: pools.map((p) => (_jsxs("option", { value: p.url, children: [p.name, p.region ? ` (${p.region})` : ""] }, p.url))) }), _jsxs("div", { className: "flex items-center gap-3 mt-2", children: [_jsx("button", { className: "text-xs text-gold hover:text-gold/80 transition-colors", onClick: showCustomPool ? resetPoolForm : openAddPool, children: showCustomPool ? t("common.cancel") : t("mining.addPool") }), (() => {
                                                    const selected = pools.find((p) => p.url === poolUrl);
                                                    if (!selected || selected.builtin)
                                                        return null;
                                                    return (_jsxs(_Fragment, { children: [_jsx("button", { className: "text-xs text-muted hover:text-fg transition-colors", onClick: () => openEditPool(selected), children: t("mining.edit") }), _jsx("button", { className: "text-xs text-danger/70 hover:text-danger transition-colors", onClick: () => deletePool(selected.url), children: t("mining.remove") })] }));
                                                })()] })] }), showCustomPool && (_jsxs("div", { className: "rounded-lg border border-border bg-bg-elev p-4 space-y-3", children: [_jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("label", { className: "label", children: t("mining.poolName") }), _jsx("input", { type: "text", className: "input", placeholder: t("mining.ph.poolName"), value: customName, onChange: (e) => setCustomName(e.target.value) })] }), _jsxs("div", { children: [_jsx("label", { className: "label", children: t("mining.region") }), _jsx("input", { type: "text", className: "input", placeholder: t("mining.ph.region"), value: customRegion, onChange: (e) => setCustomRegion(e.target.value) })] })] }), _jsxs("div", { children: [_jsx("label", { className: "label", children: t("mining.stratumUrl") }), _jsx("input", { type: "text", className: "input font-mono", placeholder: t("mining.ph.stratum"), value: customUrl, onChange: (e) => setCustomUrl(e.target.value) })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { className: "btn-primary", onClick: savePool, disabled: !customName || !customUrl, children: editingPoolUrl ? t("mining.saveChanges") : t("mining.addPoolCta") }), _jsx("button", { className: "btn-ghost", onClick: resetPoolForm, children: t("common.cancel") })] })] }))] })), (selectedMode === "pool" || selectedMode === "sologpu") && (_jsxs(_Fragment, { children: [gpus.length > 0 && (_jsxs("div", { children: [_jsx("label", { className: "label", children: t("mining.gpuDevices") }), _jsx("div", { className: "space-y-2 mt-1", children: gpus.map((g) => (_jsxs("label", { className: "flex items-center gap-3 rounded-lg border border-border bg-bg-elev px-4 py-3 cursor-pointer hover:border-fg/20 transition-colors", children: [_jsx("input", { type: "checkbox", checked: selectedDevices.length === 0 ||
                                                            selectedDevices.includes(g.index), onChange: () => toggleDevice(g.index), className: "accent-gold" }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "text-sm font-medium text-fg truncate", children: ["GPU ", g.index, ": ", g.name] }), _jsxs("div", { className: "text-xs text-muted", children: [g.memory, g.cuda && " · CUDA", g.openCl && " · OpenCL"] })] })] }, g.index))) }), selectedDevices.length === 0 && (_jsx("p", { className: "text-xs text-muted mt-1", children: t("mining.gpu.allDefault") }))] })), gpus.length === 0 && (_jsx("div", { className: "rounded-lg border border-border bg-bg-elev px-4 py-3", children: _jsx("p", { className: "text-sm text-muted", children: t("mining.gpu.none") }) }))] })), (selectedMode === "sologpu" || selectedMode === "solo") && (_jsxs("div", { className: "rounded-lg border border-border bg-bg-elev px-4 py-3 flex items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: nodeSynced ? "live-dot-success" : "live-dot-err" }), _jsx("span", { className: "text-sm", children: !nodeStatus?.running
                                                ? t("mining.node.notRunning")
                                                : nodeStatus.syncing
                                                    ? t("mining.node.syncing")
                                                    : t("mining.node.ready") })] }), !nodeStatus?.running && (_jsx("button", { className: "btn-primary text-sm shrink-0", onClick: async () => {
                                        try {
                                            await api.startNode();
                                        }
                                        catch (e) {
                                            setErr(e?.message || String(e));
                                        }
                                    }, children: t("mining.startNode") }))] })), selectedMode === "solo" && (_jsxs("div", { children: [_jsxs("label", { className: "label", children: [t("mining.cpuThreads"), " (", threads, " / ", maxThreads, ")"] }), _jsx("input", { type: "range", min: 1, max: maxThreads, value: threads, onChange: (e) => setThreads(parseInt(e.target.value, 10)), className: "w-full accent-gold" })] })), _jsx("button", { className: "btn-primary", onClick: start, disabled: starting ||
                                !wallet ||
                                (selectedMode === "pool" && !poolUrl) ||
                                ((selectedMode === "sologpu" || selectedMode === "solo") && !nodeSynced), children: starting
                                ? t("mining.starting")
                                : selectedMode === "pool"
                                    ? t("mining.start.pool")
                                    : selectedMode === "sologpu"
                                        ? t("mining.start.sologpu")
                                        : t("mining.start.solo") })] }) })), isRunning && status && (_jsx(StaggerItem, { children: _jsxs("section", { className: "card-featured", children: [_jsxs("div", { className: "flex items-center justify-between mb-7", children: [_jsx("div", { className: "eyebrow", children: t("mining.liveStats") }), _jsxs("span", { className: "pill-ok", children: [_jsx("span", { className: "live-dot-success" }), status.generatingDag ? t("mining.generatingDag") : t("mining.mining")] })] }), status.generatingDag && (_jsxs("div", { className: "mb-6", children: [_jsx("div", { className: "flex justify-between eyebrow mb-3", children: _jsxs("span", { children: [t("mining.genDagEpoch"), " ", status.epoch] }) }), _jsx("div", { className: "progress-track", children: _jsx("div", { className: "progress-fill animate-pulse-soft w-full" }) })] })), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-8 mb-6", children: [_jsx(Stat, { label: t("mining.hashrate"), children: _jsx(AnimatedNumber, { value: status.hashrate, format: formatHashrate, className: "stat-value" }) }), (status.mode === "pool" || status.mode === "sologpu") && (_jsx(Stat, { label: t("mining.shares"), children: _jsxs("span", { className: "stat-value", children: [status.sharesAccepted.toLocaleString(), status.sharesRejected > 0 && (_jsxs("span", { className: "text-danger", children: ["/", status.sharesRejected] })), status.sharesFailed > 0 && (_jsxs("span", { className: "text-danger", children: ["/", status.sharesFailed, "F"] }))] }) })), status.mode === "solo" && (_jsx(Stat, { label: t("mining.difficulty"), children: _jsx("span", { className: "stat-value", children: formatDifficulty(status.soloDifficulty || "0") }) })), _jsx(Stat, { label: t("mining.uptime"), children: _jsx("span", { className: "stat-value", children: formatDuration(status.uptimeSeconds) }) }), status.mode === "pool" && (_jsx(Stat, { label: t("mining.poolLabel"), children: _jsxs("span", { className: "stat-value text-sm", children: [_jsx("span", { className: status.poolConnected
                                                    ? "live-dot-success"
                                                    : "live-dot-err" }), " ", status.poolConnected ? t("mining.connected") : t("mining.disconnected")] }) })), status.mode === "sologpu" && (_jsx(Stat, { label: t("mining.nodeLabel"), children: _jsxs("span", { className: "stat-value text-sm", children: [_jsx("span", { className: status.poolConnected
                                                    ? "live-dot-success"
                                                    : "live-dot-err" }), " ", status.poolConnected ? t("mining.connected") : t("mining.disconnected")] }) })), status.mode === "solo" && (_jsx(Stat, { label: t("mining.blocksFound"), children: _jsx("span", { className: "stat-value", children: status.soloBlocksFound.toLocaleString() }) }))] })] }) })), isRunning &&
                (status?.mode === "pool" || status?.mode === "sologpu") &&
                status?.devices &&
                status.devices.length > 0 && (_jsx(StaggerItem, { children: _jsxs("section", { className: "card space-y-4", children: [_jsx("div", { className: "eyebrow mb-2", children: t("mining.gpuDevicesStat") }), _jsx("div", { className: "grid gap-3", children: status.devices.map((d) => (_jsxs("div", { className: "flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-elev px-5 py-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "text-sm font-medium text-fg truncate", children: ["#", d.index, " ", d.name] }), _jsxs("div", { className: "text-xs text-muted mt-0.5", children: [d.mode, " \u00B7 ", d.accepted, " ", t("mining.accepted"), d.rejected > 0 && ` · ${d.rejected} ${t("mining.rejected")}`] })] }), _jsxs("div", { className: "flex items-center gap-6 text-sm shrink-0", children: [_jsx("span", { className: "font-mono text-fg", children: formatHashrate(d.hashrate) }), d.tempC > 0 && (_jsxs("span", { className: d.tempC > 80 ? "text-danger" : "text-muted", children: [d.tempC, "\u00B0C"] })), d.fanPct > 0 && (_jsxs("span", { className: "text-muted", children: [d.fanPct, "%"] })), d.powerW > 0 && (_jsxs("span", { className: "text-muted", children: [d.powerW.toFixed(0), "W"] }))] })] }, d.index))) })] }) })), isRunning && (_jsx(StaggerItem, { children: _jsx("button", { className: "btn-danger", onClick: stop, disabled: stopping, children: stopping ? t("mining.stopping") : t("mining.stop") }) }))] }));
}
function HashwarpSetupGuide({ onRetry, avBlocked, setAvBlocked }) {
    const t = useT();
    const [installing, setInstalling] = useState(false);
    const [step, setStep] = useState("");
    const [installErr, setInstallErr] = useState(null);
    const [done, setDone] = useState(false);
    const [pendingGpu, setPendingGpu] = useState(null);
    const [fixingAv, setFixingAv] = useState(false);
    const isWindows = navigator.userAgent.includes("Windows");
    // Track whether the backend flagged AV during this install attempt
    const avBlockedRef = useRef(false);
    useEffect(() => {
        const off = window.runtime.EventsOn("hashwarp-install", (data) => {
            if (data.step === "av-blocked") {
                avBlockedRef.current = true;
                setAvBlocked(true);
                return;
            }
            setStep(data.step === "finding"
                ? t("hashwarp.step.finding")
                : data.step === "downloading"
                    ? t("hashwarp.step.downloading", { detail: data.detail })
                    : data.step === "extracting"
                        ? t("hashwarp.step.extracting")
                        : data.step === "verifying"
                            ? t("hashwarp.step.verifying")
                            : data.step === "done"
                                ? t("hashwarp.step.done")
                                : data.step);
            if (data.step === "done")
                setDone(true);
        });
        return () => off();
    }, [setAvBlocked, t]);
    const install = async (gpuType) => {
        setInstalling(true);
        setInstallErr(null);
        setAvBlocked(false);
        avBlockedRef.current = false;
        setStep(t("hashwarp.step.starting"));
        setDone(false);
        setPendingGpu(gpuType);
        try {
            await api.installHashwarp(gpuType);
            setTimeout(() => onRetry(), 1000);
        }
        catch (e) {
            if (!avBlockedRef.current) {
                setInstallErr(e?.message || String(e));
            }
        }
    };
    const fixAndRetry = async () => {
        if (!pendingGpu)
            return;
        setFixingAv(true);
        try {
            await api.addDefenderExclusion();
            setAvBlocked(false);
            avBlockedRef.current = false;
            setInstalling(true);
            setInstallErr(null);
            setStep(t("hashwarp.step.starting"));
            setDone(false);
            await api.installHashwarp(pendingGpu);
            setTimeout(() => onRetry(), 1000);
        }
        catch (e) {
            if (!avBlockedRef.current) {
                setInstallErr(e?.message || String(e));
            }
        }
        finally {
            setFixingAv(false);
        }
    };
    // ── AV blocked screen ──
    if (avBlocked) {
        return (_jsxs("section", { className: "card space-y-6", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow mb-3 text-danger", children: t("hashwarp.av.eyebrow") }), _jsx("p", { className: "text-fg text-lg font-medium", children: t("hashwarp.av.title") }), _jsxs("p", { className: "text-muted mt-2 text-sm", children: [t("hashwarp.av.desc1"), " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.falsePositive") }), " ", t("hashwarp.av.desc2")] })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-lg border border-gold/30 bg-gold/5 p-4 space-y-3", children: [_jsx("div", { className: "text-sm text-fg font-medium", children: t("hashwarp.av.autoTitle") }), _jsx("p", { className: "text-xs text-muted", children: t("hashwarp.av.autoDesc") }), _jsx("button", { className: "btn-primary text-sm", onClick: fixAndRetry, disabled: fixingAv, children: fixingAv ? t("hashwarp.av.adding") : t("hashwarp.av.addAndRetry") })] }), _jsxs("div", { className: "rounded-lg border border-border bg-bg-elev p-4 space-y-3", children: [_jsx("div", { className: "text-sm text-fg font-medium", children: t("hashwarp.av.manualTitle") }), _jsxs("ol", { className: "text-xs text-muted space-y-2 list-decimal list-inside", children: [_jsxs("li", { children: [t("hashwarp.av.step1a"), " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.step1b") }), " ", t("hashwarp.av.step1c")] }), _jsxs("li", { children: [t("hashwarp.av.step2a"), " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.step2b") }), " \u2192", " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.step2c") })] }), _jsxs("li", { children: [t("hashwarp.av.step3a"), " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.step3b") }), " \u2192", " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.step3c") })] }), _jsxs("li", { children: [t("hashwarp.av.step4a"), " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.step4b") }), " \u2192", " ", t("hashwarp.av.step4c"), " ", _jsx("strong", { className: "text-fg", children: t("hashwarp.av.step4d") }), " \u2192", " ", t("hashwarp.av.step4e")] }), _jsx("li", { children: t("hashwarp.av.step5") })] }), _jsx("button", { className: "btn-ghost text-sm", onClick: () => {
                                        setAvBlocked(false);
                                        if (pendingGpu)
                                            install(pendingGpu);
                                    }, children: t("hashwarp.av.retry") })] })] }), _jsx("button", { className: "btn-ghost text-sm", onClick: () => {
                        setAvBlocked(false);
                        setInstalling(false);
                        setPendingGpu(null);
                    }, children: t("hashwarp.av.back") })] }));
    }
    // ── Installing screen ──
    if (installing) {
        return (_jsxs("section", { className: "card space-y-6", children: [_jsx("div", { className: "eyebrow", children: t("hashwarp.installing.eyebrow") }), _jsxs("div", { className: "flex items-center gap-4", children: [!done && !installErr && (_jsx("div", { className: "w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" })), done && (_jsx("div", { className: "w-5 h-5 rounded-full bg-success flex items-center justify-center text-xs text-bg font-bold", children: "\u2713" })), _jsx("span", { className: "text-fg text-sm", children: step })] }), !done && !installErr && (_jsx("div", { className: "progress-track", children: _jsx("div", { className: "progress-fill animate-pulse-soft w-full" }) })), installErr && (_jsxs("div", { className: "space-y-3", children: [_jsx("div", { className: "rounded-lg border border-danger/40 bg-danger/10 text-danger text-sm px-4 py-3", children: installErr }), _jsx("button", { className: "btn-ghost text-sm", onClick: () => setInstalling(false), children: t("hashwarp.installing.back") })] }))] }));
    }
    // ── Initial setup screen ──
    return (_jsxs("section", { className: "card space-y-6", children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow mb-3", children: t("hashwarp.setup.eyebrow") }), _jsx("p", { className: "text-fg text-lg font-medium", children: t("hashwarp.setup.title") }), _jsx("p", { className: "text-muted mt-2 text-sm", children: t("hashwarp.setup.desc") })] }), isWindows && (_jsx("div", { className: "rounded-lg border border-border bg-bg-elev px-4 py-3", children: _jsxs("p", { className: "text-xs text-muted", children: [_jsx("strong", { className: "text-fg", children: t("hashwarp.setup.winNoteBold") }), " ", t("hashwarp.setup.winNote")] }) })), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("button", { className: "group rounded-lg border border-border bg-bg-elev p-5 text-left hover:border-gold/40 hover:shadow-[0_0_30px_rgb(247_147_26/0.08)] transition-all", onClick: () => install("cuda"), children: [_jsx("div", { className: "text-fg font-medium text-base mb-1", children: "NVIDIA" }), _jsx("div", { className: "text-xs text-muted", children: t("hashwarp.setup.nvidiaSeries") }), _jsx("div", { className: "text-xs text-gold mt-3 opacity-70 group-hover:opacity-100 transition-opacity", children: t("hashwarp.setup.downloadCuda") })] }), _jsxs("button", { className: "group rounded-lg border border-border bg-bg-elev p-5 text-left hover:border-gold/40 hover:shadow-[0_0_30px_rgb(247_147_26/0.08)] transition-all", onClick: () => install("opencl"), children: [_jsx("div", { className: "text-fg font-medium text-base mb-1", children: "AMD" }), _jsx("div", { className: "text-xs text-muted", children: t("hashwarp.setup.amdSeries") }), _jsx("div", { className: "text-xs text-gold mt-3 opacity-70 group-hover:opacity-100 transition-opacity", children: t("hashwarp.setup.downloadOpenCl") })] })] }), !isWindows && (_jsxs("p", { className: "text-xs text-muted", children: [t("hashwarp.setup.linuxHintA"), " ", _jsx("code", { className: "text-fg bg-bg-elev px-1.5 py-0.5 rounded text-xs", children: "lspci | grep -i vga" }), " ", t("hashwarp.setup.linuxHintB")] })), isWindows && (_jsx("p", { className: "text-xs text-muted", children: t("hashwarp.setup.winHint") }))] }));
}
function Stat({ label, children, }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "stat-label mb-2", children: label }), children] }));
}
