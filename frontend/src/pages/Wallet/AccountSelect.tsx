import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronsUpDown } from "lucide-react";
import type { WalletAccount } from "../../lib/api";
import { GLIDE, POPUP, POPUP_ROW, POPUP_ROWS, useStagger } from "../../lib/motion";
import { accountLabel, useBalances, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { AccountBadge, Balance, GroupedAddress, ShortAddress } from "../../components/ui/AccountParts";
import { usePopup } from "../../components/ui/popup";

/**
 * AccountSelect picks the account to send or sign from, as a field: the
 * account in a field's glass well, opening the wallet's accounts as the
 * sidebar's switcher lists them, on the same frosted menu, the chosen one
 * lit, the light gliding to a new choice. Picking one makes it the
 * wallet's selected account, so the rest of the app follows. With a
 * single account it shows just that one. The keyboard works as a
 * listbox's: the arrows move, Enter or Space picks, Escape closes.
 */
export function AccountSelect({
  id,
  balanceWei,
  noBalance,
}: {
  id?: string;
  /** The selected account's balance, where the page already reads it fresher than the list does. */
  balanceWei?: string;
  /** Leave balances out: where there is no chain to read them from (an offline signer). */
  noBalance?: boolean;
}) {
  const t = useT();
  const listId = useId();
  const { info, account, select } = useWallet();
  const balances = useBalances();
  const stagger = useStagger();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const pos = usePopup(open, setOpen, button, menu);

  if (!info || !account) return null;
  const accounts = info.accounts;
  const several = accounts.length > 1;
  const balanceOf = (address: string) => (address === account.address && balanceWei ? balanceWei : balances[address]);

  const show = () => {
    if (!several) return;
    setActive(
      Math.max(
        0,
        accounts.findIndex((a) => a.address === account.address),
      ),
    );
    setOpen(true);
  };
  const pick = (i: number) => {
    const a = accounts[i];
    setOpen(false);
    button.current?.focus();
    if (a && a.address !== account.address) select(a.address);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      // Only the menu closes, not what it sits in
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(accounts.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        aria-haspopup={several ? "listbox" : undefined}
        aria-expanded={several ? open : undefined}
        aria-controls={several && open ? listId : undefined}
        // A field's well, as tall as the Send page's To field (h-11); lit as a focused field while open
        className={`input flex h-11 items-center gap-3 text-left ${several ? "" : "cursor-default"} ${
          open ? "border-brand-mark shadow-[var(--glass-shine),0_0_0_3px_var(--ring)]" : ""
        }`}
      >
        <Row
          account={account}
          label={accountLabel(account, accounts, t)}
          balance={noBalance ? null : balanceOf(account.address)}
          size={28}
          address={false}
        />
        {several && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menu}
              id={listId}
              role="listbox"
              aria-label={t("wallet.send.from")}
              aria-activedescendant={`${listId}-${active}`}
              className={`menu no-drag fixed z-[150] flex flex-col p-1.5 ${pos?.up ? "origin-bottom" : "origin-top"}`}
              // Placed by left/top: motion owns the transform, for the scale
              style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, width: pos?.width, visibility: pos ? "visible" : "hidden" }}
              {...POPUP}
            >
              <motion.div className="flex max-h-80 flex-col gap-px overflow-y-auto" {...stagger} variants={POPUP_ROWS}>
                {accounts.map((a, i) => {
                  const here = a.address === account.address;
                  return (
                    <motion.button
                      key={a.address}
                      id={`${listId}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={here}
                      tabIndex={-1}
                      variants={POPUP_ROW}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(i)}
                      data-active={(i === active && !here) || undefined}
                      className="menu-item relative gap-2.5 py-2"
                    >
                      {/* The chosen account is lit as the sidebar's is, and the light glides to a new choice */}
                      {here && (
                        <motion.span
                          layoutId={`${listId}-selection`}
                          transition={GLIDE}
                          className="absolute inset-0 rounded-lg bg-selected shadow-[0_1px_0_rgb(255_255_255/3%)_inset]"
                        />
                      )}
                      <Row
                        account={a}
                        label={accountLabel(a, accounts, t)}
                        balance={noBalance ? null : balanceOf(a.address)}
                        size={28}
                        here={here}
                      />
                    </motion.button>
                  );
                })}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/** Row is an account as the pickers show it: its avatar, name and short address, and its balance on the right. */
function Row({
  account,
  label,
  balance,
  size,
  here,
  address = true,
}: {
  account: WalletAccount;
  label: string;
  /** Null where balances are left out. */
  balance: string | undefined | null;
  size: number;
  here?: boolean;
  /** Whether it shows its address: the list does, the field names just the account. */
  address?: boolean;
}) {
  return (
    <>
      <span className="relative">
        <AddressAvatar address={account.address} size={size} />
      </span>
      {/* The whole address where the row has room for it, shortened where it hasn't */}
      <span className="@container relative flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`truncate ${here === false ? "" : "font-medium"}`}>{label}</span>
          <AccountBadge account={account} />
        </span>
        {address && (
          <>
            <span className="hidden truncate text-xs text-muted-foreground @sm:block">
              <GroupedAddress address={account.address} />
            </span>
            <span className="flex @sm:hidden">
              <ShortAddress address={account.address} />
            </span>
          </>
        )}
      </span>
      {balance !== null && (
        <span className="relative shrink-0 text-sm tabular-nums">
          <Balance wei={balance} />
        </span>
      )}
    </>
  );
}
