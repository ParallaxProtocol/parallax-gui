import { useState } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { LayoutGrid, Loader2, Pickaxe, Power, Settings2, Wallet } from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, formatHashrate, formatInt } from "../../lib/format";
import { nodeState, syncProgress, useLive } from "../../lib/live";
import { SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../ui/Indicator";
import { Rolling } from "../ui/Rolling";
import { Label } from "../ui/Plate";
import { Meter } from "../ui/bits";
import logo from "../../assets/logo.svg";

/**
 * Sidebar is the app's spine: the brand, the four destinations, and the
 * node's heartbeat pinned at the bottom so its state is in view from
 * every page.
 */
export default function Sidebar({ version }: { version: string }) {
  const t = useT();
  const { wallet, miner } = useLive();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <a href="#/" className="group flex items-center gap-3 px-5 pt-6 pb-7">
        <img
          src={logo}
          alt=""
          className="size-8 transition-transform duration-700 ease-out group-hover:rotate-[60deg]"
        />
        <div className="flex flex-col leading-none">
          <span className="text-[17px] font-semibold tracking-tight">Parallax</span>
          <Label className="mt-1 text-[9px]">
            {t("brand.desktop")} {version && `· ${version}`}
          </Label>
        </div>
      </a>

      <nav className="flex flex-col gap-0.5 px-3" aria-label={t("nav.label")}>
        <NavItem to="/" icon={LayoutGrid} label={t("nav.overview")} />
        <NavItem
          to="/wallet"
          icon={Wallet}
          label={t("nav.wallet")}
          adornment={
            wallet.connected ? (
              <Indicator grade="good" ping cause="wallet" label={t("nav.walletConnected")} />
            ) : null
          }
        />
        <NavItem
          to="/mining"
          icon={Pickaxe}
          label={t("nav.mining")}
          adornment={
            miner?.running ? (
              <span className="font-mono text-[10px] text-brand tabular-nums">
                {formatHashrate(miner.hashrate)}
              </span>
            ) : null
          }
        />
        <NavItem to="/settings" icon={Settings2} label={t("nav.settings")} />
      </nav>

      <div className="flex-1" />
      <NodeDock />
    </aside>
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
    <NavLink to={to} end={to === "/"} className="relative block">
      {({ isActive }) => (
        <>
          {/* The current page's mark springs from item to item */}
          {isActive && (
            <motion.span
              layoutId="nav-current"
              transition={SPRING}
              className="absolute inset-0 rounded-md bg-foreground/[0.06]"
            >
              <span className="brand-gradient-mark absolute inset-y-2 left-0 w-0.5 rounded-full" />
            </motion.span>
          )}
          <span
            className={`relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
            }`}
          >
            <Icon className={`size-[18px] ${isActive ? "text-brand" : ""}`} strokeWidth={1.75} />
            <span className="flex-1">{label}</span>
            {adornment}
          </span>
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
 * NodeDock is the node's heartbeat: its state, the block height rolling
 * as blocks arrive, peers and uptime, sync progress while catching up,
 * and the power switch.
 */
function NodeDock() {
  const t = useT();
  const { node, refresh } = useLive();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const state = nodeState(node);
  const progress = syncProgress(node);

  const toggle = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (node?.running) await api.stopNode();
      else await api.startNode();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="m-3 rounded-md border border-border bg-surface-elevated p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Indicator grade={STATE_GRADE[state]} ping={state === "syncing" ? "always" : true} cause={state} />
          <Label className="text-[10px]">{t(`node.state.${state}`)}</Label>
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          title={node?.running ? t("node.stop") : t("node.start")}
          aria-label={node?.running ? t("node.stop") : t("node.start")}
          className={`grid size-7 place-items-center rounded-full border transition-colors ${
            node?.running
              ? "border-brand/50 text-brand hover:border-critical/60 hover:text-critical-ink"
              : "border-border-strong text-muted-foreground hover:border-brand/60 hover:text-brand"
          }`}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
        </button>
      </div>

      {node?.running ? (
        <>
          <div className="mt-3 font-mono text-xl tracking-tight tabular-nums">
            <span className="text-muted-foreground">#</span>
            <Rolling value={formatInt(node.currentBlock)} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {t(node.peers === 1 ? "node.peer" : "node.peers", { n: node.peers })} ·{" "}
            {formatDuration(node.uptimeSeconds)}
          </div>
          {state === "syncing" && (
            <div className="mt-3 flex items-center gap-2">
              <Meter value={progress} active className="flex-1" label={t("node.state.syncing")} />
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {(progress * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("node.offlineHint")}</p>
      )}
      {err && <p className="mt-2 line-clamp-3 text-xs text-critical-ink" title={err}>{err}</p>}
    </div>
  );
}
