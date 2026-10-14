import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronsUpDown, Sparkles, Wallet } from "lucide-react";
import { shortHex } from "../../lib/format";
import { FADE_OUT, GLIDE } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import logo from "../../assets/logo.svg";
import { NODE_BAR_ROOM } from "./NodeBar";
import { SettingsButton, useSettingsSheet } from "./SettingsSheet";
import { AddressAvatar } from "../ui/AddressAvatar";

/**
 * Sidebar is the window's source list: the account the wallet shows and
 * its destinations, under the app's name in the window's title bar (the
 * rest of which, over the page, is TopBar). The node has the bar along the
 * window's foot (NodeBar).
 */
export default function Sidebar() {
  const t = useT();
  // Sending and receiving need an account: until there is one they show, greyed out
  const { info, account } = useWallet();
  const noAccount = !!info && !account;
  const locked = !!info && !info.hasPassword;

  return (
    <aside className="flex w-52 shrink-0 flex-col bg-sidebar">
      {/* The title bar's part over the sidebar: the line under it runs on
          under the page's part, and the sidebar's own line starts below it */}
      <div className="drag flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="traffic-light-gap" />
        <img src={logo} alt="" className="size-4.5" />
        <span className="font-semibold">Parallax</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-r border-border" style={{ paddingBottom: NODE_BAR_ROOM }}>
        <nav className="flex flex-col gap-px px-2 pt-1" aria-label={t("nav.label")}>
          <h2 className="px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground">{t("nav.wallet")}</h2>
          {locked ? (
            // Until the wallet has its password, only the welcome
            <NavItem to="/" icon={Sparkles} label={t("nav.welcome")} />
          ) : (
            <>
              <AccountSwitcher />
              <NavItem to="/" icon={Wallet} label={t("nav.overview")} />
              <NavItem to="/send" icon={ArrowUpRight} label={t("nav.send")} disabled={noAccount} />
              <NavItem to="/receive" icon={ArrowDownLeft} label={t("nav.receive")} disabled={noAccount} />
            </>
          )}
        </nav>

        <div className="flex-1" />

        <div className="flex flex-col px-2 pb-2">
          <SettingsButton />
        </div>
      </div>
    </aside>
  );
}

/**
 * AccountSwitcher shows the account the wallet pages are about, and opens
 * a list of the others to switch to. Escape or a click outside closes it.
 */
function AccountSwitcher() {
  const t = useT();
  const { openAt } = useSettingsSheet();
  const { info, account, select } = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  // Another page closes it, however it was reached
  useEffect(() => setOpen(false), [pathname]);

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
        className="glass flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:border-border-strong"
      >
        <AddressAvatar address={account.address} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{accountLabel(account, accounts, t)}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {shortHex(account.address, 8, 6)}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={t("nav.accounts")}
            className="menu absolute inset-x-0 top-full z-50 mt-1 flex flex-col gap-px p-1"
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
                    className="menu-item py-1"
                  >
                    <AddressAvatar address={a.address} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{accountLabel(a, accounts, t)}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {shortHex(a.address, 8, 6)}
                      </span>
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
                openAt("accounts");
              }}
              className="menu-item text-muted-foreground hover:text-foreground"
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
  disabled,
}: {
  to: string;
  icon: typeof Wallet;
  label: string;
  /** Shown but not reachable, until what it needs exists. */
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-foreground/35"
      >
        <Icon className="size-4 text-muted-foreground/50" strokeWidth={1.75} />
        <span className="flex-1 truncate">{label}</span>
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 transition-colors ${
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
              className="absolute inset-0 rounded-lg bg-selected shadow-[0_1px_0_rgb(255_255_255/3%)_inset]"
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
