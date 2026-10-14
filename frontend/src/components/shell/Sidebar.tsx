import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Plug, Settings2, Wallet } from "lucide-react";
import { formatDuration, formatInt } from "../../lib/format";
import { GLIDE, SPRING } from "../../lib/motion";
import { nodeState, syncProgress, useNode, useWallet } from "../../lib/live";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../ui/Indicator";
import { Meter } from "../ui/bits";
import { Counter } from "../ui/Counter";
import logo from "../../assets/logo.svg";

/**
 * Sidebar is the window's source list: the wallet's destinations, the
 * connection's with a live hint of its link, under a header that is part
 * of the window's title bar, and the node's card at its foot, the one way
 * into the node's page.
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
        <h2 className="px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground">{t("nav.wallet")}</h2>
        <NavItem to="/" icon={Wallet} label={t("nav.account")} />
        <NavItem to="/connect" icon={Plug} label={t("nav.connect")} adornment={<WalletDot />} />
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col px-2" aria-label={t("nav.settings")}>
        <NavItem to="/settings" icon={Settings2} label={t("nav.settings")} />
      </nav>

      <NodeCard />
    </aside>
  );
}

// The adornment reads the live stream itself, so a wallet status change
// re-renders one span rather than the whole sidebar
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

function NavItem({
  to,
  icon: Icon,
  label,
  adornment,
}: {
  to: string;
  icon: typeof Wallet;
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
 * It opens the node's page, lit while that page shows, and grows and
 * shrinks smoothly as its lines come and go.
 */
function NodeCard() {
  const t = useT();
  const node = useNode();
  const state = nodeState(node);
  const progress = syncProgress(node);
  const running = !!node?.running;

  return (
    <NavLink
      to="/node"
      aria-label={`${t("nav.node")}: ${t(`node.state.${state}`)}`}
      className={({ isActive }) =>
        `m-2 block rounded-lg border shadow-[var(--shadow-panel)] transition-colors ${
          isActive ? "border-brand/50 bg-selected" : "border-border bg-surface/70 hover:border-border-strong"
        }`
      }
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
    </NavLink>
  );
}
