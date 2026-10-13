import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Pickaxe, Settings2, Wallet } from "lucide-react";
import { api, PeerView } from "../../lib/api";
import { formatBytes, formatDuration, shortHex } from "../../lib/format";
import { useBlocks, useNode, usePeerHistory } from "../../lib/live";
import { useT } from "../../i18n";
import { PageStagger, StaggerItem } from "../../components/PageStagger";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { Plate } from "../../components/ui/Plate";
import { Tile } from "../../components/ui/Tile";
import { Sparkline } from "../../components/ui/Chart";
import { CopyButton, Field } from "../../components/ui/bits";
import BlockHero from "./BlockHero";
import LatestBlocks from "./LatestBlocks";
import PeersDrawer from "./PeersDrawer";

export default function Overview() {
  const t = useT();
  const node = useNode();
  const blocks = useBlocks();
  const peerHistory = usePeerHistory();
  const [peersOpen, setPeersOpen] = useState(false);
  const [peerList, setPeerList] = useState<PeerView[]>([]);
  const [mine, setMine] = useState("");
  const running = !!node?.running;

  // The direction split for the peers tile; the drawer polls on its own
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

  const inbound = peerList.filter((p) => p.inbound).length;
  const outbound = peerList.length - inbound;

  return (
    <PageStagger className="flex flex-col gap-10">
      <StaggerItem>
        <BlockHero />
      </StaggerItem>

      {running && node && (
        <StaggerItem className="flex flex-col gap-4">
          <SectionHeader index={1} title={t("overview.node")} />
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Tile
              label={t("overview.peers")}
              readout={
                <button
                  type="button"
                  onClick={() => setPeersOpen(true)}
                  className="inline-flex items-center gap-1 text-brand transition-[gap] hover:gap-1.5"
                >
                  {t("overview.viewPeers")} <ArrowRight className="size-3" />
                </button>
              }
              value={String(node.peers)}
              qualifier={t("overview.peerSplit", { in: inbound, out: outbound })}
            >
              <Sparkline samples={peerHistory} />
            </Tile>
            <Tile
              label={t("overview.uptime")}
              value={formatDuration(node.uptimeSeconds)}
              qualifier={t("overview.uptimeDesc")}
            />
            <Tile
              label={t("overview.storage")}
              value={formatBytes(node.diskUsedBytes)}
              qualifier={<span className="block truncate font-mono text-xs" title={node.dataDir}>{node.dataDir}</span>}
            />
            <Tile
              label={t("overview.memory")}
              value={formatBytes(node.memUsedBytes)}
              qualifier={t("overview.memoryDesc")}
            />
          </div>

          <Plate className="px-5 py-4">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4 xl:grid-cols-[0.9fr_1fr_1.3fr_1fr]">
              <Field label={t("overview.client")}>
                <span className="font-mono">{node.clientVersion}</span>
              </Field>
              <Field label={t("overview.network")}>
                <span className="font-mono">
                  Parallax · {t("overview.chainId", { id: node.chainId })}
                </span>
              </Field>
              <Field label={t("overview.rpc")}>
                {node.rpcEndpoint ? (
                  <span className="flex items-center gap-1">
                    <span className="truncate font-mono">{node.rpcEndpoint}</span>
                    <CopyButton value={node.rpcEndpoint} compact className="-my-1" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("overview.rpcOff")}</span>
                )}
              </Field>
              <Field label={t("overview.headHash")}>
                {blocks[0] ? (
                  <span className="flex items-center gap-1" title={blocks[0].hash}>
                    <span className="truncate font-mono whitespace-nowrap">{shortHex(blocks[0].hash, 8, 6)}</span>
                    <CopyButton value={blocks[0].hash} compact className="-my-1" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Field>
            </dl>
          </Plate>
        </StaggerItem>
      )}

      {running && (
        <StaggerItem className="flex flex-col gap-4">
          <SectionHeader index={2} title={t("overview.latestBlocks")} aside={t("overview.newestFirst")} />
          <LatestBlocks blocks={blocks} mine={mine} />
        </StaggerItem>
      )}

      {!running && (
        <StaggerItem className="grid grid-cols-3 gap-4">
          <Shortcut to="/wallet" icon={Wallet} title={t("overview.go.wallet")} desc={t("overview.go.wallet.desc")} />
          <Shortcut to="/mining" icon={Pickaxe} title={t("overview.go.mining")} desc={t("overview.go.mining.desc")} />
          <Shortcut to="/settings" icon={Settings2} title={t("overview.go.settings")} desc={t("overview.go.settings.desc")} />
        </StaggerItem>
      )}

      <PeersDrawer open={peersOpen} onClose={() => setPeersOpen(false)} />
    </PageStagger>
  );
}

/** Shortcut is a plate linking to another page, for the stopped state. */
function Shortcut({ to, icon: Icon, title, desc }: { to: string; icon: typeof Wallet; title: string; desc: string }) {
  return (
    <Link to={to} className="block">
      <Plate className="flex h-full flex-col gap-3 p-5">
        <Icon className="size-5 text-brand" strokeWidth={1.75} />
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          <ArrowRight className="size-3.5 text-muted-foreground" />
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">{desc}</span>
      </Plate>
    </Link>
  );
}
