import { GeoLocation, PeerView, PublicNode } from "../lib/api";
import { useT } from "../i18n";

// Shared pieces between the 3D globe (NetworkGlobe) and the flat-map
// fallback (WorldMap): the peer-marker shape and the tooltip bodies, so
// both views render identical hover cards.

// PeerMarker pairs a resolved geo location with the matching peer record
// so the tooltip can show the same fields the Peers screen does.
export type PeerMarker = {
  geo: GeoLocation;
  peer?: PeerView;
};

// Connection direction colours. Match the Peers screen pills so the views
// agree at a glance: outbound (we dialed) is success-green, inbound (peer
// dialed us) is gold. Self is the syncing-blue accent so it never collides
// with either peer direction.
export const OUTBOUND_COLOR = "oklch(0.696 0.17 162.48)";
export const INBOUND_COLOR = "rgb(247 147 26)";
export const SELF_COLOR = "oklch(0.68 0.16 240)";

export function ConnectedPeerBody({ marker }: { marker: PeerMarker }) {
  const t = useT();
  const { geo, peer } = marker;
  const location =
    [geo.city, geo.country].filter(Boolean).join(", ") || t("worldmap.unknownLocation");
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className={peer?.inbound ? "pill-warn" : "pill-ok"}>
          <span
            className={peer?.inbound ? "live-dot-warn" : "live-dot-success"}
          />
          {peer?.inbound ? t("peers.in") : t("peers.out")}
        </span>
        <span className="font-mono text-[11px] text-muted truncate">
          {peer?.id || "—"}
        </span>
      </div>
      <div className="text-sm text-fg truncate mb-1">
        {peer?.name || t("worldmap.unknownPeer")}
      </div>
      <div className="text-xs text-muted truncate">{location}</div>
      <div className="font-mono text-[11px] text-muted truncate mt-1">
        {geo.ip}
      </div>
      {peer?.caps && peer.caps.length > 0 && (
        <div className="font-mono text-[11px] text-muted truncate mt-2 pt-2 border-t border-border">
          {peer.caps.join(", ")}
        </div>
      )}
    </>
  );
}

export function PublicNodeBody({ node }: { node: PublicNode }) {
  const t = useT();
  const location =
    [node.city, node.country].filter(Boolean).join(", ") || t("worldmap.unknownLocation");
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="pill-muted">
          <span className="live-dot-muted" />
          {t("worldmap.notConnected")}
        </span>
        {node.countryCode && (
          <span className="font-mono text-[11px] text-muted">
            {node.countryCode}
          </span>
        )}
      </div>
      <div className="text-sm text-fg truncate">{location}</div>
      <div className="text-[11px] text-muted mt-1">
        {t("worldmap.publicKnown")}
      </div>
    </>
  );
}
