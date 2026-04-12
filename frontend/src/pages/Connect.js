import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api, openExternal } from "../lib/api";
import { useWalletStatus } from "../lib/useWalletStatus";
import SectionHeading from "../components/SectionHeading";
import { PageStagger, StaggerItem } from "../components/PageStagger";
import { useT } from "../i18n";
export default function Connect() {
    const [status, setStatus] = useState(null);
    const [helperURL, setHelperURL] = useState("");
    const [copied, setCopied] = useState(false);
    const wallet = useWalletStatus();
    const t = useT();
    useEffect(() => {
        let alive = true;
        const refresh = async () => {
            try {
                const s = await api.nodeStatus();
                if (alive)
                    setStatus(s);
            }
            catch {
                /* swallow */
            }
        };
        refresh();
        const id = setInterval(refresh, 4000);
        api.metaMaskHelperURL().then((u) => alive && setHelperURL(u)).catch(() => { });
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, []);
    const copyEndpoint = async () => {
        if (!status?.rpcEndpoint)
            return;
        await navigator.clipboard.writeText(status.rpcEndpoint);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    const enabled = !!status?.running && !!status?.rpcEndpoint;
    return (_jsxs(PageStagger, { className: "space-y-12 max-w-3xl mx-auto", children: [_jsx(StaggerItem, { children: _jsx(SectionHeading, { eyebrow: t("connect.eyebrow"), title: t("connect.title"), subtitle: t("connect.subtitle") }) }), enabled && wallet.connected && (_jsx(StaggerItem, { children: _jsx("div", { className: "card border-success/40 bg-success/10", children: _jsxs("div", { className: "flex items-start gap-4", children: [_jsx("span", { className: "live-dot-success mt-2" }), _jsxs("div", { children: [_jsx("div", { className: "eyebrow text-success mb-1", children: t("connect.connected") }), _jsx("p", { className: "text-sm text-fg leading-relaxed", children: t("connect.connected.desc") })] })] }) }) })), !enabled && (_jsx(StaggerItem, { children: _jsxs("div", { className: "card border-gold/40 bg-gold-muted text-fg", children: [_jsx("div", { className: "eyebrow mb-2", children: t("connect.notAvailable") }), _jsx("p", { className: "text-sm text-fg/80 leading-relaxed", children: status?.running
                                ? t("connect.rpcDisabled")
                                : t("connect.nodeStopped") })] }) })), enabled && (_jsx(StaggerItem, { children: _jsxs("section", { className: "card-featured", children: [_jsx("div", { className: "eyebrow mb-3", children: t("connect.oneClick") }), _jsx("h2", { className: "display-sm mb-3", children: t("connect.addTitle") }), _jsx("p", { className: "text-muted leading-relaxed mb-6 max-w-lg", children: t("connect.addDesc") }), _jsx("button", { className: "btn-primary", disabled: !helperURL, onClick: () => helperURL && openExternal(helperURL), children: t("connect.addCta") }), _jsx("p", { className: "text-xs text-muted mt-5 leading-relaxed", children: t("connect.noMetaMask") })] }) })), enabled && (_jsx(StaggerItem, { children: _jsxs("section", { className: "card", children: [_jsx("div", { className: "eyebrow mb-6", children: t("connect.manualSetup") }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6", children: [_jsx(Field, { label: t("connect.rpcUrl"), children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("code", { className: "font-mono text-sm text-fg", children: status.rpcEndpoint }), _jsx("button", { onClick: copyEndpoint, className: "link-arrow", children: copied ? t("common.copied") : t("common.copy") })] }) }), _jsx(Field, { label: t("connect.chainId"), children: _jsx("code", { className: "font-mono text-sm text-fg", children: status.chainId }) }), _jsx(Field, { label: t("connect.currency"), children: _jsx("code", { className: "font-mono text-sm text-fg", children: "LAX" }) }), _jsx(Field, { label: t("connect.networkName"), children: _jsx("code", { className: "font-mono text-sm text-fg", children: "Parallax" }) })] }), _jsxs("p", { className: "text-xs text-muted mt-7 leading-relaxed", children: [t("connect.loopbackPrefix"), " ", _jsx("span", { className: "font-mono", children: "127.0.0.1" }), " ", t("connect.loopbackNote")] })] }) }))] }));
}
function Field({ label, children }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "eyebrow mb-1.5", children: label }), _jsx("div", { children: children })] }));
}
