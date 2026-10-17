import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { animate, AnimatePresence, motion, useMotionValue, usePresence } from "motion/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookUser,
  Eye,
  FileCheck,
  FileSignature,
  History,
  PenLine,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { useOfflineMode } from "../../lib/offline";
import { MAC, SIDEBAR_RAIL, SIDEBAR_RAIL_MAC, SIDEBAR_WIDTH, TRAFFIC_LIGHTS_ROW, useSidebar } from "../../lib/sidebar";
import { api } from "../../lib/api";
import { FADE_IN, FADE_OUT, GLIDE, ROW_IN, SPRING, useStagger } from "../../lib/motion";
import { accountLabel, groupAccounts, groupKey, useBalances, useWallet, type AccountGroup } from "../../lib/wallet";
import { DEVICE_NAME } from "../hardware/Device";
import { LogoMark } from "../ui/LogoMark";
import { useT } from "../../i18n";
import { NODE_BAR_ROOM } from "./NodeBar";
import { TOP_BAR_HEIGHT } from "./TopBar";
import { TorBarSpacer } from "./TorBar";
import { useSettingsSheet } from "../../lib/settingsSheet";
import { SettingsButton } from "./SettingsSheet";
import { AddressAvatar } from "../ui/AddressAvatar";
import { AccountBadge, Balance, GroupedAddress } from "../ui/AccountParts";
import { CopyButton } from "../ui/bits";
import { Tooltip } from "../ui/Tooltip";
import { Segmented } from "../ui/Segmented";

const RAIL = MAC ? SIDEBAR_RAIL_MAC : SIDEBAR_RAIL;
/** An item's width in the rail: its icon and the padding around it. */
const RAIL_ITEM = 40;
/** The account card's width open: the sidebar's, less the items' padding. */
const CARD_WIDTH = SIDEBAR_WIDTH - 24;
/** The switcher's list: wider than the card, for names and balances side by side. */
const LIST_WIDTH = 320;
/**
 * The card's growing into the list, on the node bar's spring. It settles
 * all the way: by default a spring stops within half a pixel, and the sheet
 * folding back would give way to the card that far off it.
 */
const SHEET_SPRING = { type: "spring", bounce: 0, visualDuration: 0.35, restDelta: 0.01, restSpeed: 0.1 } as const;
/** The switcher's tabs: the kinds of account, as Settings groups them. */
type Tab = "phrase" | "keys" | "hardware" | "watch";
const TABS: Tab[] = ["phrase", "keys", "hardware", "watch"];
const TAB_LABEL: Record<Tab, string> = {
  phrase: "nav.tab.phrases",
  keys: "wallet.accounts.keys",
  hardware: "hardware.tab",
  watch: "offline.watchOnly",
};
const tabOf = (g: AccountGroup): Tab => (g.kind === "phrase" ? "phrase" : g.kind);
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
// The logo and name over the sidebar, in the website's proportions: the
// mark half the title bar's height, the name set tight beside it
const LOGO = 26;

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
          On macOS, under the traffic lights' row. In the rail, the logo alone */}
      <motion.div
        className="drag flex shrink-0 items-center gap-2.5 overflow-hidden border-b border-border pr-4 whitespace-nowrap"
        initial={false}
        style={{ height: TOP_BAR_HEIGHT, paddingTop: TRAFFIC_LIGHTS_ROW }}
        animate={{ paddingLeft: collapsed ? (RAIL - LOGO) / 2 : 16 }}
        transition={SPRING}
      >
        <LogoMark size={LOGO} />
        <motion.span className="flex min-w-0 items-center gap-2.5" initial={false} animate={fade(!collapsed)}>
          <span className="truncate text-[19px] leading-none font-medium tracking-[-0.04em]">Parallax Wallet</span>
          <ProfileBadge />
        </motion.span>
      </motion.div>
      {/* The Tor bar's room, while Tor is on: it runs across under the title bar */}
      <TorBarSpacer />

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
              <NavItem
                to="/send"
                icon={ArrowUpRight}
                label={t("nav.send")}
                disabled={noAccount}
                // From a watch-only account, a send is signed on the offline signer
                trailing={
                  account?.watchOnly && (
                    <Tooltip content={t("offline.watchOnly.desc")}>
                      <Eye className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
                    </Tooltip>
                  )
                }
              />
              <NavItem to="/receive" icon={ArrowDownLeft} label={t("nav.receive")} disabled={noAccount} />
              <NavItem to="/history" icon={History} label={t("nav.history")} disabled={noAccount} />
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
  const [tab, setTab] = useState<Tab | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  // From opening until the sheet has folded all the way back, the card under
  // it is hidden, so the sheet's glass isn't laid over the card's own
  const [sheetShown, setSheetShown] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Left for Settings, the sheet folds back under its panel, not over it
  const [toSettings, setToSettings] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const stagger = useStagger();
  const { collapsed } = useSidebar();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const more = useMoreBelow(scroller);

  // Another page closes it, however it was reached
  useEffect(() => setOpen(false), [pathname]);
  // Each opening starts from the whole list
  useEffect(() => {
    if (!open) setTab(null);
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
  // Grouped as Settings shows them, the empty groups left out
  // The kinds there are accounts of, for the tabs; the list opens on the
  // current account's
  const groups = groupAccounts(info);
  const kinds = TABS.filter((k) => groups.some((g) => tabOf(g) === k && g.accounts.length > 0));
  const current: Tab = account.watchOnly
    ? "watch"
    : account.hardware
      ? "hardware"
      : account.fromSeed && groups.some((g) => g.kind === "phrase" && g.seed.id === account.seedId)
        ? "phrase"
        : "keys";
  const kind: Tab = tab && kinds.includes(tab) ? tab : current;
  const shown = groups.filter((g) => kinds.length < 2 || tabOf(g) === kind).filter((g) => g.accounts.length > 0);

  const name = accountLabel(account, accounts, t);

  // The tabs, the accounts by group, and the way to manage them: the
  // list, in the card grown into it or beside the rail
  const list = (
    <>
      {kinds.length > 1 && (
        // A regular-size control, as tall and as large as the text about it
        <div className="px-1 pt-1.5 pb-2">
          <Segmented<Tab>
            fill
            options={kinds.map((k) => ({ value: k, label: t(TAB_LABEL[k]) }))}
            value={kind}
            onChange={setTab}
          />
        </div>
      )}
      {/* As tall as the window leaves room for under the card, scrolling past
          that: its rows keep their height (a column would squeeze them first;
          the accounts' are menu items, which don't shrink) */}
      <div className="relative flex min-h-0 flex-col">
        <motion.div
          key={kind}
          ref={setScroller}
          // Positioned, so its rows' offsetTop is measured from it
          className="relative flex max-h-[calc(100dvh-22rem)] min-h-0 flex-col gap-px overflow-y-auto overscroll-contain"
          {...stagger}
        >
          {shown.map((g) => (
            <Fragment key={groupKey(g)}>
              {/* What keeps the accounts under it, a hairline above it parting it
                from the group before, on the list's own glass */}
              {/* A tab of single keys or watch-only accounts is named by its tab;
                  a phrase or a hardware wallet by its own name */}
              {(g.kind === "phrase" || g.kind === "hardware" || kinds.length < 2) && (
                <motion.div
                  variants={ROW_IN}
                  className="mt-1.5 shrink-0 truncate border-t border-border px-2.5 pt-3 pb-1.5 font-semibold text-foreground/75 first:mt-0 first:border-t-0 first:pt-1.5"
                >
                  {g.kind === "phrase"
                    ? g.seed.name
                    : g.kind === "keys"
                      ? t("wallet.accounts.keys")
                      : g.kind === "hardware"
                        ? (g.wallet?.name ?? DEVICE_NAME[g.device])
                        : t("offline.watchOnly")}
                </motion.div>
              )}
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
                        <span className={`min-w-0 flex-1 truncate text-[15px] ${here ? "font-medium" : ""}`}>
                          {accountLabel(a, accounts, t)}
                        </span>
                        {!offline && (
                          <span className="shrink-0 text-muted-foreground tabular-nums">
                            <Balance wei={balances[a.address]} />
                          </span>
                        )}
                      </span>
                      <CardAddress address={a.address} />
                    </span>
                  </motion.button>
                );
              })}
            </Fragment>
          ))}
        </motion.div>
        {/* With accounts still below, the list's foot frosts over, thinning
            upward to nothing, as the page does under its toolbar; edge to
            edge, out past the list's padding (6px, in the sheet and the menu) */}
        <div
          aria-hidden
          className={`pointer-events-none absolute -inset-x-1.5 bottom-0 h-8 bg-popover/80 [mask-image:linear-gradient(to_top,black_25%,transparent)] backdrop-blur-md transition-opacity duration-300 ${
            more ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      {/* The command after the accounts, parted from them as a menu parts its groups */}
      <div className="mx-2.5 my-1 border-t border-border" />
      <button
        type="button"
        onClick={() => {
          setToSettings(true);
          setOpen(false);
          openAt("accounts");
        }}
        // A menu command, as macOS draws one: body text, a small symbol in
        // the avatars' column so its name lines up with the accounts'
        className="menu-item h-8 gap-2.5"
      >
        <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">
          <Settings2 className="size-4" strokeWidth={1.75} />
        </span>
        {t("nav.manageAccounts")}
      </button>
    </>
  );

  return (
    <div ref={box} className="relative mb-2">
      {/* One card that morphs between its two shapes on the sidebar's own
          spring: full, as wide as the sidebar's items, and in the rail a
          tile around the avatar. Its size, corners and padding move, the
          avatar shrinks in place, and what doesn't fit the tile fades as
          it's clipped, laid out at its full width so it never reflows. A
          button covering the card opens the list; the copy button sits
          above it. Pointed at, the card grows a little; pressed, it sinks */}
      <motion.div
        ref={card}
        className="glass relative overflow-hidden transition-[border-color,background-color] duration-200 hover:border-border-strong"
        // Collapsing the sidebar with the list open folds the card into the rail at once, under the sheet
        style={{ visibility: sheetShown && !collapsed ? "hidden" : undefined }}
        initial={false}
        animate={{
          // Its height follows what's in it: the avatar's row, and the balance's as it folds
          width: collapsed ? RAIL_ITEM : CARD_WIDTH,
          borderRadius: collapsed ? 12 : 14,
          scale: hovered && !open ? 1.025 : 1,
        }}
        // Pointed at, it rises a little to be pressed, and sinks as it is.
        // The hover is kept here rather than in whileHover: under the sheet
        // the card never hears the pointer leave, and would come back risen
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        whileTap={open ? undefined : { scale: 0.98 }}
        transition={SPRING}
      >
        <Tooltip content={collapsed ? name : null}>
          <button
            type="button"
            onClick={() => {
              // The list grows out of the card from the card's own height
              setCardHeight(card.current?.offsetHeight ?? 0);
              if (!collapsed) {
                setSheetShown(true);
                setHovered(false);
              }
              setOpen((o) => !o);
            }}
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
              className="absolute inset-0 flex items-center gap-3"
              // The room the card leaves it, never less than open: the border
              // is drawn to whole device pixels, so the room isn't known here
              style={{ minWidth: CARD_WIDTH - 2 - 24 - 36 - 12 }}
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
                      {(account.watchOnly || account.hardware) && (
                        <span className={collapsed ? "" : "pointer-events-auto"}>
                          <AccountBadge account={account} className="h-4 px-1.5 text-[10px]" />
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 items-center gap-0.5">
                      <CardAddress address={account.address} />
                      {/* Copying doesn't press the card: it sinks only for opening the list */}
                      <span
                        className={collapsed ? "" : "pointer-events-auto"}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <CopyButton value={account.address} className="-my-1 size-6" />
                      </span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
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
              className="mx-3 flex items-center justify-between gap-3 border-t border-border py-2.5 whitespace-nowrap"
              // As wide as the card leaves it, as the sheet's is, and never less
              // than open: the border is drawn to whole device pixels (0.6px at
              // some scales), so a width set here would miss the sheet's
              style={{ minWidth: CARD_WIDTH - 24 - 2 }}
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
      {/* Open from the card, the card itself grows into the list, as the
          node bar grows into the node's page: the account shown stays at
          its top, and the others arrive under it */}
      {/* Its layer is held outside the presence: a sheet on its way out is
          drawn as it last was, so its own class couldn't change as it goes */}
      <div className={`absolute top-0 left-0 ${toSettings ? "z-20" : "z-50"}`}>
        <AnimatePresence
          onExitComplete={() => {
            setSheetShown(false);
            setToSettings(false);
          }}
        >
          {open && !collapsed && (
            <motion.div
              key="sheet"
              className="absolute top-0 left-0"
              initial={{ width: CARD_WIDTH, height: cardHeight }}
              animate={{ width: LIST_WIDTH, height: "auto" }}
              exit={{ width: CARD_WIDTH, height: cardHeight }}
              transition={SHEET_SPRING}
            >
              <div className="glass relative h-full overflow-hidden">
                {/* The card's glass deepens into a menu's, readable over the page */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-popover"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.92 }}
                  exit={{ opacity: 0 }}
                  transition={SHEET_SPRING}
                />
                <div className="relative">
                  {/* The card's face, its header now: a press anywhere on it (the
                  balance too) folds the list back, as one on the card opens it;
                  the copy button sits above the press. Folding, the sheet still
                  covers the card, so a press then opens it again from where it is
                  (the sheet on its way out keeps this handler, so it toggles) */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpen((o) => !o)}
                      aria-expanded
                      aria-label={name}
                      className="absolute inset-0"
                    />
                    <div className="pointer-events-none relative flex items-center gap-3 p-3">
                      <AddressAvatar address={account.address} size={36} />
                      {/* As tall as the avatar and centred on it, overflowing it evenly, as
                      the card's is: let it set the row's height and the face would sit
                      lower than the card's, rising as the card takes its place */}
                      <span className="flex h-9 min-w-0 flex-1 flex-col justify-center">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[15px] font-semibold">{name}</span>
                          {(account.watchOnly || account.hardware) && (
                            <span className="pointer-events-auto">
                              <AccountBadge account={account} className="h-4 px-1.5 text-[10px]" />
                            </span>
                          )}
                        </span>
                        <span className="flex min-w-0 items-center gap-0.5">
                          <GrowingAddress address={account.address} />
                          <span className="pointer-events-auto">
                            <CopyButton value={account.address} className="-my-1 size-6 shrink-0" />
                          </span>
                        </span>
                      </span>
                    </div>
                    {!offline && (
                      <div className="pointer-events-none relative mx-3 flex items-center justify-between gap-3 border-t border-border py-2.5 whitespace-nowrap">
                        <span className="text-muted-foreground">{t("wallet.balance")}</span>
                        {/* Wrapped as the card's is, so it lays out to the same fraction of a
                            pixel and doesn't shift as the card takes its place */}
                        <span className="relative truncate tabular-nums">
                          <span className="inline-block">
                            <Balance wei={balances[account.address]} counted />
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                  <motion.div
                    role="listbox"
                    aria-label={t("nav.accounts")}
                    className="flex flex-col gap-px px-1.5 pb-1.5"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.12, duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  >
                    {list}
                  </motion.div>
                </div>
              </div>
              {/* Floating over the page as a popover does, not resting as the card:
                its shadow rises as it grows and settles as it folds back, outside
                the glass's clip */}
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[14px]"
                style={{ boxShadow: "var(--shadow-popover)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={SHEET_SPRING}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* From the rail's avatar, beside it: there is no card there to grow */}
      <AnimatePresence>
        {open && collapsed && (
          <motion.div
            key="list"
            role="listbox"
            aria-label={t("nav.accounts")}
            className="menu absolute top-0 left-full z-50 ml-2 flex origin-top-left flex-col gap-px p-1.5"
            style={{ width: LIST_WIDTH }}
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: SPRING }}
            exit={{ opacity: 0, scale: 0.98, transition: FADE_OUT }}
          >
            {list}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Whether a scroller has more below what it shows: as it scrolls, and as it or its rows resize. */
function useMoreBelow(el: HTMLElement | null) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!el) return setMore(false);
    // By the last row's place in the layout, not scrollHeight: rows sliding
    // in from below would count, and nothing would check again once they land
    const check = () => {
      const last = el.lastElementChild as HTMLElement | null;
      const end = last ? last.offsetTop + last.offsetHeight : 0;
      setMore(end - el.scrollTop - el.clientHeight > 1);
    };
    check();
    const ro = new ResizeObserver(check);
    const observe = () => {
      ro.observe(el);
      for (const row of el.children) ro.observe(row);
    };
    observe();
    // Rows that come or go while it's open (an account added) are watched too
    const mo = new MutationObserver(() => {
      observe();
      check();
    });
    mo.observe(el, { childList: true });
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [el]);
  return more;
}

/** CardAddress is an address short, as the switcher shows them: a group at each end, grouped as a card number is. */
function CardAddress({ address }: { address: string }) {
  return <GroupedAddress address={address} ends={1} className="truncate text-muted-foreground" />;
}

/**
 * GrowingAddress is the card's short address opening out as the card grows
 * into the list: a second group at each end, on the same line with the
 * ellipsis between, fading in over the short one and back into it as the
 * list closes. Its width moves between the two's on the card's spring, so
 * what follows it (the copy button) glides with it rather than jumping
 * once the card is back.
 */
function GrowingAddress({ address }: { address: string }) {
  const [present, safeToRemove] = usePresence();
  const short = useRef<HTMLSpanElement>(null);
  const long = useRef<HTMLSpanElement>(null);
  const width = useMotionValue(0);
  useLayoutEffect(() => {
    // To the fraction of a pixel (offsetWidth rounds): the short one is the
    // card's own, which the copy button has to land beside exactly
    const from = short.current?.getBoundingClientRect().width ?? 0;
    const to = long.current?.getBoundingClientRect().width ?? 0;
    if (present) {
      // From the short one when it opens; reopened while folding, from where it is
      if (width.get() === 0) width.set(from);
      const growing = animate(width, to, SHEET_SPRING);
      return () => growing.stop();
    }
    let reopened = false;
    const folding = animate(width, from, SHEET_SPRING);
    folding.then(() => !reopened && safeToRemove?.());
    return () => {
      reopened = true;
      folding.stop();
    };
  }, [present, width, safeToRemove]);
  return (
    <motion.span
      style={{ width }}
      // A flex box, as the card's row is, not a block: a block's line, in the
      // body's font, would sit the mono address lower and stand a little
      // taller than the card's, so the sheet's face would rise as it gives way
      className="relative flex min-w-0 overflow-hidden whitespace-nowrap text-muted-foreground"
    >
      <motion.span
        ref={short}
        aria-hidden
        className="absolute top-0 left-0 flex"
        initial={{ opacity: 1 }}
        animate={{ opacity: present ? 0 : 1, transition: present ? FADE_OUT : FADE_IN }}
      >
        <CardAddress address={address} />
      </motion.span>
      <motion.span
        ref={long}
        className="inline-flex"
        initial={{ opacity: 0 }}
        animate={{ opacity: present ? 1 : 0, transition: present ? { ...FADE_IN, delay: 0.08 } : FADE_OUT }}
      >
        <GroupedAddress address={address} ends={2} />
      </motion.span>
    </motion.span>
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
  trailing,
}: {
  to: string;
  icon: typeof Wallet;
  label: string;
  /** Shown but not reachable, until what it needs exists. */
  disabled?: boolean;
  /** A mark at the row's end, fading with its name in the rail. */
  trailing?: ReactNode;
}) {
  // In the rail the name fades, and shows as the icon's tooltip instead
  const { collapsed } = useSidebar();
  const name = (
    <motion.span className="relative flex-1 truncate" initial={false} animate={fade(!collapsed)}>
      {label}
    </motion.span>
  );
  const mark = trailing && (
    <motion.span className="relative flex shrink-0" initial={false} animate={fade(!collapsed)}>
      {trailing}
    </motion.span>
  );
  if (disabled) {
    return (
      <Tooltip content={collapsed ? label : null}>
        <span
          aria-disabled="true"
          className="flex h-8 shrink-0 cursor-default items-center gap-2.5 rounded-lg px-3 text-base text-foreground/35"
        >
          <Icon className="size-4 shrink-0 text-brand opacity-35" strokeWidth={1.75} />
          {name}
          {mark}
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
          // As a macOS sidebar's rows: the selection alone drawn (no hover),
          // every symbol in the accent colour, the chosen one's name brighter and
          // bolder, as in Settings' own list
          `group relative flex h-8 items-center gap-2.5 rounded-lg px-3 text-base transition-colors duration-200 ${
            isActive ? "font-medium text-foreground" : "text-foreground/80"
          }`
        }
      >
        {({ isActive }) => (
          <>
            {/* The selection glides from item to item */}
            {isActive && (
              <motion.span
                // Measured on every render, not only as this item is chosen: what
                // moves the items after (the account card settling) mustn't leave
                // it gliding from where they were
                layoutId="sidebar-selection"
                transition={GLIDE}
                className="absolute inset-0 rounded-lg bg-selected shadow-[0_1px_0_rgb(255_255_255/3%)_inset]"
              />
            )}
            <Icon
              className="relative size-4 shrink-0 text-brand transition-transform duration-200 group-active:scale-90"
              strokeWidth={1.75}
            />
            {name}
            {mark}
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}
