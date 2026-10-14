import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2, Minimize2 } from "lucide-react";
import { api, NodeDetails, PeerView } from "../../lib/api";
import { formatBytes, formatDuration, formatGwei, formatInt } from "../../lib/format";
import { useBlocks, useNode } from "../../lib/live";
import { SPRING, STAGGER, useStagger } from "../../lib/motion";
import { Counter } from "../../components/ui/Counter";
import { useT } from "../../i18n";
import { Stat } from "../../components/ui/Panel";
import BlockHero, { Stopped } from "./BlockHero";
import NodeInfo from "./NodeInfo";
import MempoolList from "./MempoolList";
import PeerList from "./PeerList";
import { PAGE_WIDE } from "../../lib/layout";

export default function Overview() {
  const t = useT();
  const node = useNode();
  const blocks = useBlocks();
  // The strip's figure opened into its list, if any
  const [open, setOpen] = useState<"peers" | "mempool" | null>(null);
  const toggle = (which: "peers" | "mempool") => setOpen((o) => (o === which ? null : which));
  const peersOpen = open === "peers";
  const [peerList, setPeerList] = useState<PeerView[]>([]);
  const [peerErr, setPeerErr] = useState<string | null>(null);
  // Bumped after a peer action, to fetch the peers again at once
  const [peerTick, setPeerTick] = useState(0);
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const running = !!node?.running;
  const stagger = useStagger();

  // The peers for the direction split, and for the list while it is open,
  // when it polls faster so connections come and go as they happen
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const refresh = () =>
      api
        .peers()
        .then((p) => {
          if (!alive) return;
          setPeerList(p);
          setPeerErr(null);
        })
        .catch((e: any) => alive && setPeerErr(e?.message || String(e)));
    refresh();
    const id = setInterval(refresh, peersOpen ? 2000 : 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [running, peersOpen, peerTick]);

  // The node's fuller details, for the mempool figure and the Node section.
  // Slower than the status: they move slowly, and a fee estimate is not free
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const refresh = () =>
      api
        .nodeDetails()
        .then((d) => alive && setDetails(d))
        .catch(() => {});
    refresh();
    const id = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [running]);

  if (!node) return null;
  if (!running) return <Stopped />;

  const inbound = peerList.filter((p) => p.inbound).length;
  const outbound = peerList.length - inbound;

  return (
    // The page's one orchestrated entrance: its blocks arrive in turn
    <motion.div className={`flex flex-col gap-5 p-5 ${PAGE_WIDE}`} {...stagger}>
      <motion.div variants={STAGGER.item}>
        <BlockHero />
      </motion.div>

      {/* The node's figures. Opening the peers or the mempool widens that
          figure across the strip, the others making way, and unfolds its
          list below */}
      <motion.div variants={STAGGER.item}>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-panel)]">
          <div className="flex">
            <AnimatePresence initial={false}>
              {(open === null || open === "peers") && (
                <Collapsing key="peers" edge>
                  <Expander label={t("overview.peers")} open={open === "peers"} onToggle={() => toggle("peers")}>
                    {(chevron) => (
                      <Stat
                        label={t("overview.peers")}
                        value={<Counter value={node.peers} format={(v) => String(Math.round(v))} />}
                        detail={t("overview.peerSplit", { in: inbound, out: outbound })}
                        action={chevron}
                      />
                    )}
                  </Expander>
                </Collapsing>
              )}
              {(open === null || open === "mempool") && (
                <Collapsing key="mempool" edge={open === "mempool"}>
                  <Expander label={t("details.mempool")} open={open === "mempool"} onToggle={() => toggle("mempool")}>
                    {(chevron) => (
                      <Stat
                        label={t("details.mempool")}
                        value={
                          details?.running ? (
                            <Counter value={details.txPending} format={(v) => formatInt(Math.round(v))} />
                          ) : (
                            "—"
                          )
                        }
                        unit={details?.running ? t("strip.pending") : undefined}
                        detail={
                          details?.running
                            ? `${t("strip.queued", { n: formatInt(details.txQueued) })} · ${formatBytes(details.txBytes)}`
                            : "…"
                        }
                        action={chevron}
                      />
                    )}
                  </Expander>
                </Collapsing>
              )}
              {open === null && (
                <Collapsing key="fee">
                  <FeeStat details={details} />
                </Collapsing>
              )}
              {open === null && (
                <Collapsing key="uptime">
                  <Stat label={t("overview.uptime")} value={formatDuration(node.uptimeSeconds)} detail={t("overview.uptimeDesc")} />
                </Collapsing>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key={open}
                className="overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SPRING}
              >
                {open === "peers" ? <PeerList peers={peerList} error={peerErr} onChanged={() => setPeerTick((n) => n + 1)} /> : <MempoolList known={details?.running ? { pending: details.txPending, queued: details.txQueued } : undefined} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <motion.div variants={STAGGER.item}>
        <NodeInfo node={node} details={details} head={blocks[0]} peers={peerList} />
      </motion.div>
    </motion.div>
  );
}

/**
 * Collapsing is a figure of the strip that can make way: it shrinks to
 * nothing, its share of the row going to the figures that stay, and fades;
 * it grows back the same way. Below a minimum width its content clips
 * rather than rewrapping, so the text holds still as the cell narrows.
 */
function Collapsing({ edge, children }: { edge?: boolean; children: ReactNode }) {
  // The divider on its left fades with the figure before it as this one
  // becomes the strip's first, rather than popping off once that one is
  // gone. A colour, not a width: browsers round a border under 1px up to 1px
  return (
    <motion.div
      className={`min-w-0 basis-0 overflow-hidden border-l transition-[border-color] duration-300 ${
        edge ? "border-l-transparent" : "border-l-border"
      }`}
      initial={{ flexGrow: 0, opacity: 0 }}
      animate={{ flexGrow: 1, opacity: 1 }}
      exit={{ flexGrow: 0, opacity: 0 }}
      transition={SPRING}
    >
      <div className="h-full w-full min-w-36">{children}</div>
    </motion.div>
  );
}

/**
 * Expander makes a whole figure the switch that opens its list, with the
 * expand or collapse icon (handed to the figure for its corner), as the
 * node bar and Settings have.
 */
function Expander({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: (chevron: ReactNode) => ReactNode;
}) {
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={open}
      aria-label={`${label}: ${open ? t("overview.hidePeers") : t("overview.viewPeers")}`}
      className="group h-full transition-colors hover:bg-hover focus-visible:outline-offset-[-2px]"
    >
      {children(
        <span className="-my-1 -mr-2 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors group-hover:text-foreground">
          {open ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </span>,
      )}
    </div>
  );
}

/**
 * FeeStat is the fee to offer now: the smart fee estimate when the
 * estimator has one, otherwise the suggested gas price, its detail line
 * saying which it is.
 */
function FeeStat({ details: d }: { details: NodeDetails | null }) {
  const t = useT();
  if (!d?.running) return <Stat label={t("strip.fee")} value="—" detail="…" />;
  const smart = d.smartFee && !!d.smartFeeWei && !d.smartFeeFallback;
  const wei = smart ? d.smartFeeWei : d.gasPriceWei;
  const [amount, unit] = wei ? formatGwei(wei).split(" ") : ["—", undefined];
  return (
    <Stat
      label={t("strip.fee")}
      value={amount}
      unit={unit}
      detail={
        smart
          ? t("strip.feeTarget", { n: d.smartFeeTarget })
          : d.smartFee
            ? t("strip.feeWarming")
            : t("strip.feeSuggested")
      }
    />
  );
}
