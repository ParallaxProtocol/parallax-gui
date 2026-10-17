import { ReactNode, useEffect, useRef, useState } from "react";
import { api, CONFIG_UPDATED_EVENT, onEvent, type GUIConfig, type TorStatus } from "./api";
import { useSettingsSheet } from "./settingsSheet";
import { TOR_BAR_GLANCE_MS, TorBarFreshContext, TorContext, torBarKind } from "./torStatus";

/**
 * TorProvider follows the Tor switch and how Tor is doing: at once on each
 * change the backend sends of Tor or the node, and every few seconds
 * besides, for the node's onion address, which comes up after Tor does;
 * and keeps the Tor bar open of itself until Tor is connected, then for a
 * glance; again as Settings, where it's turned on, closes, if its Tor
 * settings changed since the bar last showed itself.
 */
export function TorProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<TorStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .torStatus()
        .then((s) => alive && setSt(s))
        .catch(() => {});
    load();
    const offTor = onEvent("tor", load);
    const offNode = onEvent("node", load);
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      offTor();
      offNode();
      window.clearInterval(timer);
    };
  }, []);
  // The Tor settings as saved, to tell whether Settings changed them
  const [torSettings, setTorSettings] = useState("");
  useEffect(() => {
    const read = (c: GUIConfig) =>
      JSON.stringify([c.tor, c.torOnionOnly, c.torSystem, c.proxy, c.torControl, c.torPassword]);
    const load = () =>
      api
        .getConfig()
        .then((c) => setTorSettings(read(c)))
        .catch(() => {});
    load();
    window.addEventListener(CONFIG_UPDATED_EVENT, load);
    return () => window.removeEventListener(CONFIG_UPDATED_EVENT, load);
  }, []);

  // The bar stays open until Tor is connected (and the node behind it);
  // then for a glance, from its connecting, or from Settings closing over
  // it if the Tor settings changed since the bar last showed itself (or Tor
  // connected while Settings was open); never while Settings is open. Tor's
  // progress alone doesn't reopen it
  const kind = torBarKind(st);
  const connected = kind === "ready" || kind === "readyOnion";
  const { open: settingsOpen } = useSettingsSheet();
  const [glance, setGlance] = useState(0);
  const [glancing, setGlancing] = useState(false);
  const shownWith = useRef<string | null>(null);
  const missed = useRef(false);
  const show = () => {
    shownWith.current = torSettings;
    missed.current = false;
    setGlance((n) => n + 1);
  };
  // Connected, or connected another way (onion only)
  useEffect(() => {
    if (!connected) return;
    if (settingsOpen) missed.current = true;
    else show();
    // Settings closing is handled below
  }, [kind, connected]);
  const wasOpen = useRef(settingsOpen);
  useEffect(() => {
    const closed = wasOpen.current && !settingsOpen;
    wasOpen.current = settingsOpen;
    if (closed && connected && (missed.current || shownWith.current !== torSettings)) show();
  }, [settingsOpen]);
  useEffect(() => {
    if (glance === 0) return;
    setGlancing(true);
    const timer = window.setTimeout(() => setGlancing(false), TOR_BAR_GLANCE_MS);
    return () => window.clearTimeout(timer);
  }, [glance]);
  const fresh = kind !== "off" && !settingsOpen && (!connected || glancing);
  return (
    <TorContext.Provider value={st}>
      <TorBarFreshContext.Provider value={fresh}>{children}</TorBarFreshContext.Provider>
    </TorContext.Provider>
  );
}
