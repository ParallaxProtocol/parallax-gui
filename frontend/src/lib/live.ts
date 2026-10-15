import { createContext, useContext } from "react";
import type { BlockView, NodeStatus } from "./api";

// The node's live state, read through these hooks; LiveProvider.tsx
// polls the backend for it

// One context per stream, so a component re-renders only when the data it
// reads changes: a new block must not re-render a page that only shows
// the node's state.
export const NodeContext = createContext<NodeStatus | null>(null);
export const BlocksContext = createContext<BlockView[]>([]);
export const RefreshContext = createContext<() => void>(() => {});

export const useNode = () => useContext(NodeContext);
export const useBlocks = () => useContext(BlocksContext);
/** Polls again right away, after an action changed the backend's state. */
export const useRefresh = () => useContext(RefreshContext);

export type NodeState = "stopped" | "syncing" | "synced";

export function nodeState(node: NodeStatus | null): NodeState {
  if (!node?.running) return "stopped";
  return node.syncing ? "syncing" : "synced";
}

/** syncProgress is how much of the network's chain is local, 0..1. */
export function syncProgress(node: NodeStatus | null): number {
  if (!node || node.highestBlock <= 0) return 0;
  return Math.max(0, Math.min(1, node.currentBlock / node.highestBlock));
}
