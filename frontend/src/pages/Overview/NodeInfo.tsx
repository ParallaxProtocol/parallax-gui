import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { NodeDetails, NodeStatus } from "../../lib/api";
import {
  formatBytes,
  formatDifficulty,
  formatDuration,
  formatGwei,
  formatInt,
  formatLax,
  shortHex,
  TARGET_BLOCK_SECONDS,
} from "../../lib/format";
import { GLIDE, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { useT } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { Panel, Property, Rows, Section } from "../../components/ui/Panel";
import { CopyButton, Fill } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";

/** Whether "More details" was left open, remembered per viewer. */
const MORE_KEY = "parallax-node-more";

function readMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * NodeInfo is the Overview's account of the node. Up front, what most
 * people want to know: whether the network can reach it, where a wallet
 * connects, its standing on the status page, the reward schedule and its
 * disk, and snap sync's progress while it runs. "More details", below the
 * panel, unfolds the technical rest as a card per group.
 */
export default function NodeInfo({
  node,
  details: d,
  headHash,
}: {
  node: NodeStatus;
  details: NodeDetails | null;
  headHash?: string;
}) {
  const t = useT();
  const [more, setMore] = useState(readMore);
  const stagger = useStagger();

  if (!d?.running) return null;

  const toggle = () => {
    setMore((m) => {
      try {
        localStorage.setItem(MORE_KEY, m ? "0" : "1");
      } catch {
        /* storage unavailable: the panel just won't remember */
      }
      return !m;
    });
  };

  const syncName = (mode: string) => (mode === "full" ? t("details.modeFull") : mode === "snap" ? t("details.modeSnap") : mode);
  const snapRunning = node.syncing && d.syncModeActive === "snap" && d.snapAccounts > 0;

  return (
    <Section title={t("details.node")}>
      <Panel className="overflow-hidden">
        <dl className="flex flex-col divide-y divide-border">
          <Property label={t("details.reachability")}>
            {d.inboundAllowed ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Indicator grade="good" />
                <span className="truncate">
                  {t("details.reachable")} <span className="font-mono text-sm">{`${d.externalIp}:${d.listenPort}`}</span>
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Indicator grade="off" />
                {t("details.outboundOnly")}
              </span>
            )}
          </Property>
          <Property label={t("overview.rpc")} mono={!!node.rpcEndpoint}>
            {node.rpcEndpoint ? (
              <Copyable value={node.rpcEndpoint} />
            ) : (
              <span className="text-muted-foreground">{t("overview.rpcOff")}</span>
            )}
          </Property>
          <Property label={t("details.statsPage")}>
            {d.statsHost ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Indicator grade="good" />
                <Tooltip content={d.statsHost} mono>
                  <span className="truncate">
                    {d.statsName ? t("details.statsAs", { name: d.statsName }) : t("details.statsOn")}
                  </span>
                </Tooltip>
              </span>
            ) : (
              <span className="text-muted-foreground">{t("details.statsOff")}</span>
            )}
          </Property>
          <Property label={t("details.reward")}>{formatLax(d.blockRewardWei, 4)} LAX</Property>
          <Property label={t("details.halving")}>
            <span className="truncate">
              {t("details.halvingAt", {
                block: formatInt(d.nextHalvingBlock),
                eta: formatDuration(d.blocksToHalving * TARGET_BLOCK_SECONDS),
              })}
            </span>
          </Property>
          <Property label={t("details.chainData")}>{formatBytes(node.diskUsedBytes)}</Property>
          <Property label={t("details.freeSpace")}>
            <DiskFree free={d.diskFreeBytes} stopBelow={d.diskStopBelowBytes} />
          </Property>
          <Property label={t("overview.memory")}>
            <span className="flex min-w-0 items-baseline gap-2">
              {formatBytes(node.memUsedBytes)}
              <span className="truncate text-sm text-muted-foreground">{t("overview.memoryDesc")}</span>
            </span>
          </Property>
          {snapRunning && (
            <Property label={t("details.snapState")}>
              <span className="truncate">
                {t("details.snapStateValue", {
                  accounts: formatInt(d.snapAccounts),
                  slots: formatInt(d.snapStorage),
                  size: formatBytes(d.snapBytes),
                })}
              </span>
            </Property>
          )}
          {snapRunning && d.snapHealing > 0 && (
            <Property label={t("details.healing")}>{t("details.healingLeft", { n: formatInt(d.snapHealing) })}</Property>
          )}
        </dl>

      </Panel>

      {/* The toggle, outside the panel, between it and the cards it unfolds */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={more}
        className="btn btn-ghost mt-1 self-center"
      >
        {more ? t("details.less") : t("details.more")}
        <motion.span className="grid place-items-center" initial={false} animate={{ rotate: more ? 180 : 0 }} transition={GLIDE}>
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      {/* The technical rest, each group its own card, arriving in turn */}
      <AnimatePresence initial={false}>
        {more && (
          <motion.div
            key="more"
            className="-mx-2 overflow-hidden px-2"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
          >
            <motion.div
              className="grid items-start gap-x-5 gap-y-4 pt-2 pb-2 lg:grid-cols-2"
              {...stagger}
            >
              <Card title={t("details.identity")}>
                <Property label={t("details.nodeId")} mono>
                  <Copyable value={d.nodeId} short={shortHex(d.nodeId, 10, 8)} />
                </Property>
                {/* v2 nodes have no enode URL: leave the row out rather than show a dash */}
                {d.enode && (
                  <Property label={t("details.enode")} mono>
                    <Copyable value={d.enode} short={shortHex(d.enode, 18, 14)} />
                  </Property>
                )}
                <Property label={t("overview.client")} mono>
                  <Tooltip content={d.clientName} mono>
                    <span className="truncate">v{d.daemonVersion}</span>
                  </Tooltip>
                </Property>
              </Card>

              <Card title={t("details.network")}>
                <Property label={t("details.peers")}>
                  <span className="flex items-center gap-2.5">
                    {d.maxPeers > 0 && (
                      <span className="relative h-1 w-20 overflow-hidden rounded-full bg-muted">
                        <Fill value={node.peers / d.maxPeers} className="bg-brand-mark" />
                      </span>
                    )}
                    {d.maxPeers > 0 ? t("details.peersOf", { n: node.peers, max: d.maxPeers }) : node.peers}
                  </span>
                </Property>
                <Property label={t("details.transport")}>{d.v2Only ? t("details.v2Only") : t("details.v1v2")}</Property>
                <Property label={t("overview.network")}>Parallax · {t("overview.chainId", { id: node.chainId })}</Property>
              </Card>

              <Card title={t("details.chain")}>
                <Property label={t("overview.headHash")} mono>
                  {headHash ? (
                    <Copyable value={headHash} short={shortHex(headHash, 10, 8)} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Property>
                <Property label={t("details.td")}>
                  <Tooltip content={d.totalDifficulty} mono>
                    <span>{d.totalDifficulty ? formatDifficulty(d.totalDifficulty) : "—"}</span>
                  </Tooltip>
                </Property>
              </Card>

              <Card title={t("details.fees")}>
                <Property label={t("details.gasPrice")}>{d.gasPriceWei ? formatGwei(d.gasPriceWei) : "—"}</Property>
                <Property label={t("details.smartFee")}>
                  {!d.smartFee ? (
                    <span className="text-muted-foreground">{t("details.smartFeeOff")}</span>
                  ) : d.smartFeeWei && !d.smartFeeFallback ? (
                    <span className="truncate">
                      {formatGwei(d.smartFeeWei)}{" "}
                      <span className="text-muted-foreground">{t("details.smartFeeTarget", { n: d.smartFeeTarget })}</span>
                    </span>
                  ) : (
                    <span className="truncate text-muted-foreground">{t("details.smartFeeWarming", { n: d.smartFeeBlocks })}</span>
                  )}
                </Property>
              </Card>

              <Card title={t("details.storage")}>
                <Property label={t("overview.dataDir")} mono>
                  <Tooltip content={node.dataDir} mono overflowOnly>
                    <span className="truncate">{node.dataDir}</span>
                  </Tooltip>
                </Property>
                <Property label={t("details.syncMode")}>
                  {d.syncModeActive && d.syncModeActive !== d.syncModeConfigured
                    ? t("details.syncSwitched", { configured: syncName(d.syncModeConfigured), active: syncName(d.syncModeActive) })
                    : syncName(d.syncModeConfigured)}
                </Property>
                <Property label={t("details.history")}>{d.archiveMode ? t("details.archive") : t("details.pruned")}</Property>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Section>
  );
}

/** Card is one group of the technical details: its own titled section and panel. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div variants={STAGGER.item}>
      <Section title={title}>
        <Rows as="dl">{children}</Rows>
      </Section>
    </motion.div>
  );
}

/** Copyable is a selectable value, shortened when it is long, with a copy button. */
function Copyable({ value, short }: { value: string; short?: string }): ReactNode {
  return (
    <>
      <Tooltip content={value} mono overflowOnly={!short}>
        <span className="truncate">{short ?? value}</span>
      </Tooltip>
      <CopyButton value={value} className="-my-1 -mr-2" />
    </>
  );
}

/**
 * DiskFree shows the free space on the chain's disk, amber once within
 * twice the level where the node stops itself to protect its database,
 * red within it.
 */
function DiskFree({ free, stopBelow }: { free: number; stopBelow: number }) {
  const t = useT();
  const tone = stopBelow > 0 && free <= stopBelow ? "text-critical-ink" : stopBelow > 0 && free <= 2 * stopBelow ? "text-warn-ink" : "";
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className={tone}>{formatBytes(free)}</span>
      {stopBelow > 0 && (
        <span className="truncate text-sm text-muted-foreground">{t("details.stopsBelow", { size: formatBytes(stopBelow) })}</span>
      )}
    </span>
  );
}
