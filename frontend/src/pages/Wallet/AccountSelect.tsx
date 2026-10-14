import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { api } from "../../lib/api";
import { formatLax, shortHex } from "../../lib/format";
import { useNode } from "../../lib/live";
import { FADE_OUT, GLIDE } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { AddressAvatar } from "../../components/ui/AddressAvatar";

/**
 * AccountSelect picks the account to send from: the wallet's accounts with
 * their balances, read from the node as the list opens. Picking one makes
 * it the wallet's selected account, so the rest of the app follows. With a
 * single account it shows just that one.
 */
export function AccountSelect({ id, balanceWei }: { id?: string; balanceWei?: string }) {
  const t = useT();
  const listId = useId();
  const node = useNode();
  const { info, account, select } = useWallet();
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const box = useRef<HTMLDivElement>(null);
  const running = !!node?.running;

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

  // Each account's balance, read as the list opens
  useEffect(() => {
    if (!open || !running || !info) return;
    let alive = true;
    for (const a of info.accounts) {
      api
        .walletSummary(a.address)
        .then((v) => alive && v.balanceWei && setBalances((b) => ({ ...b, [a.address]: v.balanceWei })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [open, running, info]);

  if (!info || !account) return null;
  const accounts = info.accounts;
  const several = accounts.length > 1;
  const balanceOf = (address: string) =>
    address === account.address && balanceWei ? balanceWei : balances[address];

  return (
    <div ref={box} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => several && setOpen((o) => !o)}
        aria-haspopup={several ? "listbox" : undefined}
        aria-expanded={several ? open : undefined}
        aria-controls={several ? listId : undefined}
        className={`flex w-full items-center gap-3 rounded-md border border-border-strong bg-field px-3 py-2 text-left transition-colors ${
          several ? "hover:border-brand-mark/60" : "cursor-default"
        } ${open ? "border-brand-mark shadow-[0_0_0_3px_var(--ring)]" : ""}`}
      >
        <Row label={accountLabel(account, accounts, t)} address={account.address} balance={balanceOf(account.address)} />
        {several && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            id={listId}
            role="listbox"
            aria-label={t("wallet.send.from")}
            className="absolute inset-x-0 top-full z-50 mt-1 flex max-h-72 flex-col gap-px overflow-y-auto rounded-lg border border-border-strong bg-background p-1 shadow-[0_8px_24px_rgb(0_0_0/22%)]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            transition={GLIDE}
          >
            {accounts.map((a) => {
              const here = a.address === account.address;
              return (
                <li key={a.address}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={here}
                    onClick={() => {
                      setOpen(false);
                      if (!here) select(a.address);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-hover ${here ? "bg-selected" : ""}`}
                  >
                    <Row label={accountLabel(a, accounts, t)} address={a.address} balance={balanceOf(a.address)} />
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      {here && <Check className="size-3.5 text-brand" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Row is an account in the picker: its name and address, and its balance on the right. */
function Row({ label, address, balance }: { label: string; address: string; balance?: string }) {
  return (
    <>
      <AddressAvatar address={address} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{shortHex(address, 10, 8)}</span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {balance !== undefined ? (
          <>
            {formatLax(balance, 6)} <span className="text-muted-foreground">LAX</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
    </>
  );
}
