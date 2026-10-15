import { formatLax } from "../../lib/format";
import { useT } from "../../i18n";
import { Counter } from "./Counter";
import { Pill } from "./Pill";
import { Tooltip } from "./Tooltip";

/**
 * The parts an account is shown by in the account pickers (the sidebar's
 * switcher, the Send and Sign pages' account select), so they stay alike.
 */

/**
 * GroupedAddress shows an address as a card number is printed: 0x, then
 * its digits in groups of four. The gaps are margins, not spaces, so the
 * address selects and copies whole.
 */
export function GroupedAddress({ address }: { address: string }) {
  const digits = address.replace(/^0x/i, "");
  const groups = digits.match(/.{1,4}/g) ?? [digits];
  return (
    <span className="selectable font-mono tracking-wide">
      <span className="mr-1.5">0x</span>
      {groups.map((g, i) => (
        <span key={i} className={i < groups.length - 1 ? "mr-1.5" : ""}>
          {g}
        </span>
      ))}
    </span>
  );
}

/** ShortAddress is an address's first and last four digits, the gap between them a dimmed midline ellipsis. */
export function ShortAddress({ address }: { address: string }) {
  return (
    <span className="truncate font-mono text-xs text-muted-foreground">
      {address.slice(0, 6)}
      <span className="mx-0.5 text-muted-foreground/50">⋯</span>
      {address.slice(-4)}
    </span>
  );
}

/** WatchOnlyBadge marks an account whose key is on an offline signer. */
export function WatchOnlyBadge() {
  const t = useT();
  return (
    <Tooltip content={t("offline.watchOnly.desc")}>
      <Pill className="shrink-0">{t("offline.watchOnly")}</Pill>
    </Tooltip>
  );
}

/** Balance is an amount of LAX, or a dash until it is known. Counted, it glides to each new amount. */
export function Balance({ wei, counted }: { wei?: string; counted?: boolean }) {
  if (wei === undefined) return <span className="text-muted-foreground">—</span>;
  const amount = formatLax(wei, 4);
  return (
    <>
      {counted ? <Counter value={Number(amount)} format={formatAmount} /> : amount}{" "}
      <span className="text-muted-foreground">LAX</span>
    </>
  );
}

/** Up to four decimals, without trailing zeros, as formatLax shows a balance. */
function formatAmount(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false });
}
