import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, BookUser, Check, ChevronsUpDown, FileCheck, FileSignature, PenLine, Radio, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { useOfflineMode } from "../../lib/offline";
import { api } from "../../lib/api";
import { formatLax, shortHex } from "../../lib/format";
import { FADE_OUT, GLIDE } from "../../lib/motion";
import { accountLabel, useBalances, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import logo from "../../assets/logo.svg";
import { NODE_BAR_ROOM } from "./NodeBar";
import { SettingsButton, useSettingsSheet } from "./SettingsSheet";
import { AddressAvatar } from "../ui/AddressAvatar";
import { Pill } from "../ui/Pill";
import { Tooltip } from "../ui/Tooltip";

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
  const offline = useOfflineMode();
  const watching = !!info?.accounts.some((a) => a.watchOnly);

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-sidebar">
      {/* The title bar's part over the sidebar: the line under it runs on
          under the page's part, and the sidebar's own line starts below it */}
      <div className="drag flex h-13 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <span className="traffic-light-gap" />
        <img src={logo} alt="" className="size-5" />
        <span className="text-[15px] font-semibold">Parallax</span>
        <ProfileBadge />
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-r border-border" style={{ paddingBottom: NODE_BAR_ROOM }}>
        {/* Grouped by scope: what is about the account the switcher shows,
            then what spans every account */}
        <nav className="flex flex-col gap-0.5 px-3 pt-3" aria-label={t("nav.label")}>
          <GroupHeading first>{t("nav.wallet")}</GroupHeading>
          {locked ? (
            // Until the wallet has its password, only the welcome
            <NavItem to="/" icon={Sparkles} label={t("nav.welcome")} />
          ) : offline ? (
            // The offline signer: its accounts, then signing, which the
            // request's own account decides, not the switcher
            <>
              <AccountSwitcher />
              <NavItem to="/receive" icon={ArrowDownLeft} label={t("nav.receive")} disabled={noAccount} />
              <GroupHeading>{t("nav.group.signing")}</GroupHeading>
              <NavItem to="/" icon={ShieldCheck} label={t("offline.nav.home")} />
              <NavItem to="/sign" icon={PenLine} label={t("offline.nav.sign")} disabled={noAccount} />
              <NavItem to="/messages/sign" icon={FileSignature} label={t("nav.signMessage")} disabled={noAccount} />
              <NavItem to="/messages/verify" icon={FileCheck} label={t("nav.verifyMessage")} />
              <NavItem to="/contacts" icon={BookUser} label={t("nav.contacts")} />
            </>
          ) : (
            <>
              <AccountSwitcher />
              <NavItem to="/" icon={Wallet} label={t("nav.overview")} />
              <NavItem to="/send" icon={ArrowUpRight} label={t("nav.send")} disabled={noAccount} />
              <NavItem to="/receive" icon={ArrowDownLeft} label={t("nav.receive")} disabled={noAccount} />
              <NavItem to="/messages/sign" icon={FileSignature} label={t("nav.signMessage")} disabled={noAccount} />
              <GroupHeading>{t("nav.group.allAccounts")}</GroupHeading>
              <NavItem to="/contacts" icon={BookUser} label={t("nav.contacts")} />
              <NavItem to="/messages/verify" icon={FileCheck} label={t("nav.verifyMessage")} />
              {/* Takes a transaction signed offline for any watch-only account */}
              {watching && <NavItem to="/broadcast" icon={Radio} label={t("offline.nav.broadcast")} />}
            </>
          )}
        </nav>

        <div className="flex-1" />

        <div className="flex flex-col px-3 pb-3">
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
  const balances = useBalances();
  // An offline signer has no chain to read balances from
  const offline = useOfflineMode();
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
    <div ref={box} className="relative mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="glass flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:border-border-strong"
      >
        <AddressAvatar address={account.address} size={34} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold">{accountLabel(account, accounts, t)}</span>
            {account.watchOnly && <WatchOnlyBadge />}
          </span>
          {!offline && (
            <span className="block truncate text-sm tabular-nums">
              <Balance wei={balances[account.address]} />
            </span>
          )}
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {shortHex(account.address, 8, 6)}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={t("nav.accounts")}
            className="menu absolute top-full left-0 z-50 mt-1 flex w-96 flex-col gap-px p-1.5"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            transition={GLIDE}
          >
            <div className="flex max-h-96 flex-col gap-px overflow-y-auto">
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
                    className="menu-item gap-3 py-2"
                  >
                    <AddressAvatar address={a.address} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{accountLabel(a, accounts, t)}</span>
                        {a.watchOnly && <WatchOnlyBadge />}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {shortHex(a.address, 8, 6)}
                      </span>
                    </span>
                    {!offline && (
                      <span className="shrink-0 pl-2 text-right tabular-nums">
                        <Balance wei={balances[a.address]} />
                      </span>
                    )}
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      {here && <Check className="size-3.5 text-brand" />}
                    </span>
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

/** ProfileBadge names the development profile this copy runs as, so two copies side by side can be told apart. */
function ProfileBadge() {
  const [profile, setProfile] = useState("");
  useEffect(() => {
    api
      .profile()
      .then((p) => setProfile(p ?? ""))
      .catch(() => {});
  }, []);
  if (!profile) return null;
  return (
    <span className="truncate rounded-full bg-brand/15 px-2 py-0.5 font-mono text-xs font-medium text-brand">{profile}</span>
  );
}

/** GroupHeading titles a group of the sidebar's items, as Settings' sidebar does. */
function GroupHeading({ first, children }: { first?: boolean; children: string }) {
  return <h2 className={`px-2.5 pb-1.5 text-sm font-semibold text-muted-foreground ${first ? "" : "pt-5"}`}>{children}</h2>;
}

/** WatchOnlyBadge marks an account whose key is on an offline signer. */
function WatchOnlyBadge() {
  const t = useT();
  return (
    <Tooltip content={t("offline.watchOnly.desc")}>
      <Pill className="shrink-0">{t("offline.watchOnly")}</Pill>
    </Tooltip>
  );
}

/** Balance is an amount of LAX, or a dash until it is known. */
function Balance({ wei }: { wei?: string }) {
  if (wei === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {formatLax(wei, 4)} <span className="text-muted-foreground">LAX</span>
    </>
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
        className="flex h-10 cursor-default items-center gap-3 rounded-lg px-2.5 text-[15px] text-foreground/35"
      >
        <Icon className="size-[18px] text-muted-foreground/50" strokeWidth={1.75} />
        <span className="flex-1 truncate">{label}</span>
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `group relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-[15px] transition-colors ${
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
            className={`relative size-[18px] transition-[color,transform] duration-200 group-active:scale-90 ${
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
