import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { api, BlockView, NodeStatus, WalletStatus } from "./api";

const POLL_MS = 2000;
const WALLET_POLL_MS = 3000;
const BLOCKS_SHOWN = 12;
/** While syncing the head moves every poll: refetch the latest blocks at most this often. */
const SYNC_BLOCKS_MS = 15_000;

// One context per stream, so a component re-renders only when the data it
// reads changes: the node's uptime moving every poll must not re-render a
// page that only shows the wallet.
const NodeContext = createContext<NodeStatus | null>(null);
const WalletContext = createContext<WalletStatus>({ connected: false, lastSeenUnixMilli: 0 });
const BlocksContext = createContext<BlockView[]>([]);
const RefreshContext = createContext<() => void>(() => {});

// The fields a render depends on: uptime and memory are compared coarsely,
// since they change on every poll while only their rounded format shows.
function sameNode(a: NodeStatus | null, b: NodeStatus): boolean {
  return (
    !!a &&
    a.running === b.running &&
    a.syncing === b.syncing &&
    a.currentBlock === b.currentBlock &&
    a.highestBlock === b.highestBlock &&
    a.startingBlock === b.startingBlock &&
    a.peers === b.peers &&
    a.diskUsedBytes === b.diskUsedBytes &&
    a.rpcEndpoint === b.rpcEndpoint &&
    Math.floor(a.uptimeSeconds / 60) === Math.floor(b.uptimeSeconds / 60) &&
    Math.abs(a.memUsedBytes - b.memUsedBytes) < 8 * 1024 * 1024
  );
}

/**
 * LiveProvider polls the backend once for the whole app: node and wallet
 * status, and the latest blocks.
 * Components read the stream they need through its own hook.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<NodeStatus | null>(null);
  const [wallet, setWallet] = useState<WalletStatus>({ connected: false, lastSeenUnixMilli: 0 });
  const [blocks, setBlocks] = useState<BlockView[]>([]);
  const head = useRef(-1);
  const blocksAt = useRef(0);
  const pollNow = useRef<() => void>(() => {});
  const [refresh] = useState(() => () => pollNow.current());

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      const ns = await api.nodeStatus().catch(() => null);
      if (!alive) return;

      if (ns) {
        setNode((prev) => (sameNode(prev, ns) ? prev : ns));
        if (ns.running) {
          const due = !ns.syncing || Date.now() - blocksAt.current >= SYNC_BLOCKS_MS;
          if (ns.currentBlock !== head.current && due) {
            head.current = ns.currentBlock;
            blocksAt.current = Date.now();
            api
              .recentBlocks(BLOCKS_SHOWN)
              .then((b) => alive && setBlocks(b))
              .catch(() => {});
          }
        } else if (head.current !== -1) {
          head.current = -1;
          setBlocks([]);
        }
      }
    };

    const pollWallet = async () => {
      try {
        const s = await api.walletStatus();
        if (!alive) return;
        setWallet((prev) =>
          prev.connected === s.connected &&
          // The last-seen time is shown to the second nowhere: a few seconds of drift needn't re-render
          Math.abs(prev.lastSeenUnixMilli - s.lastSeenUnixMilli) < 10_000
            ? prev
            : s,
        );
      } catch {
        /* backend not ready yet */
      }
    };

    pollNow.current = () => {
      poll();
      pollWallet();
    };
    poll();
    pollWallet();
    const a = setInterval(poll, POLL_MS);
    const b = setInterval(pollWallet, WALLET_POLL_MS);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  return (
    <RefreshContext.Provider value={refresh}>
      <NodeContext.Provider value={node}>
        <WalletContext.Provider value={wallet}>
          <BlocksContext.Provider value={blocks}>{children}</BlocksContext.Provider>
        </WalletContext.Provider>
      </NodeContext.Provider>
    </RefreshContext.Provider>
  );
}

export const useNode = () => useContext(NodeContext);
export const useWallet = () => useContext(WalletContext);
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
