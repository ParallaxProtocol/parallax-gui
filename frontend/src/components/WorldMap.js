import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup, } from "react-simple-maps";
import { geoEqualEarth } from "d3-geo";
import worldData from "world-atlas/countries-110m.json";
import { useT } from "../i18n";
// Internal viewBox dimensions. The map scales fluidly to its container —
// these only set the projection's aspect ratio and the resolution of the
// great-circle math.
const VB_W = 980;
const VB_H = 560;
const projection = geoEqualEarth()
    .scale(190)
    .translate([VB_W / 2, VB_H / 2 + 20]);
// Connection direction colours. Match the Peers screen pills so the two
// views agree at a glance: outbound (we dialed) is success-green, inbound
// (peer dialed us) is gold. Self is the syncing-blue accent so it never
// collides with either peer direction.
const OUTBOUND_COLOR = "oklch(0.696 0.17 162.48)";
const INBOUND_COLOR = "rgb(247 147 26)";
const SELF_COLOR = "oklch(0.68 0.16 240)";
function arcPath(from, to) {
    const a = projection(from);
    const b = projection(to);
    if (!a || !b)
        return null;
    const [x1, y1] = a;
    const [x2, y2] = b;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const lift = Math.min(Math.max(dist * 0.4, 30), 220);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2 - lift;
    return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}
export default function WorldMap({ selfLoc, selfRunning, peers, publicNodes, }) {
    const containerRef = useRef(null);
    const tooltipRef = useRef(null);
    const pointerPos = useRef({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [hoveredId, setHoveredId] = useState(null);
    const greyPins = useMemo(() => {
        const occupied = new Set();
        const key = (lat, lon) => `${lat.toFixed(1)},${lon.toFixed(1)}`;
        for (const p of peers) {
            if (p.geo.lat || p.geo.lon)
                occupied.add(key(p.geo.lat, p.geo.lon));
        }
        if (selfLoc && (selfLoc.lat || selfLoc.lon)) {
            occupied.add(key(selfLoc.lat, selfLoc.lon));
        }
        return publicNodes.filter((n) => (n.lat || n.lon) && !occupied.has(key(n.lat, n.lon)));
    }, [publicNodes, peers, selfLoc]);
    // Drop the tooltip if its target pin is gone (e.g. node stopped while
    // the cursor was hovering, or a public-node refresh removed the entry).
    useEffect(() => {
        if (!hoveredId)
            return;
        if (hoveredId.kind === "peer") {
            if (!peers.some((p) => p.geo.ip === hoveredId.marker.geo.ip)) {
                setHoveredId(null);
            }
        }
        else {
            const n = hoveredId.node;
            if (!publicNodes.some((p) => p.lat === n.lat && p.lon === n.lon)) {
                setHoveredId(null);
            }
        }
    }, [peers, publicNodes, hoveredId]);
    const arcs = useMemo(() => {
        if (!selfLoc || (selfLoc.lat === 0 && selfLoc.lon === 0))
            return [];
        const from = [selfLoc.lon, selfLoc.lat];
        return peers
            .map((p) => {
            const to = [p.geo.lon, p.geo.lat];
            const d = arcPath(from, to);
            if (!d)
                return null;
            return { ip: p.geo.ip, d, inbound: !!p.peer?.inbound };
        })
            .filter((a) => a !== null);
    }, [selfLoc, peers]);
    // Per-arc random animation timings — kept stable across re-renders so
    // existing arcs don't reset their phase whenever the peer set changes.
    const arcTimings = useRef(new Map());
    const [drawnArcs, setDrawnArcs] = useState(new Set());
    const knownArcs = useRef(new Set());
    useEffect(() => {
        if (arcs.length === 0) {
            knownArcs.current = new Set();
            arcTimings.current = new Map();
            setDrawnArcs(new Set());
            return;
        }
        const fresh = [];
        for (const a of arcs) {
            if (!knownArcs.current.has(a.ip)) {
                fresh.push(a.ip);
                knownArcs.current.add(a.ip);
            }
        }
        if (fresh.length === 0)
            return;
        fresh.forEach((ip, i) => {
            setTimeout(() => {
                setDrawnArcs((prev) => new Set(prev).add(ip));
            }, i * 80);
        });
    }, [arcs]);
    // Marker visual sizes are kept roughly constant in screen-space by
    // dividing by the current zoom — without this they balloon when zoomed
    // in and become invisible when zoomed out.
    const z = Math.max(0.6, zoom);
    const peerR = 3 / z;
    const peerHitR = 11 / z;
    const selfR = 3 / z;
    const arcStroke = 0.3 / z;
    const peerHaloR = peerR * 1.5;
    const selfHaloR = selfR * 1.5;
    // Tooltip position is updated via a ref-based, rAF-throttled write to
    // the tooltip element's transform — no React state, no re-renders on
    // pointer move. Critical for hitting 120fps+ when hovering.
    const rafId = useRef(null);
    const flushPosition = () => {
        rafId.current = null;
        const el = tooltipRef.current;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!el || !rect)
            return;
        const TOOLTIP_W = 280;
        const TOOLTIP_H_EST = 160;
        const flipX = pointerPos.current.x + TOOLTIP_W + 24 > rect.width;
        const flipY = pointerPos.current.y + TOOLTIP_H_EST + 24 > rect.height;
        const left = flipX
            ? pointerPos.current.x - TOOLTIP_W - 14
            : pointerPos.current.x + 14;
        const top = flipY
            ? pointerPos.current.y - TOOLTIP_H_EST - 14
            : pointerPos.current.y + 14;
        el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    };
    const updatePointer = (clientX, clientY) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect)
            return;
        pointerPos.current.x = clientX - rect.left;
        pointerPos.current.y = clientY - rect.top;
        if (rafId.current == null) {
            rafId.current = requestAnimationFrame(flushPosition);
        }
    };
    const handlePeerEnter = (marker, e) => {
        updatePointer(e.clientX, e.clientY);
        setHoveredId({ kind: "peer", marker });
    };
    const handlePublicEnter = (node, e) => {
        updatePointer(e.clientX, e.clientY);
        setHoveredId({ kind: "public", node });
    };
    const handlePointerMove = (e) => {
        updatePointer(e.clientX, e.clientY);
    };
    const handlePointerLeave = () => {
        if (rafId.current != null) {
            cancelAnimationFrame(rafId.current);
            rafId.current = null;
        }
        setHoveredId(null);
    };
    // Flush tooltip position once when it first appears (synchronous so it
    // doesn't briefly render at the previous spot).
    useEffect(() => {
        if (hoveredId)
            flushPosition();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hoveredId]);
    useEffect(() => {
        return () => {
            if (rafId.current != null)
                cancelAnimationFrame(rafId.current);
        };
    }, []);
    // Memoise the country layer so it never re-renders on hover/zoom state
    // changes. We use vector-effect=non-scaling-stroke + a fixed style so
    // strokes stay constant in screen-space without re-styling 177 elements
    // every time the user zooms.
    const countriesEl = useMemo(() => _jsx(CountryLayer, {}), []);
    return (_jsxs("div", { ref: containerRef, className: "relative w-full h-full", children: [_jsx(ComposableMap, { projection: projection, width: VB_W, height: VB_H, style: { width: "100%", height: "100%" }, children: _jsxs(ZoomableGroup, { minZoom: 1, maxZoom: 8, onMoveEnd: ({ zoom: zz }) => setZoom(zz), ...{
                        translateExtent: [
                            [0, 0],
                            [VB_W, VB_H],
                        ],
                    }, children: [countriesEl, (() => {
                            const focusedIp = hoveredId?.kind === "peer" ? hoveredId.marker.geo.ip : null;
                            const greyOpacity = focusedIp ? 0.55 : 1;
                            return greyPins.map((n, i) => (_jsxs(Marker, { coordinates: [n.lon, n.lat], children: [_jsx("circle", { r: peerR * 0.75, fill: "oklch(0.62 0.012 265)", fillOpacity: 0.55, stroke: "oklch(0.78 0.012 265)", strokeOpacity: 0.55, strokeWidth: 0.8 / z, pointerEvents: "none", opacity: greyOpacity, style: { transition: "opacity 200ms ease-out" } }), _jsx("circle", { r: peerHitR, fill: "transparent", style: { cursor: "pointer" }, onPointerEnter: (e) => handlePublicEnter(n, e), onPointerMove: handlePointerMove, onPointerLeave: handlePointerLeave })] }, `pub-${i}`)));
                        })(), (() => {
                            const focusedIp = hoveredId?.kind === "peer" ? hoveredId.marker.geo.ip : null;
                            const dimWhenFocused = focusedIp ? 0.4 : 1;
                            return (_jsxs(_Fragment, { children: [arcs.map((a) => {
                                        const drawn = drawnArcs.has(a.ip);
                                        let timing = arcTimings.current.get(a.ip);
                                        if (!timing) {
                                            timing = {
                                                dur: 3.5 + Math.random() * 4.5,
                                                delay: -Math.random() * 6,
                                            };
                                            arcTimings.current.set(a.ip, timing);
                                        }
                                        const isFocused = focusedIp === a.ip;
                                        const baseOp = drawn ? (isFocused ? 1 : 0.4) : 0;
                                        const opacity = focusedIp && !isFocused ? dimWhenFocused : 1;
                                        return (_jsx("path", { d: a.d, fill: "none", stroke: a.inbound ? INBOUND_COLOR : OUTBOUND_COLOR, strokeOpacity: baseOp, strokeWidth: arcStroke, strokeLinecap: "round", pointerEvents: "none", className: drawn && !isFocused ? "arc-blink" : undefined, opacity: opacity, style: {
                                                transition: "stroke-opacity 250ms cubic-bezier(0.16,1,0.3,1), opacity 200ms ease-out",
                                                animationDuration: `${timing.dur}s`,
                                                animationDelay: `${timing.delay}s`,
                                            } }, a.ip));
                                    }), peers.map((p) => {
                                        const inbound = !!p.peer?.inbound;
                                        const color = inbound ? INBOUND_COLOR : OUTBOUND_COLOR;
                                        const timing = arcTimings.current.get(p.geo.ip);
                                        const drawn = drawnArcs.has(p.geo.ip);
                                        const isFocused = focusedIp === p.geo.ip;
                                        // Animate halo only when not focused — the focused
                                        // peer locks at full opacity so the highlight stays
                                        // crisp.
                                        const blink = drawn && timing != null && !isFocused;
                                        const opacity = focusedIp && !isFocused ? dimWhenFocused : 1;
                                        return (_jsxs(Marker, { coordinates: [p.geo.lon, p.geo.lat], children: [_jsxs("g", { style: {
                                                        opacity,
                                                        transition: "opacity 200ms ease-out",
                                                    }, children: [_jsx("circle", { r: peerHaloR, fill: color, fillOpacity: isFocused ? 0.45 : 0.18, pointerEvents: "none", className: blink ? "pin-blink" : undefined, style: blink
                                                                ? {
                                                                    animationDuration: `${timing.dur}s`,
                                                                    animationDelay: `${timing.delay}s`,
                                                                }
                                                                : undefined }), _jsx("circle", { r: peerR, fill: color, stroke: "oklch(0.06 0.015 265)", strokeWidth: 0.8 / z, pointerEvents: "none" })] }), _jsx("circle", { r: peerHitR, fill: "transparent", style: { cursor: "pointer" }, onPointerEnter: (e) => handlePeerEnter(p, e), onPointerMove: handlePointerMove, onPointerLeave: handlePointerLeave })] }, p.geo.ip));
                                    }), selfLoc &&
                                        (selfLoc.lat !== 0 || selfLoc.lon !== 0) &&
                                        (selfRunning ? (_jsxs(Marker, { coordinates: [selfLoc.lon, selfLoc.lat], children: [_jsx("circle", { r: selfHaloR, fill: SELF_COLOR, fillOpacity: focusedIp ? 0.45 : 0.2, pointerEvents: "none", style: { transition: "fill-opacity 200ms ease-out" } }), _jsx("circle", { r: selfR, fill: SELF_COLOR, stroke: "oklch(0.06 0.015 265)", strokeWidth: 1 / z, pointerEvents: "none" })] })) : (_jsx(Marker, { coordinates: [selfLoc.lon, selfLoc.lat], children: _jsx("circle", { r: peerR, fill: "oklch(0.65 0.012 265)", fillOpacity: 0.9, stroke: "oklch(0.06 0.015 265)", strokeWidth: 0.8 / z, pointerEvents: "none" }) })))] }));
                        })()] }) }), hoveredId && (_jsx("div", { ref: tooltipRef, className: "pointer-events-none absolute top-0 left-0 z-10 rounded border border-border-strong bg-bg-elev/95 backdrop-blur px-4 py-3 shadow-card-hover", style: {
                    width: 280,
                    transform: "translate3d(-9999px,-9999px,0)",
                    willChange: "transform",
                }, children: hoveredId.kind === "peer" ? (_jsx(ConnectedPeerBody, { marker: hoveredId.marker })) : (_jsx(PublicNodeBody, { node: hoveredId.node })) }))] }));
}
// Country layer rendered exactly once. Strokes use vector-effect so
// react-simple-maps' projection transform doesn't scale them, which lets
// us avoid recomputing strokeWidth on every zoom change.
const CountryLayer = memo(function CountryLayer() {
    return (_jsx(Geographies, { geography: worldData, children: ({ geographies }) => {
            const base = {
                fill: "oklch(0.11 0.012 265)",
                stroke: "oklch(1 0 0 / 0.07)",
                strokeWidth: 0.5,
                outline: "none",
                pointerEvents: "none",
                vectorEffect: "non-scaling-stroke",
            };
            return geographies.map((geo) => (_jsx(Geography, { geography: geo, style: { default: base, hover: base, pressed: base } }, geo.rsmKey)));
        } }));
});
function ConnectedPeerBody({ marker }) {
    const t = useT();
    const { geo, peer } = marker;
    const location = [geo.city, geo.country].filter(Boolean).join(", ") || t("worldmap.unknownLocation");
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between gap-3 mb-2", children: [_jsxs("span", { className: peer?.inbound ? "pill-warn" : "pill-ok", children: [_jsx("span", { className: peer?.inbound ? "live-dot-warn" : "live-dot-success" }), peer?.inbound ? t("peers.in") : t("peers.out")] }), _jsx("span", { className: "font-mono text-[11px] text-muted truncate", children: peer?.id || "—" })] }), _jsx("div", { className: "text-sm text-fg truncate mb-1", children: peer?.name || t("worldmap.unknownPeer") }), _jsx("div", { className: "text-xs text-muted truncate", children: location }), _jsx("div", { className: "font-mono text-[11px] text-muted truncate mt-1", children: geo.ip }), peer?.caps && peer.caps.length > 0 && (_jsx("div", { className: "font-mono text-[11px] text-muted truncate mt-2 pt-2 border-t border-border", children: peer.caps.join(", ") }))] }));
}
function PublicNodeBody({ node }) {
    const t = useT();
    const location = [node.city, node.country].filter(Boolean).join(", ") || t("worldmap.unknownLocation");
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between gap-3 mb-2", children: [_jsxs("span", { className: "pill-muted", children: [_jsx("span", { className: "live-dot-muted" }), t("worldmap.notConnected")] }), node.countryCode && (_jsx("span", { className: "font-mono text-[11px] text-muted", children: node.countryCode }))] }), _jsx("div", { className: "text-sm text-fg truncate", children: location }), _jsx("div", { className: "text-[11px] text-muted mt-1", children: t("worldmap.publicKnown") })] }));
}
