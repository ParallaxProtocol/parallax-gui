import type { ReactNode } from "react";
import { motion } from "motion/react";
import { SPRING } from "../../lib/motion";
import { sameAddress, shortHex } from "../../lib/format";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useContacts } from "../../lib/contacts";
import { useT } from "../../i18n";
import { CopyButton } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";

/**
 * The pieces the app's lists share (the peers, the mempool, an account's
 * activity): a row unfolding its details, where they sit under the row,
 * and the values in their grouped boxes (Facts, in Panel).
 */

/** Unfold reveals its content by growing to its height. */
export function Unfold({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={SPRING}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  );
}

/**
 * Details is an opened row's details: its boxes stacked under the row,
 * indented to the row's main column (its padding, chevron, badge and
 * their gaps), the row's highlight running on behind them.
 */
export function Details({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 bg-hover pr-5 pb-4 pl-[90px]">{children}</div>;
}

/** Hex is a hash or data, shortened: whole in its tooltip (unless too long to read there), and to copy. */
export function Hex({ value }: { value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Tooltip content={value.length <= 258 ? value : null} mono>
        <span className="selectable truncate font-mono">{shortHex(value, 10, 8)}</span>
      </Tooltip>
      <CopyButton value={value} className="-my-1 -mr-2" />
    </span>
  );
}

/** Mono is a value read as code (an address, a client string): whole, cut short only where it can't fit, then whole in its tooltip; to copy if asked. */
export function Mono({ value, copy }: { value: string; copy?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Tooltip content={value} mono overflowOnly>
        <span className="selectable truncate font-mono">{value}</span>
      </Tooltip>
      {copy && <CopyButton value={value} className="-my-1 -mr-2" />}
    </span>
  );
}

/** Party is an address of a transaction: its name when the wallet knows one, the address shortened, to copy. */
export function Party({ address }: { address: string }) {
  const t = useT();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const own = info?.accounts.find((x) => sameAddress(x.address, address));
  const name = own && info ? accountLabel(own, info.accounts, t) : byAddress(address)?.name;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {name && <span className="truncate text-foreground/80">{name}</span>}
      <span className="flex shrink-0 items-center gap-1">
        <Tooltip content={address} mono>
          <span className="selectable font-mono">{shortHex(address, 6, 4)}</span>
        </Tooltip>
        <CopyButton value={address} className="-my-1 -mr-2" />
      </span>
    </span>
  );
}
