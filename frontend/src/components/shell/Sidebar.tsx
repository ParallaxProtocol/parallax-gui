import { NavLink } from "react-router-dom";
import { LayoutGrid, Pickaxe, Settings2, Wallet } from "lucide-react";
import { formatHashrate } from "../../lib/format";
import { useMiner, useWallet } from "../../lib/live";
import { useT } from "../../i18n";
import { Indicator } from "../ui/Indicator";
import logo from "../../assets/logo.svg";

/**
 * Sidebar is the window's source list: the four destinations, each with
 * a live hint (the wallet's link, the miner's rate), under a header that
 * is part of the window's title bar.
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

      <nav className="flex flex-col px-2 pb-2" aria-label={t("nav.settings")}>
        <NavItem to="/settings" icon={Settings2} label={t("nav.settings")} />
      </nav>
    </aside>
  );
}

// The adornments read the live streams themselves, so a new hashrate every
// poll re-renders one span rather than the whole sidebar
function WalletDot() {
  const t = useT();
  const wallet = useWallet();
  return wallet.connected ? <Indicator grade="good" label={t("nav.walletConnected")} /> : null;
}

function MinerRate() {
  const { status } = useMiner();
  return status?.running ? (
    <span className="text-sm text-muted-foreground tabular-nums">{formatHashrate(status.hashrate)}</span>
  ) : null;
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
        `flex h-7 items-center gap-2 rounded-md px-2 ${isActive ? "bg-selected text-foreground" : "text-foreground/80 hover:bg-hover"}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={`size-4 ${isActive ? "text-brand" : "text-muted-foreground"}`} strokeWidth={1.75} />
          <span className="flex-1 truncate">{label}</span>
          {adornment}
        </>
      )}
    </NavLink>
  );
}
