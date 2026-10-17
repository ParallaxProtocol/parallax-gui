import { createContext, useContext } from "react";
import type { TorStatus } from "./api";

/**
 * The Tor switch and how Tor is doing (backend/tor.go), for Settings and
 * the Tor bar: null until first read. TorProvider keeps it.
 */
export const TorContext = createContext<TorStatus | null>(null);

export const useTorStatus = () => useContext(TorContext);

/**
 * Whether the Tor bar is open of itself (TorProvider): until Tor is
 * connected, then for TOR_BAR_GLANCE_MS from its connecting or Settings
 * closing, before it shrinks to its line.
 */
export const TorBarFreshContext = createContext(false);

export const useTorBarFresh = () => useContext(TorBarFreshContext);

/** How long the Tor bar stays open once Tor is connected, or Settings closes on it connected. */
export const TOR_BAR_GLANCE_MS = 10_000;

export type TorBarKind = "off" | "starting" | "failed" | "nodeRestart" | "readyOnion" | "ready";

/** torBarKind is the message the Tor bar shows for st. */
export function torBarKind(st: TorStatus | null): TorBarKind {
  if (!st?.enabled) return "off";
  if (st.state === "starting") return "starting";
  if (st.state === "failed") return "failed";
  if (st.state === "ready" && st.nodeRunning && !st.nodeBehind) return "nodeRestart";
  return st.onionOnly ? "readyOnion" : "ready";
}
