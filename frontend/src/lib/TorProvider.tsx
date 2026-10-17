import { ReactNode, useEffect, useState } from "react";
import { api, onEvent, type TorStatus } from "./api";
import { TOR_BAR_FRESH_MS, TorBarFreshContext, TorContext, torBarKind } from "./torStatus";

/**
 * TorProvider follows the Tor switch and how Tor is doing: at once on each
 * change the backend sends of Tor or the node, and every few seconds
 * besides, for the node's onion address, which comes up after Tor does;
 * and opens the Tor bar of itself for a while on each new message.
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
  // A new message (Tor turned on, connected, failed, the node to restart)
  // opens the bar for a while; its progress alone doesn't
  const kind = torBarKind(st);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (kind === "off") {
      setFresh(false);
      return;
    }
    setFresh(true);
    const timer = window.setTimeout(() => setFresh(false), TOR_BAR_FRESH_MS);
    return () => window.clearTimeout(timer);
  }, [kind]);
  return (
    <TorContext.Provider value={st}>
      <TorBarFreshContext.Provider value={fresh}>{children}</TorBarFreshContext.Provider>
    </TorContext.Provider>
  );
}
