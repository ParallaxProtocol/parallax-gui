import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../lib/api";
import Toggle from "../../components/Toggle";
import { useLang, useT, LANG_NAMES } from "../../i18n";
import logo from "../../assets/logo.svg";
const STEPS = [
    "language",
    "welcome",
    "datadir",
    "syncmode",
    "networking",
    "rpc",
    "starting",
];
export default function Onboarding({ onFinished }) {
    const [cfg, setCfg] = useState(null);
    const [step, setStep] = useState("language");
    const [error, setError] = useState(null);
    const { lang, setLang } = useLang();
    const t = useT();
    useEffect(() => {
        api.getConfig().then(setCfg);
    }, []);
    if (!cfg)
        return null;
    const update = (patch) => setCfg({ ...cfg, ...patch });
    const finish = async () => {
        setStep("starting");
        setError(null);
        try {
            await api.saveBootstrap(cfg);
            await api.startNode();
            onFinished();
        }
        catch (e) {
            setError(e?.message || String(e));
            setStep("rpc");
        }
    };
    const stepIndex = STEPS.indexOf(step);
    return (_jsxs("div", { className: "h-full grid place-items-center p-8 relative overflow-hidden", children: [_jsx("div", { className: "absolute inset-0 pointer-events-none", children: _jsx("div", { className: "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full", style: {
                        background: "radial-gradient(circle, rgb(247 147 26 / 0.10), transparent 60%)",
                    } }) }), _jsxs("div", { className: "w-full max-w-2xl relative", children: [_jsxs(motion.div, { className: "flex flex-col items-center gap-4 mb-12", initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] }, children: [_jsx(motion.img, { src: logo, className: "h-16 w-16", alt: "Parallax", initial: { scale: 0.8, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } }), _jsx(motion.span, { className: "block h-[2px] w-10 bg-gold rounded-full", initial: { scaleX: 0 }, animate: { scaleX: 1 }, transition: { duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] } }), _jsx("div", { className: "eyebrow", children: t("onboarding.welcome") }), _jsx("h1", { className: "display text-center", children: t("onboarding.brand") })] }), step !== "starting" && (_jsx("div", { className: "flex justify-center gap-2 mb-6", children: STEPS.slice(0, -1).map((s, i) => (_jsx(motion.span, { className: "h-1 rounded-full", animate: {
                                width: i === stepIndex ? 24 : 8,
                                backgroundColor: i <= stepIndex
                                    ? "rgb(247 147 26)"
                                    : "oklch(1 0 0 / 0.15)",
                            }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }, s))) })), error && (_jsx(motion.div, { className: "card border-danger/40 bg-danger/10 text-danger mb-4", initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, children: error })), _jsx(AnimatePresence, { mode: "wait", children: _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -12 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] }, children: [step === "language" && (_jsxs("div", { className: "card space-y-5", children: [_jsx("h2", { className: "display-sm", children: t("onboarding.language.title") }), _jsx("p", { className: "text-muted leading-relaxed", children: t("onboarding.language.desc") }), _jsx("div", { className: "space-y-3", children: Object.keys(LANG_NAMES).map((l) => {
                                                const selected = lang === l;
                                                return (_jsx("button", { type: "button", onClick: () => setLang(l), className: `text-left rounded border p-4 w-full transition-all duration-300 ${selected
                                                        ? "border-gold bg-gold-muted shadow-gold-glow"
                                                        : "border-border hover:bg-bg-elev hover:border-fg/20"}`, children: _jsx("div", { className: "font-medium", children: LANG_NAMES[l] }) }, l));
                                            }) }), _jsx("div", { className: "flex justify-end", children: _jsx("button", { className: "btn-primary", onClick: () => setStep("welcome"), children: t("common.continue") }) })] })), step === "welcome" && (_jsxs("div", { className: "card space-y-5", children: [_jsx("h2", { className: "display-sm", children: t("onboarding.welcome.title") }), _jsx("p", { className: "text-muted leading-relaxed", children: t("onboarding.welcome.desc") }), _jsxs("div", { className: "flex justify-between", children: [_jsx("button", { className: "btn-ghost", onClick: () => setStep("language"), children: t("common.back") }), _jsx("button", { className: "btn-primary", onClick: () => setStep("datadir"), children: t("onboarding.welcome.cta") })] })] })), step === "datadir" && (_jsxs("div", { className: "card space-y-5", children: [_jsx("h2", { className: "display-sm", children: t("onboarding.datadir.title") }), _jsx("p", { className: "text-muted text-sm leading-relaxed", children: t("onboarding.datadir.desc") }), _jsx("input", { className: "input font-mono", value: cfg.dataDir, onChange: (e) => update({ dataDir: e.target.value }) }), _jsxs("div", { className: "flex justify-between", children: [_jsx("button", { className: "btn-ghost", onClick: () => setStep("welcome"), children: t("common.back") }), _jsx("button", { className: "btn-primary", onClick: () => setStep("syncmode"), children: t("common.continue") })] })] })), step === "syncmode" && (_jsxs("div", { className: "card space-y-5", children: [_jsx("h2", { className: "display-sm", children: t("onboarding.syncmode.title") }), _jsx(SyncOption, { k: "snap", title: t("onboarding.syncmode.snap.title"), desc: t("onboarding.syncmode.snap.desc"), cfg: cfg, update: update }), _jsx(SyncOption, { k: "full", title: t("onboarding.syncmode.full.title"), desc: t("onboarding.syncmode.full.desc"), cfg: cfg, update: update }), _jsxs("div", { className: "flex justify-between pt-2", children: [_jsx("button", { className: "btn-ghost", onClick: () => setStep("datadir"), children: t("common.back") }), _jsx("button", { className: "btn-primary", onClick: () => setStep("networking"), children: t("common.continue") })] })] })), step === "networking" && (_jsxs("div", { className: "card space-y-5", children: [_jsx("h2", { className: "display-sm", children: t("onboarding.networking.title") }), _jsx("p", { className: "text-muted leading-relaxed", children: t("onboarding.networking.desc") }), _jsx("p", { className: "text-muted text-sm leading-relaxed", children: t("onboarding.networking.desc2") }), _jsxs("div", { className: "flex items-center justify-between rounded border border-border bg-bg-elev-2 px-4 py-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-sm text-fg", children: t("onboarding.networking.toggle") }), _jsx("div", { className: "text-xs text-muted", children: t("onboarding.networking.recommended") })] }), _jsx(Toggle, { checked: !cfg.blockInbound, onChange: (v) => update({ blockInbound: !v }) })] }), _jsxs("div", { className: "flex justify-between pt-2", children: [_jsx("button", { className: "btn-ghost", onClick: () => setStep("syncmode"), children: t("common.back") }), _jsx("button", { className: "btn-primary", onClick: () => setStep("rpc"), children: t("common.continue") })] })] })), step === "rpc" && (_jsxs("div", { className: "card space-y-5", children: [_jsx("div", { className: "eyebrow", children: t("onboarding.rpc.eyebrow") }), _jsx("h2", { className: "display-sm", children: t("onboarding.rpc.title") }), _jsxs("p", { className: "text-muted leading-relaxed", children: [t("onboarding.rpc.desc1"), " ", _jsxs("span", { className: "font-mono text-fg", children: ["http://127.0.0.1:", cfg.httpRpcPort] }), " ", t("onboarding.rpc.desc2")] }), _jsx("p", { className: "text-muted text-sm leading-relaxed", children: t("onboarding.rpc.desc3") }), _jsxs("div", { className: "flex justify-between pt-2", children: [_jsx("button", { className: "btn-ghost", onClick: () => setStep("networking"), children: t("common.back") }), _jsx("button", { className: "btn-primary", onClick: finish, children: t("onboarding.rpc.cta") })] })] })), step === "starting" && (_jsxs("div", { className: "card text-center py-16", children: [_jsx(motion.div, { className: "mx-auto h-12 w-12 rounded-full border-2 border-border-strong border-t-gold mb-6", animate: { rotate: 360 }, transition: { duration: 1.2, repeat: Infinity, ease: "linear" } }), _jsx("div", { className: "display-sm", children: t("onboarding.starting.title") }), _jsx("p", { className: "text-muted text-sm mt-3", children: t("onboarding.starting.desc") })] }))] }, step) })] })] }));
}
function SyncOption({ k, title, desc, cfg, update, }) {
    const selected = cfg.syncMode === k;
    return (_jsxs("button", { type: "button", onClick: () => update({ syncMode: k }), className: `text-left rounded border p-4 w-full transition-all duration-300 ${selected
            ? "border-gold bg-gold-muted shadow-gold-glow"
            : "border-border hover:bg-bg-elev hover:border-fg/20"}`, children: [_jsx("div", { className: "font-medium", children: title }), _jsx("div", { className: "text-sm text-muted", children: desc })] }));
}
