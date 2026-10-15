import { ReactNode, useEffect, useRef, useState } from "react";
import { api, BlockView, NodeStatus } from "./api";
import { BlocksContext, NodeContext, RefreshContext } from "./live";

const POLL_MS = 2000;
const BLOCKS_SHOWN = 12;
/** While syncing the head moves every poll: refetch the latest blocks at most this often. */
const SYNC_BLOCKS_MS = 15_000;

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
    a.devChain === b.devChain &&
    a.diskUsedBytes === b.diskUsedBytes &&
    a.rpcEndpoint === b.rpcEndpoint &&
    Math.floor(a.uptimeSeconds / 60) === Math.floor(b.uptimeSeconds / 60) &&
    Math.abs(a.memUsedBytes - b.memUsedBytes) < 8 * 1024 * 1024
  );
}

/**
 * LiveProvider polls the backend once for the whole app: the node's
 * status, and the latest blocks.
 * Components read the stream they need through its own hook.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<NodeStatus | null>(null);
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

    pollNow.current = poll;
    poll();
    const a = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(a);
    };
  }, []);

  return (
    <RefreshContext.Provider value={refresh}>
      <NodeContext.Provider value={node}>
        <BlocksContext.Provider value={blocks}>{children}</BlocksContext.Provider>
      </NodeContext.Provider>
    </RefreshContext.Provider>
  );
}
