import { createContext, useContext } from "react";
import type { TorStatus } from "./api";

/**
 * The Tor switch and how Tor is doing (backend/tor.go), for Settings and
 * the Tor bar: null until first read. TorProvider keeps it.
 */
export const TorContext = createContext<TorStatus | null>(null);

export const useTorStatus = () => useContext(TorContext);

/**
 * Whether the Tor bar is open of itself, for TOR_BAR_FRESH_MS after it
 * comes up or its message changes (TorProvider), before it shrinks to its
 * line.
 */
export const TorBarFreshContext = createContext(false);

export const useTorBarFresh = () => useContext(TorBarFreshContext);

/** How long the Tor bar stays open on a new message. */
export const TOR_BAR_FRESH_MS = 30_000;

export type TorBarKind = "off" | "starting" | "failed" | "nodeRestart" | "readyOnion" | "ready";

/** torBarKind is the message the Tor bar shows for st. */
export function torBarKind(st: TorStatus | null): TorBarKind {
  if (!st?.enabled) return "off";
  if (st.state === "starting") return "starting";
  if (st.state === "failed") return "failed";
  if (st.state === "ready" && st.nodeRunning && !st.nodeBehind) return "nodeRestart";
  return st.onionOnly ? "readyOnion" : "ready";
}
