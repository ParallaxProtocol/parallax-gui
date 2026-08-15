import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { CanvasTexture, MeshPhongMaterial, SRGBColorSpace } from "three";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldData from "world-atlas/countries-110m.json";
import { webglSoftwareRenderer } from "../lib/webgl";
import { ConnectedPeerBody, PublicNodeBody } from "./MapShared";
import { useT } from "../i18n";
// three.js can't parse oklch() strings, so the globe uses sRGB
// equivalents of the shared MapShared colours:
//   OUTBOUND oklch(0.696 0.17 162.48) ≈ #10b981
//   INBOUND  rgb(247 147 26)          = #f7931a
//   SELF     oklch(0.68 0.16 240)     ≈ #0ea5e9
const OUTBOUND_RGB = "16, 185, 129";
const INBOUND_RGB = "247, 147, 26";
const SELF_RGB = "14, 165, 233";
const PUBLIC_RGB = "142, 145, 155"; // ≈ oklch(0.62 0.012 265)
// Ocean sits just above the page background (oklch(0.06 0.015 265));
// landmasses are drawn as a grid of subtle dots rather than filled
// country shapes — no borders, just the continents' silhouettes.
const OCEAN_COLOR = "#0b0e16";
const DOT_COLOR = "rgba(255, 255, 255, 0.16)";
const DOT_SPACING_DEG = 1.1; // angular gap between dots at the equator
const DOT_RADIUS_FRAC = 0.34; // dot radius as a fraction of the spacing
// TopoJSON → GeoJSON once at module load; static data.
const COUNTRIES = feature(worldData, worldData.objects.countries).features;
// True when the WebGL context is known to be CPU-rasterised. Drives a
// cheaper quality preset up front: 1x pixel ratio, no MSAA, smaller globe
// texture, coarser point meshes. Note this sniff cannot detect software
// rendering on WebKitGTK — it masks the renderer string as "Apple GPU" —
// so the FPS watchdog below also adapts quality from measured framerate.
const LOW_POWER = webglSoftwareRenderer();
// The landmass is baked once into an equirectangular canvas texture
// (dotted-globe style: continents as an even grid of dots, no borders)
// instead of live polygon geometry — 177 tessellated meshes re-transformed
// every frame was the single largest per-frame cost, while a textured
// sphere is one draw call. Canvas 2D antialiases the dots for free, which
// matters when MSAA is off.
function buildGlobeTexture() {
    // Land containment is answered from a rasterised mask — O(1) per dot,
    // vs running spherical point-in-polygon against 177 multipolygons for
    // each of the ~40k grid samples.
    const MW = 2048;
    const MH = 1024;
    const mask = document.createElement("canvas");
    mask.width = MW;
    mask.height = MH;
    const mctx = mask.getContext("2d", { willReadFrequently: true });
    const mproj = geoEquirectangular()
        .scale(MW / (2 * Math.PI))
        .translate([MW / 2, MH / 2]);
    const mpath = geoPath(mproj, mctx);
    mctx.fillStyle = "#fff";
    mctx.beginPath();
    mpath({ type: "FeatureCollection", features: COUNTRIES });
    mctx.fill();
    const land = mctx.getImageData(0, 0, MW, MH).data;
    const isLand = (lat, lng) => {
        const x = Math.min(MW - 1, Math.max(0, Math.round(((lng + 180) / 360) * MW)));
        const y = Math.min(MH - 1, Math.max(0, Math.round(((90 - lat) / 180) * MH)));
        return land[(y * MW + x) * 4 + 3] > 128;
    };
    const W = LOW_POWER ? 2048 : 4096;
    const H = W / 2;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = OCEAN_COLOR;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = DOT_COLOR;
    // Rows step by a fixed latitude; the longitude step widens by 1/cos(lat)
    // so dots stay evenly spaced ON THE SPHERE (a uniform lat/lng grid would
    // bunch at the poles). Dots are drawn as ellipses stretched by the same
    // factor because the equirectangular texture compresses horizontally
    // toward the poles. Alternate rows are offset for hex-like packing.
    const r = (W / 360) * DOT_SPACING_DEG * DOT_RADIUS_FRAC;
    let row = 0;
    for (let lat = -85; lat <= 85; lat += DOT_SPACING_DEG, row++) {
        const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
        const lngStep = DOT_SPACING_DEG / cos;
        const offset = row % 2 === 0 ? 0 : lngStep / 2;
        for (let lng = -180 + offset; lng < 180; lng += lngStep) {
            if (!isLand(lat, lng))
                continue;
            const x = ((lng + 180) / 360) * W;
            const y = ((90 - lat) / 180) * H;
            ctx.beginPath();
            ctx.ellipse(x, y, Math.min(r / cos, r * 4), r, 0, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
}
// Every connection renders as TWO entries in the arcs layer: a permanent
// solid line ("base") and a small bright dot cycling along it
// ("particle"). Arc geometry runs in traffic direction — outbound
// self→peer, inbound peer→self — so particles flow the right way.
//
// The particle is an arc dash whose length is normalised by the arc's
// great-circle span, keeping its absolute size constant (≈ the tube
// diameter) on short and long connections alike — so it reads as a
// little glowing sphere rather than a streak.
const PARTICLE_DOT_DEG = 0.9; // particle length in great-circle degrees
const PARTICLE_STROKE = 0.5;
function centralAngleDeg(a) {
    const rad = Math.PI / 180;
    const p1 = a.startLat * rad;
    const p2 = a.endLat * rad;
    const dl = (a.endLng - a.startLng) * rad;
    const cosd = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
    return Math.acos(Math.min(1, Math.max(-1, cosd))) / rad;
}
export default function NetworkGlobe({ selfLoc, selfRunning, peers, publicNodes, onPerformancePoor, }) {
    const containerRef = useRef(null);
    const tooltipRef = useRef(null);
    const pointerPos = useRef({ x: 0, y: 0 });
    const globeRef = useRef();
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [hovered, setHovered] = useState(null);
    // Track the container size — react-globe.gl needs explicit pixel
    // dimensions and the map area is not the full window (top bar).
    useEffect(() => {
        const el = containerRef.current;
        if (!el)
            return;
        const ro = new ResizeObserver((entries) => {
            const r = entries[0].contentRect;
            setSize({ w: Math.round(r.width), h: Math.round(r.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // Same background-layer dedup as the flat map: hide public pins that
    // share a rounded coordinate with a connected peer or ourselves.
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
    const points = useMemo(() => {
        const out = greyPins.map((n) => ({
            kind: "public",
            lat: n.lat,
            lng: n.lon,
            node: n,
        }));
        for (const p of peers) {
            out.push({ kind: "peer", lat: p.geo.lat, lng: p.geo.lon, marker: p });
        }
        if (selfLoc && (selfLoc.lat !== 0 || selfLoc.lon !== 0)) {
            out.push({
                kind: "self",
                lat: selfLoc.lat,
                lng: selfLoc.lon,
                running: selfRunning,
            });
        }
        return out;
    }, [greyPins, peers, selfLoc, selfRunning]);
    const arcs = useMemo(() => {
        if (!selfLoc || (selfLoc.lat === 0 && selfLoc.lon === 0))
            return [];
        return peers.flatMap((p) => {
            const inbound = !!p.peer?.inbound;
            const self = { lat: selfLoc.lat, lng: selfLoc.lon };
            const peer = { lat: p.geo.lat, lng: p.geo.lon };
            const from = inbound ? peer : self;
            const to = inbound ? self : peer;
            const common = {
                ip: p.geo.ip,
                inbound,
                startLat: from.lat,
                startLng: from.lng,
                endLat: to.lat,
                endLng: to.lng,
            };
            return [
                { ...common, kind: "base" },
                { ...common, kind: "particle" },
            ];
        });
    }, [selfLoc, peers]);
    // Per-arc random dash timings, stable across re-renders so existing
    // arcs keep their phase when the peer set changes.
    const arcTimings = useRef(new Map());
    const arcTiming = (ip) => {
        let t = arcTimings.current.get(ip);
        if (!t) {
            t = { animMs: 2200 + Math.random() * 2600, initialGap: Math.random() * 2 };
            arcTimings.current.set(ip, t);
        }
        return t;
    };
    // Drop timings for arcs that no longer exist so the map doesn't grow
    // unboundedly across peer churn.
    useEffect(() => {
        const keep = new Set(arcs.map((a) => a.ip));
        for (const ip of arcTimings.current.keys()) {
            if (!keep.has(ip))
                arcTimings.current.delete(ip);
        }
    }, [arcs]);
    // Pulse rings at our own location while the node runs.
    const rings = useMemo(() => {
        if (!selfRunning || !selfLoc || (selfLoc.lat === 0 && selfLoc.lon === 0)) {
            return [];
        }
        return [{ lat: selfLoc.lat, lng: selfLoc.lon }];
    }, [selfRunning, selfLoc]);
    const globeMaterial = useMemo(() => new MeshPhongMaterial({ map: buildGlobeTexture(), shininess: 6 }), []);
    // Slow idle spin; paused while a pin is hovered so the tooltip target
    // doesn't drift out from under the cursor. Zoom is clamped so the
    // globe can neither be lost in the distance nor clipped through.
    const configureControls = () => {
        const controls = globeRef.current?.controls();
        if (!controls)
            return;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.45;
        controls.enablePan = false;
        controls.minDistance = 140;
        controls.maxDistance = 520;
        controls.zoomSpeed = 0.6;
        // Fill-rate is the dominant cost, and three-render-objects defaults
        // to the device pixel ratio (clamped to 2). 1x on software rasters;
        // slightly under-native on hiDPI GPUs, where it's visually negligible.
        const renderer = globeRef.current?.renderer();
        renderer?.setPixelRatio(LOW_POWER ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
    };
    // FPS watchdog with staged quality adaptation: after a 2s warm-up,
    // sample ~3s of visible frames, then react to the sustained rate:
    //   < 40 fps → drop render resolution to 1x, re-measure
    //   < 25 fps → drop to 0.75x, re-measure
    //   < 14 fps → give up and let the parent swap in the flat SVG map
    // This is the only reliable signal on WebKitGTK, which masks the GL
    // renderer string so the software-rasteriser sniff can't fire there.
    // Gaps >100ms are ignored so a hidden window can't skew the measure.
    useEffect(() => {
        let raf = 0;
        let frames = 0;
        let elapsed = 0;
        let warmup = 2000;
        let last = 0;
        let done = false;
        const ratios = LOW_POWER ? [0.75] : [1, 0.75];
        const tick = (t) => {
            if (done)
                return;
            if (last) {
                const dt = t - last;
                if (dt < 100) {
                    if (warmup > 0)
                        warmup -= dt;
                    else {
                        frames++;
                        elapsed += dt;
                    }
                }
            }
            last = t;
            if (elapsed >= 3000) {
                const fps = (frames * 1000) / elapsed;
                if (fps < 14 && onPerformancePoor) {
                    done = true;
                    console.info(`[globe] sustained ${fps.toFixed(1)} fps — falling back to flat map`);
                    onPerformancePoor();
                    return;
                }
                const threshold = ratios.length === 2 ? 40 : 25;
                const nextRatio = ratios.shift();
                if (fps < threshold && nextRatio !== undefined) {
                    console.info(`[globe] sustained ${fps.toFixed(1)} fps — reducing render resolution to ${nextRatio}x`);
                    globeRef.current?.renderer()?.setPixelRatio(nextRatio);
                    frames = 0;
                    elapsed = 0;
                    warmup = 600;
                }
                else {
                    done = true;
                    return;
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            done = true;
            cancelAnimationFrame(raf);
        };
    }, [onPerformancePoor]);
    useEffect(() => {
        const controls = globeRef.current?.controls();
        if (controls)
            controls.autoRotate = !hovered;
    }, [hovered]);
    // Aim the camera at our own location once it resolves.
    const aimedAtSelf = useRef(false);
    useEffect(() => {
        if (aimedAtSelf.current || !globeRef.current)
            return;
        if (!selfLoc || (selfLoc.lat === 0 && selfLoc.lon === 0))
            return;
        aimedAtSelf.current = true;
        globeRef.current.pointOfView({ lat: selfLoc.lat, lng: selfLoc.lon, altitude: 2.1 }, 1200);
    }, [selfLoc, size.w]);
    // Drop the tooltip if its target pin is gone (node stopped while the
    // cursor was hovering, or a refresh removed the entry).
    useEffect(() => {
        if (!hovered)
            return;
        if (hovered.kind === "peer") {
            if (!peers.some((p) => p.geo.ip === hovered.marker.geo.ip)) {
                setHovered(null);
            }
        }
        else if (hovered.kind === "public") {
            const n = hovered.node;
            if (!publicNodes.some((p) => p.lat === n.lat && p.lon === n.lon)) {
                setHovered(null);
            }
        }
        else if (hovered.kind === "self" && hovered.running !== selfRunning) {
            setHovered(null);
        }
    }, [peers, publicNodes, selfRunning, hovered]);
    const focusedIp = hovered?.kind === "peer" ? hovered.marker.geo.ip : null;
    // Layer styling. Accessors close over focusedIp — a hover change gives
    // them new identities, which tells react-globe.gl to restyle.
    const pointColor = (d) => {
        const p = d;
        switch (p.kind) {
            case "self":
                if (!p.running)
                    return `rgba(${PUBLIC_RGB}, 0.9)`;
                return `rgba(${SELF_RGB}, 1)`;
            case "peer": {
                const rgb = p.marker.peer?.inbound ? INBOUND_RGB : OUTBOUND_RGB;
                const dim = focusedIp && focusedIp !== p.marker.geo.ip;
                return `rgba(${rgb}, ${dim ? 0.35 : 1})`;
            }
            default:
                return `rgba(${PUBLIC_RGB}, ${focusedIp ? 0.3 : 0.55})`;
        }
    };
    const pointRadius = (d) => {
        const p = d;
        return p.kind === "public" ? 0.42 : p.kind === "self" ? 0.7 : 0.65;
    };
    const pointAltitude = (d) => d.kind === "public" ? 0.004 : 0.01;
    const arcColor = (d) => {
        const a = d;
        const dimmed = focusedIp !== null && focusedIp !== a.ip;
        if (a.kind === "particle") {
            // Bright warm/mint tint of the line colour so the moving dash
            // reads as a glow over the dimmer base arc. Hidden entirely when
            // another connection is focused.
            if (dimmed)
                return "rgba(0,0,0,0)";
            return a.inbound
                ? "rgba(255, 214, 150, 0.95)"
                : "rgba(190, 255, 231, 0.95)";
        }
        const rgb = a.inbound ? INBOUND_RGB : OUTBOUND_RGB;
        if (!focusedIp)
            return `rgba(${rgb}, 0.55)`;
        return dimmed ? `rgba(${rgb}, 0.12)` : `rgba(${rgb}, 0.95)`;
    };
    // Tooltip position: ref-based, rAF-throttled transform writes so mouse
    // movement never triggers a React render (same pattern as WorldMap).
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
    const handlePointerMove = (e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect)
            return;
        pointerPos.current.x = e.clientX - rect.left;
        pointerPos.current.y = e.clientY - rect.top;
        if (rafId.current == null) {
            rafId.current = requestAnimationFrame(flushPosition);
        }
    };
    useEffect(() => {
        if (hovered)
            flushPosition();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hovered]);
    useEffect(() => {
        return () => {
            if (rafId.current != null)
                cancelAnimationFrame(rafId.current);
        };
    }, []);
    return (_jsxs("div", { ref: containerRef, className: "relative w-full h-full", onPointerMove: handlePointerMove, onPointerLeave: () => setHovered(null), children: [size.w > 0 && size.h > 0 && (_jsx(Globe, { ref: globeRef, width: size.w, height: size.h, backgroundColor: "rgba(0,0,0,0)", globeMaterial: globeMaterial, showAtmosphere: true, atmosphereColor: "#f7931a", atmosphereAltitude: 0.13, onGlobeReady: configureControls, animateIn: false, rendererConfig: {
                    antialias: !LOW_POWER,
                    alpha: true,
                    powerPreference: "high-performance",
                }, pointsData: points, pointLat: "lat", pointLng: "lng", pointColor: pointColor, pointRadius: pointRadius, pointAltitude: pointAltitude, pointsMerge: false, pointResolution: LOW_POWER ? 6 : 10, pointsTransitionDuration: 0, onPointHover: (p) => setHovered(p ?? null), arcsData: arcs, arcColor: arcColor, arcAltitudeAutoScale: 0.3, arcStroke: (d) => d.kind === "particle" ? PARTICLE_STROKE : 0.35, arcDashLength: (d) => {
                    const a = d;
                    if (a.kind !== "particle")
                        return 1;
                    return Math.min(0.25, PARTICLE_DOT_DEG / Math.max(centralAngleDeg(a), 1));
                }, arcDashGap: (d) => (d.kind === "particle" ? 2 : 0), arcDashInitialGap: (d) => {
                    const a = d;
                    return a.kind === "particle" ? arcTiming(a.ip).initialGap : 0;
                }, arcDashAnimateTime: (d) => {
                    const a = d;
                    return a.kind === "particle" ? arcTiming(a.ip).animMs : 0;
                }, arcsTransitionDuration: 0, ringsData: rings, ringColor: () => (t) => `rgba(${SELF_RGB}, ${0.55 * (1 - t)})`, ringMaxRadius: 4, ringPropagationSpeed: 1.6, ringRepeatPeriod: 1400 })), hovered && (_jsx("div", { ref: tooltipRef, className: "pointer-events-none absolute top-0 left-0 z-10 rounded border border-border-strong bg-bg-elev/95 backdrop-blur px-4 py-3 shadow-card-hover", style: {
                    width: 280,
                    transform: "translate3d(-9999px,-9999px,0)",
                    willChange: "transform",
                }, children: hovered.kind === "peer" ? (_jsx(ConnectedPeerBody, { marker: hovered.marker })) : hovered.kind === "public" ? (_jsx(PublicNodeBody, { node: hovered.node })) : (_jsx(SelfBody, { running: hovered.running })) }))] }));
}
// Minimal hover card for our own pin — the flat map had no self tooltip,
// but on the globe every point reports hover, so give it a label rather
// than an empty card.
function SelfBody({ running }) {
    const t = useT();
    return (_jsx(_Fragment, { children: _jsxs("span", { className: running ? "pill-ok" : "pill-muted", children: [_jsx("span", { className: running ? "live-dot-success" : "live-dot-muted" }), t("worldmap.you")] }) }));
}
