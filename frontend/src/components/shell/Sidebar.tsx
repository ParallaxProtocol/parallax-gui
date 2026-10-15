import { Fragment, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookUser,
  ChevronsUpDown,
  FileCheck,
  FileSignature,
  PenLine,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useOfflineMode } from "../../lib/offline";
import { SIDEBAR_RAIL, SIDEBAR_RAIL_MAC, SIDEBAR_WIDTH, useSidebar } from "../../lib/sidebar";
import { api } from "../../lib/api";
import { FADE_IN, FADE_OUT, GLIDE, ROW_IN, SPRING, useStagger } from "../../lib/motion";
import { accountLabel, groupAccounts, useBalances, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import logo from "../../assets/logo.svg";
import { NODE_BAR_ROOM } from "./NodeBar";
import { SettingsButton, useSettingsSheet } from "./SettingsSheet";
import { AddressAvatar } from "../ui/AddressAvatar";
import { Balance, ShortAddress, WatchOnlyBadge } from "../ui/AccountParts";
import { CopyButton } from "../ui/bits";
import { Tooltip } from "../ui/Tooltip";

/** macOS keeps its traffic lights over the sidebar's top left (public/boot.js marks the platform). */
const MAC = document.documentElement.dataset.platform === "darwin";
const RAIL = MAC ? SIDEBAR_RAIL_MAC : SIDEBAR_RAIL;
/** An item's width in the rail: its icon and the padding around it. */
const RAIL_ITEM = 40;
/** The account card's width open: the sidebar's, less the items' padding. */
const CARD_WIDTH = SIDEBAR_WIDTH - 24;
/** The switcher's list: wider than the card, for names and balances side by side. */
const LIST_WIDTH = 300;
/** From how many accounts the list can be searched. */
const SEARCH_FROM = 7;
/** What fades as the sidebar collapses goes quickly; what comes back waits for the room. */
const fade = (shown: boolean) => ({
  opacity: shown ? 1 : 0,
  transition: shown ? { ...FADE_IN, delay: 0.08 } : FADE_OUT,
});

/**
 * Sidebar is the window's source list: the account the wallet shows and
 * its destinations, under the app's name in the window's title bar (the
 * rest of which, over the page, is TopBar). The node has the bar along the
 * window's foot (NodeBar). Collapsed (TopBar's button, or Ctrl+\), it
 * narrows to a rail of its icons, their names in tooltips, the page
 * gliding over to take the room.
 */
export default function Sidebar() {
  const t = useT();
  const { collapsed } = useSidebar();
  // Sending and receiving need an account: until there is one they show, greyed out
  const { info, account } = useWallet();
  const noAccount = !!info && !account;
  const locked = !!info && !info.hasPassword;
  const offline = useOfflineMode();
  const watching = !!info?.accounts.some((a) => a.watchOnly);

  return (
    <motion.aside
      className="flex shrink-0 flex-col bg-sidebar"
      initial={false}
      animate={{ width: collapsed ? RAIL : SIDEBAR_WIDTH }}
      transition={SPRING}
    >
      {/* The title bar's part over the sidebar: the line under it runs on
          under the page's part, and the sidebar's own line starts below it.
          In the rail, the logo alone (on macOS, the traffic lights alone) */}
      <motion.div
        className="drag flex h-13 shrink-0 items-center gap-2.5 overflow-hidden border-b border-border pr-4 whitespace-nowrap"
        initial={false}
        animate={{ paddingLeft: collapsed && !MAC ? (RAIL - 20) / 2 : 16 }}
        transition={SPRING}
      >
        <span className="traffic-light-gap" />
        <motion.img src={logo} alt="" className="size-5 shrink-0" initial={false} animate={fade(!collapsed || !MAC)} />
        <motion.span className="flex min-w-0 items-center gap-2.5" initial={false} animate={fade(!collapsed)}>
          <span className="text-[15px] font-semibold">Parallax</span>
          <ProfileBadge />
        </motion.span>
      </motion.div>

      <div className="flex min-h-0 flex-1 flex-col border-r border-border" style={{ paddingBottom: NODE_BAR_ROOM }}>
        {/* Grouped by scope: what is about the account the switcher shows,
            then what spans every account */}
        <motion.nav
          className="flex flex-col gap-0.5 pt-3"
          aria-label={t("nav.label")}
          initial={false}
          animate={{ paddingInline: collapsed ? (RAIL - RAIL_ITEM) / 2 : 12 }}
          transition={SPRING}
        >
          {locked ? (
            // Until the wallet has its password, only the welcome
            <NavItem to="/" icon={Sparkles} label={t("nav.welcome")} />
          ) : offline ? (
            // The offline signer, laid out as the online wallet is: its home
            // and signing in place of the overview and sending
            <>
              <AccountSwitcher />
              <NavItem to="/" icon={ShieldCheck} label={t("offline.nav.home")} />
              <NavItem to="/sign" icon={PenLine} label={t("offline.nav.sign")} disabled={noAccount} />
              <NavItem to="/receive" icon={ArrowDownLeft} label={t("nav.receive")} disabled={noAccount} />
              <GroupSeparator />
              <NavItem to="/contacts" icon={BookUser} label={t("nav.contacts")} />
              <GroupSeparator />
              <NavItem to="/messages/sign" icon={FileSignature} label={t("nav.signMessage")} disabled={noAccount} />
              <NavItem to="/messages/verify" icon={FileCheck} label={t("nav.verifyMessage")} />
            </>
          ) : (
            <>
              <AccountSwitcher />
              <NavItem to="/" icon={Wallet} label={t("nav.overview")} />
              <NavItem to="/send" icon={ArrowUpRight} label={t("nav.send")} disabled={noAccount} />
              <NavItem to="/receive" icon={ArrowDownLeft} label={t("nav.receive")} disabled={noAccount} />
              <GroupSeparator />
              <NavItem to="/contacts" icon={BookUser} label={t("nav.contacts")} />
              {/* Takes a transaction signed offline for any watch-only account */}
              {watching && <NavItem to="/broadcast" icon={Radio} label={t("offline.nav.broadcast")} />}
              <GroupSeparator />
              <NavItem to="/messages/sign" icon={FileSignature} label={t("nav.signMessage")} disabled={noAccount} />
              <NavItem to="/messages/verify" icon={FileCheck} label={t("nav.verifyMessage")} />
            </>
          )}
        </motion.nav>

        <div className="flex-1" />

        <motion.div
          className="flex flex-col pb-3"
          initial={false}
          animate={{ paddingInline: collapsed ? (RAIL - RAIL_ITEM) / 2 : 12 }}
          transition={SPRING}
        >
          <SettingsButton />
        </motion.div>
      </div>
    </motion.aside>
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
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const stagger = useStagger();
  const { collapsed } = useSidebar();

  // Another page closes it, however it was reached
  useEffect(() => setOpen(false), [pathname]);
  // Each opening starts from the whole list
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // A press anywhere else closes it, heard before the page can swallow it;
  // so does the window losing focus (a press on another window or the
  // desktop). The window's drag areas would keep a press from the page
  // altogether, so while the list is open they don't drag
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("drag-off");
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onBlur = () => setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.body.classList.remove("drag-off");
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  // The check moves to the chosen account before the list closes
  const choose = (address: string) => {
    if (address === account?.address) return setOpen(false);
    select(address);
    window.setTimeout(() => setOpen(false), 180);
  };

  if (!info || !account) return null;
  const accounts = info.accounts;
  // Grouped as Settings shows them, the empty groups left out; searched by
  // name or address once there are enough to need it
  const searchable = accounts.length >= SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const shown = groupAccounts(info)
    .map((g) => ({
      ...g,
      accounts: g.accounts.filter(
        (a) => !q || accountLabel(a, accounts, t).toLowerCase().includes(q) || a.address.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.accounts.length > 0);

  const name = accountLabel(account, accounts, t);

  return (
    <div ref={box} className="relative mb-2">
      {/* One card that morphs between its two shapes on the sidebar's own
          spring: full, as wide as the sidebar's items, and in the rail a
          tile around the avatar. Its size, corners and padding move, the
          avatar shrinks in place, and what doesn't fit the tile fades as
          it's clipped, laid out at its full width so it never reflows. A
          button covering the card opens the list; the copy button sits
          above it, and a press anywhere else sinks the card */}
      <motion.div
        className="glass relative overflow-hidden transition-[transform,border-color] duration-200 hover:border-border-strong has-[.switcher-opener:active]:scale-[0.98]"
        initial={false}
        animate={{
          // Its height follows what's in it: the avatar's row, and the balance's as it folds
          width: collapsed ? RAIL_ITEM : CARD_WIDTH,
          borderRadius: collapsed ? 12 : 14,
        }}
        transition={SPRING}
      >
        <Tooltip content={collapsed ? name : null}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={name}
            className="switcher-opener absolute inset-0 rounded-[inherit]"
          />
        </Tooltip>
        <motion.div
          className="pointer-events-none relative flex items-center"
          initial={false}
          animate={{ padding: `${collapsed ? (RAIL_ITEM - 28) / 2 : 12}px`, columnGap: `${collapsed ? 0 : 12}px` }}
          transition={SPRING}
        >
          {/* The avatar, drawn to its box's size as the box shrinks; on a switch the new one fades in over the old */}
          <motion.div
            className="relative shrink-0"
            initial={false}
            animate={{ width: collapsed ? 28 : 36, height: collapsed ? 28 : 36 }}
            transition={SPRING}
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={account.address}
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: FADE_IN }}
                exit={{ opacity: 0, transition: FADE_OUT }}
              >
                <AddressAvatar address={account.address} size={36} className="size-full" />
              </motion.div>
            </AnimatePresence>
          </motion.div>
          {/* Takes the width left, but not height: the row is as tall as the
              avatar, so the tile stays square with the text hidden in it */}
          <div className="relative min-w-0 flex-1 self-stretch overflow-x-clip">
            <motion.div
              className="absolute inset-y-0 left-0 flex items-center gap-3"
              style={{ width: CARD_WIDTH - 24 - 36 - 12 }}
              initial={false}
              animate={fade(!collapsed)}
            >
              {/* Who the account is: on a switch the old one fades as the new one rises */}
              <div className="grid min-w-0 flex-1">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={account.address}
                    className="col-start-1 row-start-1 min-w-0"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: SPRING }}
                    exit={{ opacity: 0, transition: FADE_OUT }}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[15px] font-semibold">{name}</span>
                      {account.watchOnly && (
                        <span className={collapsed ? "" : "pointer-events-auto"}>
                          <WatchOnlyBadge />
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 items-center gap-0.5">
                      <ShortAddress address={account.address} />
                      <span className={collapsed ? "" : "pointer-events-auto"}>
                        <CopyButton value={account.address} className="-my-1 size-6" />
                      </span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </motion.div>
          </div>
        </motion.div>
        {/* What it holds, under a hairline, folding away into the tile; an offline signer has no chain to read it from */}
        {!offline && (
          <motion.div
            className="pointer-events-none relative overflow-hidden"
            initial={false}
            animate={{ height: collapsed ? 0 : "auto", opacity: collapsed ? 0 : 1 }}
            transition={{ ...SPRING, opacity: fade(!collapsed).transition }}
          >
            <div
              className="mx-3 flex items-center justify-between gap-3 border-t border-border py-2.5 text-sm whitespace-nowrap"
              style={{ width: CARD_WIDTH - 24 }}
            >
              <span className="text-muted-foreground">{t("wallet.balance")}</span>
              {/* Another account's balance slides in quickly in place of the last, rather
                  than counting over from it; the same account's still glides to a new amount */}
              <span className="relative truncate tabular-nums">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={account.address}
                    className="inline-block"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: FADE_IN }}
                    exit={{ opacity: 0, y: -6, transition: FADE_OUT }}
                  >
                    <Balance wei={balances[account.address]} counted />
                  </motion.span>
                </AnimatePresence>
              </span>
            </div>
          </motion.div>
        )}
      </motion.div>
      <AnimatePresence>
        {open && (
          <motion.div
            key="list"
            role="listbox"
            aria-label={t("nav.accounts")}
            className={`menu absolute z-50 flex flex-col gap-px p-1.5 ${
              // From the card, under it and reaching past the sidebar for names and
              // balances; from the rail's avatar, beside it
              collapsed ? "top-0 left-full ml-2 origin-top-left" : "top-full left-0 mt-1.5 origin-top-left"
            }`}
            style={{ width: LIST_WIDTH }}
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: SPRING }}
            exit={{ opacity: 0, scale: 0.98, transition: FADE_OUT }}
          >
            {searchable && (
              <div className="px-1 pt-0.5 pb-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="input h-8 pl-8"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("nav.searchAccounts")}
                    aria-label={t("nav.searchAccounts")}
                    spellCheck={false}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              </div>
            )}
            {/* As tall as the window leaves room for under the card, scrolling past that */}
            <motion.div
              className="flex max-h-[calc(100dvh-22rem)] min-h-0 flex-col gap-px overflow-y-auto overscroll-contain"
              {...stagger}
            >
              {shown.length === 0 && (
                <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">{t("nav.noAccountsFound")}</p>
              )}
              {shown.map((g) => (
                <Fragment key={g.kind === "phrase" ? g.seed.id : g.kind}>
                  {/* What keeps the accounts under it, a hairline above it parting it
                      from the group before, on the list's own glass */}
                  <motion.div
                    variants={ROW_IN}
                    className="mt-1.5 truncate border-t border-border px-2.5 pt-3 pb-1.5 font-semibold text-foreground first:mt-0 first:border-t-0 first:pt-1.5"
                  >
                    {g.kind === "phrase"
                      ? g.seed.name
                      : g.kind === "keys"
                        ? t("wallet.accounts.keys")
                        : t("offline.watchOnly")}
                  </motion.div>
                  {g.accounts.map((a) => {
                    const here = a.address === account.address;
                    return (
                      <motion.button
                        key={a.address}
                        type="button"
                        role="option"
                        aria-selected={here}
                        variants={ROW_IN}
                        onClick={() => choose(a.address)}
                        className="menu-item relative gap-2.5 py-1.5"
                      >
                        {/* The chosen account is lit as the sidebar's page is, and the light glides to a new choice */}
                        {here && (
                          <motion.span
                            layoutId="switcher-selection"
                            transition={GLIDE}
                            className="absolute inset-0 rounded-lg bg-selected shadow-[0_1px_0_rgb(255_255_255/3%)_inset]"
                          />
                        )}
                        <span className="relative flex">
                          <AddressAvatar address={a.address} size={24} />
                        </span>
                        <span className="relative flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className={`min-w-0 flex-1 truncate ${here ? "font-medium" : ""}`}>
                              {accountLabel(a, accounts, t)}
                            </span>
                            {!offline && (
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                <Balance wei={balances[a.address]} />
                              </span>
                            )}
                          </span>
                          <ShortAddress address={a.address} />
                        </span>
                      </motion.button>
                    );
                  })}
                </Fragment>
              ))}
            </motion.div>
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
    <span className="truncate rounded-full bg-brand/15 px-2 py-0.5 font-mono text-xs font-medium text-brand">
      {profile}
    </span>
  );
}

/** GroupSeparator parts one group of the sidebar's items from the next. */
function GroupSeparator() {
  return <div role="separator" className="mx-2.5 my-2.5 border-t border-border" />;
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
  // In the rail the name fades, and shows as the icon's tooltip instead
  const { collapsed } = useSidebar();
  const name = (
    <motion.span className="relative flex-1 truncate" initial={false} animate={fade(!collapsed)}>
      {label}
    </motion.span>
  );
  if (disabled) {
    return (
      <Tooltip content={collapsed ? label : null}>
        <span
          aria-disabled="true"
          className="flex h-10 shrink-0 cursor-default items-center gap-3 rounded-lg px-2.5 text-[15px] text-foreground/35"
        >
          <Icon className="size-[18px] shrink-0 text-muted-foreground/50" strokeWidth={1.75} />
          {name}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={collapsed ? label : null}>
      <NavLink
        aria-label={collapsed ? label : undefined}
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
              className={`relative size-[18px] shrink-0 transition-[color,transform] duration-200 group-active:scale-90 ${
                isActive ? "text-brand" : "text-muted-foreground"
              }`}
              strokeWidth={1.75}
            />
            {name}
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}
