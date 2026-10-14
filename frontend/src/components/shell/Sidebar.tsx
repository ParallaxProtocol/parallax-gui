import { Link, NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { LayoutGrid, Pickaxe, Settings2, Wallet } from "lucide-react";
import { formatDuration, formatHashrate, formatInt } from "../../lib/format";
import { GLIDE, SPRING } from "../../lib/motion";
import { nodeState, syncProgress, useMiner, useNode, useWallet } from "../../lib/live";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../ui/Indicator";
import { Meter } from "../ui/bits";
import { Counter } from "../ui/Counter";
import logo from "../../assets/logo.svg";

/**
 * Sidebar is the window's source list: the four destinations, each with
 * a live hint (the wallet's link, the miner's rate), under a header that
 * is part of the window's title bar, and the node's card at its foot.
 */
export default function Sidebar() {
  const t = useT();

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="drag flex h-11 shrink-0 items-center gap-2 px-4">
        <span className="traffic-light-gap" />
        <img src={logo} alt="" className="size-4.5" />
        <span className="font-semibold">Parallax</span>
      </div>

      <nav className="flex flex-col gap-px px-2 pt-2" aria-label={t("nav.label")}>
        <NavItem to="/" icon={LayoutGrid} label={t("nav.overview")} />
        <NavItem to="/wallet" icon={Wallet} label={t("nav.wallet")} adornment={<WalletDot />} />
        <NavItem to="/mining" icon={Pickaxe} label={t("nav.mining")} adornment={<MinerRate />} />
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col px-2" aria-label={t("nav.settings")}>
        <NavItem to="/settings" icon={Settings2} label={t("nav.settings")} />
      </nav>

      <NodeCard />
    </aside>
  );
}

// The adornments read the live streams themselves, so a new hashrate every
// poll re-renders one span rather than the whole sidebar
function WalletDot() {
  const t = useT();
  const wallet = useWallet();
  return (
    <AnimatePresence>
      {wallet.connected && (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={GLIDE}>
          <Indicator grade="good" ping cause="wallet" label={t("nav.walletConnected")} />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function MinerRate() {
  const { status } = useMiner();
  return (
    <AnimatePresence>
      {status?.running && (
        <motion.span
          className="text-sm text-muted-foreground"
          initial={{ opacity: 0, x: 4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={GLIDE}
        >
          <Counter value={status.hashrate} format={formatHashrate} />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
  adornment,
}: {
  to: string;
  icon: typeof LayoutGrid;
  label: string;
  adornment?: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `group relative flex h-7 items-center gap-2 rounded-md px-2 transition-colors ${
          isActive ? "text-foreground" : "text-foreground/80 hover:bg-hover"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* The selection glides from item to item */}
          {isActive && (
            <motion.span
              layoutId="sidebar-selection"
              layoutDependency={isActive}
              transition={GLIDE}
              className="absolute inset-0 rounded-md bg-selected shadow-[0_1px_0_rgb(255_255_255/3%)_inset]"
            />
          )}
          <Icon
            className={`relative size-4 transition-[color,transform] duration-200 group-active:scale-90 ${
              isActive ? "text-brand" : "text-muted-foreground"
            }`}
            strokeWidth={1.75}
          />
          <span className="relative flex-1 truncate">{label}</span>
          <span className="relative">{adornment}</span>
        </>
      )}
    </NavLink>
  );
}

const STATE_GRADE: Record<ReturnType<typeof nodeState>, Grade> = {
  stopped: "off",
  syncing: "info",
  synced: "good",
};

/**
 * NodeCard is the node at a glance from every page: its state, the best
 * block, peers and uptime, and the sync's progress while it catches up.
 * It opens the Overview, and grows and shrinks smoothly as its lines
 * come and go.
 */
function NodeCard() {
  const t = useT();
  const node = useNode();
  const state = nodeState(node);
  const progress = syncProgress(node);
  const running = !!node?.running;

  return (
    <Link
      to="/"
      aria-label={`${t("nav.overview")}: ${t(`node.state.${state}`)}`}
      className="m-2 block rounded-lg border border-border bg-surface/70 shadow-[var(--shadow-panel)] transition-colors hover:border-border-strong"
    >
      <motion.div layout transition={SPRING} className="flex flex-col gap-1.5 p-3">
        <motion.div layout="position" className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Indicator grade={STATE_GRADE[state]} ping={running} cause={state} />
            {t(`node.state.${state}`)}
          </span>
          {running && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t(node.peers === 1 ? "node.peer" : "node.peers", { n: node.peers })}
            </span>
          )}
        </motion.div>

        <AnimatePresence initial={false} mode="popLayout">
          {running ? (
            <motion.div
              key="running"
              layout="position"
              className="flex flex-col gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={GLIDE}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t("status.block")}</span>
                <Counter
                  value={node.currentBlock}
                  format={(v) => formatInt(Math.round(v))}
                  className="text-base font-semibold"
                />
              </div>
              {state === "syncing" && (
                <div className="flex items-center gap-2">
                  <Meter value={progress} live className="flex-1" label={t("node.state.syncing")} />
                  <Counter value={progress * 100} format={(v) => `${v.toFixed(1)}%`} className="text-xs text-muted-foreground" />
                </div>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("status.uptime", { time: formatDuration(node.uptimeSeconds) })}
              </span>
            </motion.div>
          ) : (
            <motion.span
              key="stopped"
              layout="position"
              className="text-xs text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={GLIDE}
            >
              {t("node.offlineHint")}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </Link>
  );
}
