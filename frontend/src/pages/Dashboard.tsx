import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { api, GeoLocation, NodeStatus, PeerView, PublicNode } from "../lib/api";
import { formatDuration } from "../lib/format";
import StatusPill, { StatusKind } from "../components/StatusPill";
import WorldMap, { PeerMarker } from "../components/WorldMap";
import PeersModal from "../components/PeersModal";
import { useT } from "../i18n";

export default function Dashboard() {
  const t = useT();
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selfLoc, setSelfLoc] = useState<GeoLocation | null>(null);
  const [peerMarkers, setPeerMarkers] = useState<PeerMarker[]>([]);
  const [publicNodes, setPublicNodes] = useState<PublicNode[]>([]);
  const [peersOpen, setPeersOpen] = useState(false);
  const peerKeyRef = useRef<string>("");

  // Resolve our own public IP once on mount. Cached server-side, so this
  // is essentially free on subsequent calls.
  useEffect(() => {
    let alive = true;
    api
      .geoSelf()
      .then((loc) => {
        if (alive) setSelfLoc(loc);
      })
      .catch(() => {
        /* network unavailable — leave map without a self pin */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Refresh the public node directory every 5 minutes. The Go side
  // caches with the same TTL, so this is effectively one upstream
  // request per interval no matter how many tabs/windows poll.
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      api
        .publicNodes()
        .then((nodes) => {
          if (alive) setPublicNodes(nodes);
        })
        .catch(() => {
          /* upstream down — leave the existing snapshot */
        });
    };
    refresh();
    const id = setInterval(refresh, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Poll node status + peer geo every 2s.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const s = await api.nodeStatus();
        if (!alive) return;
        setStatus((prev) => {
          if (
            prev &&
            prev.running === s.running &&
            prev.syncing === s.syncing &&
            prev.currentBlock === s.currentBlock &&
            prev.highestBlock === s.highestBlock &&
            prev.peers === s.peers &&
            formatDuration(prev.uptimeSeconds) === formatDuration(s.uptimeSeconds)
          ) {
            return prev;
          }
          return s;
        });
        if (s.running) {
          const [locs, peers] = await Promise.all([
            api.geoLookupPeers().catch(() => [] as GeoLocation[]),
            api.peers().catch(() => [] as PeerView[]),
          ]);
          if (!alive) return;
          const merged = mergePeerMarkers(locs, peers);
          // Avoid pointless re-renders when the resolved peer set hasn't
          // shifted; the WorldMap useEffect that staggers arc draw-on
          // depends on a stable identity.
          const key = merged
            .map((m) => m.geo.ip)
            .sort()
            .join(",");
          if (key !== peerKeyRef.current) {
            peerKeyRef.current = key;
            setPeerMarkers(merged);
          }
        } else if (peerMarkers.length > 0) {
          peerKeyRef.current = "";
          setPeerMarkers([]);
        }
      } catch {
        /* swallow */
      }
    };
    refresh();
    const id = setInterval(refresh, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      await api.startNode();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await api.stopNode();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const statusKind: StatusKind = !status?.running
    ? "stopped"
    : status.syncing
    ? "syncing"
    : "synced";

  const isOnline = !!status?.running && status.peers > 0;

  const syncPct =
    status && status.highestBlock > 0
      ? Math.min(100, Math.floor((status.currentBlock / status.highestBlock) * 100))
      : 0;

  return (
    // Break out of the main element's px-12 py-14 padding so the map can
    // run edge-to-edge below the fixed top bar (h-20).
    <div className="fixed left-0 right-0 top-20 bottom-0 overflow-hidden bg-bg">
      <div className="absolute inset-0">
        <WorldMap
          selfLoc={selfLoc}
          selfRunning={!!status?.running}
          peers={status?.running ? peerMarkers : []}
          publicNodes={publicNodes}
        />
      </div>

      {/* Vignette for legibility of overlays */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, oklch(0.06 0.015 265 / 0.55) 100%)",
        }}
      />

      {/* Top-left: title + status */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="absolute top-8 left-10 max-w-md"
      >
        <div className="eyebrow mb-2">{t("dashboard.eyebrow")}</div>
        <h1 className="font-serif text-3xl text-fg leading-tight mb-3">
          {t("dashboard.title")}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill kind={statusKind} />
          {status?.running && (
            <span className={isOnline ? "pill-ok" : "pill-err"}>
              <span
                className={isOnline ? "live-dot-success" : "live-dot-err"}
              />
              {isOnline ? t("status.online") : t("status.offline")}
            </span>
          )}
          {status?.running && (
            <span className="text-xs text-muted tabular-nums ml-1">
              {status.peers} {status.peers === 1 ? t("dashboard.peer") : t("dashboard.peers")} ·{" "}
              {formatDuration(status.uptimeSeconds)}
            </span>
          )}
        </div>
        {status?.running && (
          <div className="mt-4 w-80 rounded border border-border bg-bg-elev/70 backdrop-blur px-4 py-3">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="eyebrow">{t("dashboard.blockHeight")}</span>
              <span className="font-mono text-xs text-muted tabular-nums">
                {t("dashboard.localNetwork")}
              </span>
            </div>
            <div className="font-mono text-sm text-fg tabular-nums">
              {status.currentBlock.toLocaleString()}
              <span className="text-muted"> / </span>
              {status.highestBlock > 0
                ? status.highestBlock.toLocaleString()
                : "—"}
            </div>
            {status.syncing && status.highestBlock > 0 && (
              <div className="mt-3">
                <div className="flex justify-between eyebrow mb-2">
                  <span>{t("dashboard.sync")}</span>
                  <span className="font-mono normal-case tracking-normal text-fg">
                    {syncPct}%
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${syncPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Bottom-right: start/stop control */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
        className="absolute bottom-8 right-10"
      >
        {!status?.running ? (
          <button className="btn-primary" onClick={start} disabled={starting}>
            {starting ? t("dashboard.connecting") : t("dashboard.connect")}
          </button>
        ) : (
          <button className="btn-ghost" onClick={stop}>
            {t("dashboard.disconnect")}
          </button>
        )}
      </motion.div>

      {/* Bottom-left: peer direction legend, only when running */}
      {status?.running && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          className="absolute bottom-8 left-10 rounded border border-border bg-bg-elev/70 backdrop-blur px-3.5 py-2.5"
        >
          <div className="flex items-baseline justify-between gap-4 mb-2">
            <span className="eyebrow">{t("dashboard.peersSection")}</span>
            <button
              type="button"
              onClick={() => setPeersOpen(true)}
              className="text-[11px] text-muted hover:text-fg transition-colors"
            >
              {t("dashboard.viewList")}
            </button>
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-fg/80">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: "oklch(0.696 0.17 162.48)" }}
              />
              <span>{t("dashboard.legend.outbound")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: "rgb(247 147 26)" }}
              />
              <span>{t("dashboard.legend.inbound")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  background: "oklch(0.62 0.012 265 / 0.55)",
                  border: "1px solid oklch(0.78 0.012 265 / 0.55)",
                }}
              />
              <span>{t("dashboard.legend.other")}</span>
            </div>
          </div>
        </motion.div>
      )}

      {error && (
        <div className="absolute top-32 right-10 max-w-sm card border-danger/40 bg-danger/10 text-danger text-sm">
          {error}
        </div>
      )}

      <PeersModal open={peersOpen} onClose={() => setPeersOpen(false)} />
    </div>
  );
}

// Joins resolved geo locations with the matching PeerView so the map
// tooltip can render full peer detail. Geo lookups are keyed by the
// public IP, while PeerView.remoteAddr is "ip:port" — strip the port to
// match. Peers without a usable geo entry are dropped (they wouldn't have
// a place to render anyway).
function mergePeerMarkers(geo: GeoLocation[], peers: PeerView[]): PeerMarker[] {
  const peerByIp = new Map<string, PeerView>();
  for (const p of peers) {
    const ip = stripPort(p.remoteAddr);
    if (ip) peerByIp.set(ip, p);
  }
  const out: PeerMarker[] = [];
  for (const g of geo) {
    if (g.lat === 0 && g.lon === 0) continue;
    out.push({ geo: g, peer: peerByIp.get(g.ip) });
  }
  return out;
}

function stripPort(addr: string): string {
  if (!addr) return "";
  // IPv6 in brackets
  if (addr.startsWith("[")) {
    const end = addr.indexOf("]");
    return end > 0 ? addr.slice(1, end) : addr;
  }
  const i = addr.lastIndexOf(":");
  return i > 0 ? addr.slice(0, i) : addr;
}
