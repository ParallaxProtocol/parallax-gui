import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useT } from "../i18n";
// Connection direction colours. Match the Peers screen pills so the views
// agree at a glance: outbound (we dialed) is success-green, inbound (peer
// dialed us) is gold. Self is the syncing-blue accent so it never collides
// with either peer direction.
export const OUTBOUND_COLOR = "oklch(0.696 0.17 162.48)";
export const INBOUND_COLOR = "rgb(247 147 26)";
export const SELF_COLOR = "oklch(0.68 0.16 240)";
export function ConnectedPeerBody({ marker }) {
    const t = useT();
    const { geo, peer } = marker;
    const location = [geo.city, geo.country].filter(Boolean).join(", ") || t("worldmap.unknownLocation");
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between gap-3 mb-2", children: [_jsxs("span", { className: peer?.inbound ? "pill-warn" : "pill-ok", children: [_jsx("span", { className: peer?.inbound ? "live-dot-warn" : "live-dot-success" }), peer?.inbound ? t("peers.in") : t("peers.out")] }), _jsx("span", { className: "font-mono text-[11px] text-muted truncate", children: peer?.id || "—" })] }), _jsx("div", { className: "text-sm text-fg truncate mb-1", children: peer?.name || t("worldmap.unknownPeer") }), _jsx("div", { className: "text-xs text-muted truncate", children: location }), _jsx("div", { className: "font-mono text-[11px] text-muted truncate mt-1", children: geo.ip }), peer?.caps && peer.caps.length > 0 && (_jsx("div", { className: "font-mono text-[11px] text-muted truncate mt-2 pt-2 border-t border-border", children: peer.caps.join(", ") }))] }));
}
export function PublicNodeBody({ node }) {
    const t = useT();
    const location = [node.city, node.country].filter(Boolean).join(", ") || t("worldmap.unknownLocation");
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between gap-3 mb-2", children: [_jsxs("span", { className: "pill-muted", children: [_jsx("span", { className: "live-dot-muted" }), t("worldmap.notConnected")] }), node.countryCode && (_jsx("span", { className: "font-mono text-[11px] text-muted", children: node.countryCode }))] }), _jsx("div", { className: "text-sm text-fg truncate", children: location }), _jsx("div", { className: "text-[11px] text-muted mt-1", children: t("worldmap.publicKnown") })] }));
}
