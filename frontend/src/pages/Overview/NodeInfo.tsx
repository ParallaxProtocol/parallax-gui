import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, ArrowDown, ArrowUp, ChevronDown, Cpu, HardDrive, MemoryStick, type LucideIcon } from "lucide-react";
import { BlockView, NodeDetails, NodeStatus, PeerView } from "../../lib/api";
import { formatBytes, formatDifficulty, formatInt, shortHex } from "../../lib/format";
import { GLIDE, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { useT } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { Panel, Property, Rows, Section, Stat, StatStrip, Tile } from "../../components/ui/Panel";
import { Donut } from "../../components/ui/Donut";
import { Sparkline } from "../../components/ui/Sparkline";
import { useUsage } from "../../lib/usage";
import { CopyButton } from "../../components/ui/bits";
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
 * NodeInfo is the Overview's account of the node, folded away behind
 * "More details": first what most people want to know (whether the network
 * can reach it, where a wallet connects, its standing on the status page,
 * the reward schedule, its disk, snap sync's progress while it runs), then
 * the technical rest, a card per group.
 */
export default function NodeInfo({
  node,
  details: d,
  head,
  peers,
}: {
  node: NodeStatus;
  details: NodeDetails | null;
  /** The chain's newest block, for its hash and difficulty. */
  head?: BlockView;
  /** The connected peers, for their split by direction and by network. */
  peers: PeerView[];
}) {
  const t = useT();
  const [more, setMore] = useState(readMore);
  const usage = useUsage(node.running && more);
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

  const syncName = (mode: string) =>
    mode === "full" ? t("details.modeFull") : mode === "snap" ? t("details.modeSnap") : mode;
  const snapRunning = node.syncing && d.syncModeActive === "snap" && d.snapAccounts > 0;
  const inbound = peers.filter((p) => p.inbound).length;
  const outbound = peers.length - inbound;
  const onion = peers.filter((p) => p.network === "onion").length;
  const ipv6 = peers.filter((p) => p.network === "ipv6").length;
  const ipv4 = peers.length - onion - ipv6;
  const clear = ipv4 + ipv6;

  return (
    // No gap between the toggle and the details: their spacing is inside
    // the details, so it folds away with them rather than snapping off as
    // they leave
    <div className="flex flex-col">
      {/* The toggle, then the details it unfolds, a card per group */}
      <button type="button" onClick={toggle} aria-expanded={more} className="btn btn-tinted btn-sm self-center">
        {more ? t("details.less") : t("details.more")}
        <motion.span
          className="grid place-items-center"
          initial={false}
          animate={{ rotate: more ? 180 : 0 }}
          transition={GLIDE}
        >
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
            <motion.div className="grid items-start gap-x-5 gap-y-4 pt-5 pb-2 lg:grid-cols-2" {...stagger}>
              {/* The node at a glance: its figures, as the strip above shows
                  the peers and the pool, then where to reach it */}
              <motion.div variants={STAGGER.item}>
                <Section title={t("details.node")}>
                  <StatStrip>
                    <Stat
                      label={t("details.syncMode")}
                      value={syncName(d.syncModeActive || d.syncModeConfigured)}
                      detail={
                        d.syncModeActive && d.syncModeActive !== d.syncModeConfigured
                          ? t("details.syncSwitched", {
                              configured: syncName(d.syncModeConfigured),
                              active: syncName(d.syncModeActive),
                            })
                          : d.archiveMode
                            ? t("details.archive")
                            : t("details.pruned")
                      }
                    />
                    <Stat
                      label={t("details.daemonVersion")}
                      value={
                        <Tooltip content={d.clientName} mono>
                          <span>v{d.daemonRelease}</span>
                        </Tooltip>
                      }
                      detail={
                        <span className="flex items-center gap-1.5">
                          {d.daemonMeta}
                          {d.daemonCommit && (
                            <>
                              {d.daemonMeta && <span>·</span>}
                              <Tooltip content={d.daemonCommit} mono>
                                <span className="selectable font-mono">{d.daemonCommit.slice(0, 8)}</span>
                              </Tooltip>
                            </>
                          )}
                        </span>
                      }
                    />
                  </StatStrip>
                  <Rows as="dl">
                    <Property label={t("details.nodeId")} mono>
                      <Copyable value={d.nodeId} short={shortHex(d.nodeId, 10, 8)} />
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
                      <Property label={t("details.healing")}>
                        {t("details.healingLeft", { n: formatInt(d.snapHealing) })}
                      </Property>
                    )}
                  </Rows>
                </Section>
              </motion.div>

              {/* The chain's weight, and its head */}
              <Group title={t("details.chain")}>
                <StatStrip>
                  <Stat
                    label={t("details.difficulty")}
                    value={
                      <Tooltip content={head?.difficulty ?? ""} mono>
                        <span>{head?.difficulty ? formatDifficulty(head.difficulty) : "—"}</span>
                      </Tooltip>
                    }
                    detail={t("details.difficultyDesc")}
                  />
                  <Stat
                    label={t("details.td")}
                    value={
                      <Tooltip content={d.totalDifficulty} mono>
                        <span>{d.totalDifficulty ? formatDifficulty(d.totalDifficulty) : "—"}</span>
                      </Tooltip>
                    }
                    detail={t("details.tdDesc")}
                  />
                </StatStrip>
                <Rows as="dl">
                  <Property label={t("overview.headHash")} mono>
                    {head ? (
                      <Copyable value={head.hash} short={shortHex(head.hash, 10, 8)} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Property>
                </Rows>
              </Group>

              {/* What the node takes of this computer: its disk and memory, and
                  what flows to and from its peers, now and in the last minute */}
              <motion.div variants={STAGGER.item} className="lg:col-span-2">
                <Section title={t("details.usage")}>
                  <Panel className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Reading
                      icon={Cpu}
                      iconColor={CPU_COLOR}
                      label={t("details.cpu")}
                      value={usage?.cpu == null ? "—" : percent(usage.cpu)}
                      detail={
                        usage
                          ? t("details.cpuDetail", { system: percent(usage.cpuSystem), wait: percent(usage.cpuWait) })
                          : "…"
                      }
                    >
                      <Sparkline values={usage?.cpus ?? []} color={CPU_COLOR} floor={0.01} width={240} height={36} />
                    </Reading>
                    <Reading
                      icon={MemoryStick}
                      label={t("overview.memory")}
                      value={formatBytes(node.memUsedBytes)}
                      detail={t("overview.memoryDesc")}
                    />

                    <Reading
                      icon={HardDrive}
                      label={t("details.storage")}
                      value={formatBytes(node.diskUsedBytes)}
                      detail={<DiskFree free={d.diskFreeBytes} stopBelow={d.diskStopBelowBytes} />}
                    />
                    <Reading
                      icon={Activity}
                      iconColor={DISK_COLOR}
                      label={t("details.disk")}
                      value={usage ? formatBytes(usage.read + usage.write) : "—"}
                      unit={usage ? "/s" : undefined}
                      detail={
                        usage
                          ? t("details.diskDetail", { read: formatBytes(usage.read), write: formatBytes(usage.write) })
                          : "…"
                      }
                    >
                      <Sparkline values={usage?.disks ?? []} color={DISK_COLOR} floor={1024} width={240} height={36} />
                    </Reading>
                  </Panel>
                  {/* Where it keeps things on this computer */}
                  <Rows as="dl">
                    <Property label={t("overview.dataDir")} mono>
                      <Tooltip content={node.dataDir} mono overflowOnly>
                        <span className="truncate">{node.dataDir}</span>
                      </Tooltip>
                      <CopyButton value={node.dataDir} className="-my-1 -mr-2" />
                    </Property>
                  </Rows>
                </Section>
              </motion.div>

              {/* Its peers: which way each connection came, out of the most it
                  takes, and whether they're on the clear net or over Tor */}
              <Group title={t("details.network")} wide>
                <Panel className="flex flex-col gap-3 p-3">
                  {/* Two splits of the same peers: which way each connection came,
                      and whether it is on the clear net (IPv4, IPv6) or over Tor */}
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Tile className="flex items-center gap-5">
                      <Donut
                        segments={[
                          { value: inbound, color: IN_COLOR },
                          { value: outbound, color: OUT_COLOR },
                        ]}
                      >
                        <span className="flex flex-col leading-tight">
                          <span className="text-2xl font-semibold tabular-nums">{node.peers}</span>
                          {d.maxPeers > 0 && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {t("details.ofMax", { max: d.maxPeers })}
                            </span>
                          )}
                        </span>
                      </Donut>
                      <dl className="ml-auto grid min-w-0 grid-cols-[auto_auto_auto] items-center gap-x-2.5 gap-y-2">
                        <Legend color={IN_COLOR} label={t("peers.filter.in")} value={inbound} />
                        <Legend color={OUT_COLOR} label={t("peers.filter.out")} value={outbound} />
                      </dl>
                    </Tile>
                    <Tile className="flex items-center gap-5">
                      <Donut
                        segments={[
                          { value: ipv4, color: IPV4_COLOR },
                          { value: ipv6, color: IPV6_COLOR },
                          { value: onion, color: ONION_COLOR },
                        ]}
                      >
                        <span className="flex flex-col leading-tight">
                          <span className="text-2xl font-semibold tabular-nums">
                            {peers.length > 0 ? `${Math.round((clear / peers.length) * 100)}%` : "—"}
                          </span>
                          <span className="text-xs text-muted-foreground">{t("details.clearnet")}</span>
                        </span>
                      </Donut>
                      <dl className="ml-auto grid min-w-0 grid-cols-[auto_auto_auto] items-center gap-x-2.5 gap-y-2">
                        <Legend color={IPV4_COLOR} label="IPv4" value={ipv4} />
                        <Legend color={IPV6_COLOR} label="IPv6" value={ipv6} />
                        <Legend color={ONION_COLOR} label={t("details.onion")} value={onion} />
                      </dl>
                    </Tile>
                    {/* What flows to and from the peers, now and in the last minute */}
                    <Flow
                      icon={ArrowDown}
                      label={t("details.download")}
                      rate={usage?.down}
                      rates={usage?.downs ?? []}
                      total={usage?.inBytes}
                      color={IPV4_COLOR}
                    />
                    <Flow
                      icon={ArrowUp}
                      label={t("details.upload")}
                      rate={usage?.up}
                      rates={usage?.ups ?? []}
                      total={usage?.outBytes}
                      color={OUT_COLOR}
                    />
                  </div>
                </Panel>
                {/* Whether other peers can reach it, and the address they'd dial */}
                <Rows as="dl">
                  <Property label={t("details.reachability")}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Indicator grade={d.inboundAllowed ? "good" : "off"} />
                      <span className="truncate">
                        {d.inboundAllowed ? t("details.reachable") : t("details.outboundOnly")}
                        {d.inboundAllowed && (
                          <span className="selectable ml-1.5 font-mono text-sm">{`${d.externalIp}:${d.listenPort}`}</span>
                        )}
                      </span>
                      {d.inboundAllowed && (
                        <CopyButton value={`${d.externalIp}:${d.listenPort}`} className="-my-1 -mr-2" />
                      )}
                    </span>
                  </Property>
                  {/* v2 nodes have no enode URL: leave the row out rather than show a dash */}
                  {d.enode && (
                    <Property label={t("details.enode")} mono>
                      <Copyable value={d.enode} short={shortHex(d.enode, 18, 14)} />
                    </Property>
                  )}
                </Rows>
              </Group>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The peer charts' colours: the brand's violet for the node's own dials, amber for those that came in (as the peer list marks them), and the networks. */
const OUT_COLOR = "var(--app-brand-mark)";
const IN_COLOR = "var(--warn)";
const IPV4_COLOR = "var(--info)";
const IPV6_COLOR = "color-mix(in oklab, var(--info) 55%, transparent)";
const ONION_COLOR = "#a855f7";
/** The usage charts' own colours. */
const CPU_COLOR = "var(--good)";
const DISK_COLOR = "var(--warn)";

/** percent shows a share (1 = 100%) as a whole percentage, or with one decimal below 10%. */
function percent(share: number): string {
  const p = share * 100;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

/** Legend is one segment of a chart: its colour, name and count, in the columns of its list. */
function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <>
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{value}</dd>
    </>
  );
}

/** Flow is one direction of the traffic, as a Reading: its speed now, the last minute's as a sparkline, and the total since the app started. */
function Flow({
  icon,
  label,
  rate,
  rates,
  total,
  color,
}: {
  icon: LucideIcon;
  label: string;
  /** Undefined until the second reading, or while the daemon isn't counting. */
  rate?: number;
  rates: number[];
  total?: number;
  color: string;
}) {
  const t = useT();
  return (
    <Reading
      icon={icon}
      iconColor={color}
      label={label}
      value={rate === undefined ? "—" : formatBytes(rate)}
      unit={rate === undefined ? undefined : "/s"}
      detail={total === undefined ? "…" : t("details.trafficTotal", { size: formatBytes(total) })}
    >
      <Sparkline values={rates} color={color} floor={1024} width={240} height={36} />
    </Reading>
  );
}

/**
 * Reading is one tile of the Usage section: an icon and its name, the
 * value large, an optional chart under it, and a line of detail.
 */
function Reading({
  icon: Icon,
  iconColor,
  label,
  value,
  unit,
  detail,
  children,
}: {
  icon: LucideIcon;
  iconColor?: string;
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Tile className="flex min-w-0 flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Icon className="size-3.5" style={iconColor ? { color: iconColor } : undefined} />
        {label}
      </span>
      <span className="truncate text-2xl font-semibold tracking-tight tabular-nums">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
      </span>
      {children}
      {detail && <span className="mt-auto truncate text-xs text-muted-foreground tabular-nums">{detail}</span>}
    </Tile>
  );
}

/** Group is one group of the details: its own titled section, arriving in turn. */
function Group({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <motion.div variants={STAGGER.item} className={wide ? "lg:col-span-2" : undefined}>
      <Section title={title}>{children}</Section>
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
  const tone =
    stopBelow > 0 && free <= stopBelow
      ? "text-critical-ink"
      : stopBelow > 0 && free <= 2 * stopBelow
        ? "text-warn-ink"
        : "";
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className={tone}>{formatBytes(free)}</span>
      {stopBelow > 0 && (
        <span className="truncate text-sm text-muted-foreground">
          {t("details.stopsBelow", { size: formatBytes(stopBelow) })}
        </span>
      )}
    </span>
  );
}
