import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { api, BlockView, MinerStatus, NodeStatus, WalletStatus } from "./api";

/** One reading in a rolling history, at a wall-clock time in ms. */
export type Sample = { t: number; v: number };

export type Live = {
  node: NodeStatus | null;
  miner: MinerStatus | null;
  wallet: WalletStatus;
  /** The newest blocks, newest first, refreshed whenever the head moves. */
  blocks: BlockView[];
  /** Hashrate while mining, one sample per poll, cleared when mining starts. */
  hashrate: Sample[];
  /** Peer count, one sample per poll while the node runs. */
  peers: Sample[];
  /** Polls again right away, after an action changed the backend's state. */
  refresh: () => void;
};

const POLL_MS = 2000;
const WALLET_POLL_MS = 3000;
const BLOCKS_SHOWN = 12;
/** Ten minutes of 2s samples. */
const HISTORY = 300;

const LiveContext = createContext<Live | null>(null);

function push(history: Sample[], v: number): Sample[] {
  const next = [...history, { t: Date.now(), v }];
  return next.length > HISTORY ? next.slice(next.length - HISTORY) : next;
}

// The fields a render depends on: uptime is left out, since it changes on
// every poll while only its coarse format is ever shown.
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
 * LiveProvider polls the backend once for the whole app: node, miner and
 * wallet status, the latest blocks, and short histories for the charts.
 * Pages read it through useLive instead of each running their own timers,
 * and histories survive moving between pages.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<NodeStatus | null>(null);
  const [miner, setMiner] = useState<MinerStatus | null>(null);
  const [wallet, setWallet] = useState<WalletStatus>({ connected: false, lastSeenUnixMilli: 0 });
  const [blocks, setBlocks] = useState<BlockView[]>([]);
  const [hashrate, setHashrate] = useState<Sample[]>([]);
  const [peers, setPeers] = useState<Sample[]>([]);
  const head = useRef(-1);
  const mining = useRef(false);
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      const [ns, ms] = await Promise.all([
        api.nodeStatus().catch(() => null),
        api.minerStatus().catch(() => null),
      ]);
      if (!alive) return;

      if (ns) {
        setNode((prev) => (sameNode(prev, ns) ? prev : ns));
        if (ns.running) {
          setPeers((h) => push(h, ns.peers));
          if (ns.currentBlock !== head.current) {
            head.current = ns.currentBlock;
            api
              .recentBlocks(BLOCKS_SHOWN)
              .then((b) => alive && setBlocks(b))
              .catch(() => {});
          }
        } else if (head.current !== -1) {
          head.current = -1;
          setBlocks([]);
          setPeers([]);
        }
      }

      if (ms) {
        setMiner(ms);
        if (ms.running) {
          // A fresh run starts a fresh chart
          setHashrate((h) => push(mining.current ? h : [], ms.hashrate));
        }
        mining.current = ms.running;
      }
    };

    const pollWallet = async () => {
      try {
        const s = await api.walletStatus();
        if (!alive) return;
        setWallet((prev) =>
          prev.connected === s.connected && prev.lastSeenUnixMilli === s.lastSeenUnixMilli ? prev : s,
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

  const value: Live = {
    node,
    miner,
    wallet,
    blocks,
    hashrate,
    peers,
    refresh: () => pollNow.current(),
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside LiveProvider");
  return ctx;
}

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
