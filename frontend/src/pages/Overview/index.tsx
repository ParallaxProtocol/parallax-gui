import { useEffect, useState } from "react";
import { api, PeerView } from "../../lib/api";
import { formatBytes, formatDuration, shortHex } from "../../lib/format";
import { useBlocks, useNode } from "../../lib/live";
import { useT } from "../../i18n";
import { Property, Rows, Section, Stat, StatStrip } from "../../components/ui/Panel";
import { CopyButton } from "../../components/ui/bits";
import BlockHero, { Stopped } from "./BlockHero";
import LatestBlocks from "./LatestBlocks";
import PeersDrawer from "./PeersDrawer";

export default function Overview() {
  const t = useT();
  const node = useNode();
  const blocks = useBlocks();
  const [peersOpen, setPeersOpen] = useState(false);
  const [peerList, setPeerList] = useState<PeerView[]>([]);
  const [mine, setMine] = useState("");
  const running = !!node?.running;

  // The direction split for the peers figure; the drawer polls on its own
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const refresh = () =>
      api
        .peers()
        .then((p) => alive && setPeerList(p))
        .catch(() => {});
    refresh();
    const id = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [running]);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => setMine(c.miningWallet))
      .catch(() => {});
  }, []);

  if (!node) return null;
  if (!running) return <Stopped />;

  const inbound = peerList.filter((p) => p.inbound).length;
  const outbound = peerList.length - inbound;

  return (
    <div className="flex flex-col gap-5 p-5">
      <BlockHero />

      <StatStrip>
        <Stat
          label={t("overview.peers")}
          value={node.peers}
          detail={t("overview.peerSplit", { in: inbound, out: outbound })}
          action={
            <button type="button" onClick={() => setPeersOpen(true)} className="btn btn-ghost btn-sm -my-1 -mr-2 text-brand">
              {t("overview.viewPeers")}
            </button>
          }
        />
        <Stat label={t("overview.uptime")} value={formatDuration(node.uptimeSeconds)} detail={t("overview.uptimeDesc")} />
        <Stat label={t("overview.storage")} value={formatBytes(node.diskUsedBytes)} detail={t("overview.storageDesc")} />
        <Stat label={t("overview.memory")} value={formatBytes(node.memUsedBytes)} detail={t("overview.memoryDesc")} />
      </StatStrip>

      <Section title={t("overview.node")}>
        <Rows as="dl">
          <Property label={t("overview.client")} mono>
            {node.clientVersion}
          </Property>
          <Property label={t("overview.network")}>Parallax · {t("overview.chainId", { id: node.chainId })}</Property>
          <Property label={t("overview.rpc")} mono={!!node.rpcEndpoint}>
            {node.rpcEndpoint ? (
              <>
                <span className="truncate">{node.rpcEndpoint}</span>
                <CopyButton value={node.rpcEndpoint} className="-my-1" />
              </>
            ) : (
              <span className="text-muted-foreground">{t("overview.rpcOff")}</span>
            )}
          </Property>
          <Property label={t("overview.dataDir")} mono>
            <span className="truncate" title={node.dataDir}>
              {node.dataDir}
            </span>
          </Property>
          <Property label={t("overview.headHash")} mono>
            {blocks[0] ? (
              <>
                <span title={blocks[0].hash}>{shortHex(blocks[0].hash, 10, 8)}</span>
                <CopyButton value={blocks[0].hash} className="-my-1" />
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Property>
        </Rows>
      </Section>

      <Section title={t("overview.latestBlocks")}>
        <LatestBlocks blocks={blocks} mine={mine} />
      </Section>

      <PeersDrawer open={peersOpen} onClose={() => setPeersOpen(false)} />
    </div>
  );
}
