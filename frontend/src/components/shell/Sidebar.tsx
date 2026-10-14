import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronsUpDown, KeyRound, Settings2, Wallet } from "lucide-react";
import { formatDuration, formatInt, shortHex } from "../../lib/format";
import { FADE_OUT, GLIDE, SPRING } from "../../lib/motion";
import { nodeState, syncProgress, useNode } from "../../lib/live";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../ui/Indicator";
import { Meter } from "../ui/bits";
import { Counter } from "../ui/Counter";
import logo from "../../assets/logo.svg";

/**
 * Sidebar is the window's source list: the account the wallet shows and
 * its destinations, under a header that is part of the window's title
 * bar, and the node's card at its foot, the one way into the node's page.
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
        <AccountSwitcher />
        <NavItem to="/" icon={Wallet} label={t("nav.overview")} />
        <NavItem to="/send" icon={ArrowUpRight} label={t("nav.send")} />
        <NavItem to="/receive" icon={ArrowDownLeft} label={t("nav.receive")} />
        <NavItem to="/accounts" icon={KeyRound} label={t("nav.accounts")} />
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col px-2" aria-label={t("nav.settings")}>
        <NavItem to="/settings" icon={Settings2} label={t("nav.settings")} />
      </nav>

      <NodeCard />
    </aside>
  );
}

/**
 * AccountSwitcher shows the account the wallet pages are about, and opens
 * a list of the others to switch to. Escape or a click outside closes it.
 */
function AccountSwitcher() {
  const t = useT();
  const navigate = useNavigate();
  const { info, account, select } = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!info || !account) return null;
  const accounts = info.accounts;

  return (
    <div ref={box} className="relative mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface/70 px-2 py-1.5 text-left transition-colors hover:border-border-strong"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{accountLabel(account, accounts, t)}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">{shortHex(account.address, 8, 6)}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={t("nav.accounts")}
            className="absolute inset-x-0 top-full z-50 mt-1 flex flex-col gap-px rounded-lg border border-border-strong bg-background p-1 shadow-[0_8px_24px_rgb(0_0_0/22%)]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            transition={GLIDE}
          >
            <div className="flex max-h-64 flex-col gap-px overflow-y-auto">
              {accounts.map((a) => {
                const here = a.address === account.address;
                return (
                  <button
                    key={a.address}
                    type="button"
                    role="option"
                    aria-selected={here}
                    onClick={() => {
                      setOpen(false);
                      if (!here) select(a.address);
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{accountLabel(a, accounts, t)}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{shortHex(a.address, 8, 6)}</span>
                    </span>
                    {here && <Check className="size-3.5 shrink-0 text-brand" />}
                  </button>
                );
              })}
            </div>
            <div className="my-0.5 border-t border-border" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/accounts");
              }}
              className="rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              {t("nav.manageAccounts")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Wallet;
  label: string;
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
