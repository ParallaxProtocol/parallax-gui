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
 * its digits in groups of four, every other group a shade lighter, so it
 * can be checked group by group against what the other party gave. The
 * shades are opacities, so it reads the same in muted text as in plain;
 * the gaps are blank boxes, not spaces, so it selects and copies whole.
 * `wrap` lets it break between groups where a line runs out. `ends` keeps
 * that many groups at each end, a dimmed ellipsis between, for a line too
 * short for all of it (its shades still those of the whole).
 */
export function GroupedAddress({
  address,
  wrap = false,
  ends,
  className = "",
}: {
  address: string;
  wrap?: boolean;
  ends?: number;
  className?: string;
}) {
  const digits = address.replace(/^0x/i, "");
  const groups = digits.match(/.{1,4}/g) ?? [digits];
  const cut = ends !== undefined && groups.length > ends * 2;
  const group = (i: number) => (
    <span key={i} className={i % 2 ? "opacity-75" : ""}>
      {groups[i]}
    </span>
  );
  const gap = <span className="inline-block w-[0.3em]" />;
  const run = (from: number, to: number) =>
    groups.slice(from, to).map((_, k) => (
      <span key={from + k}>
        {group(from + k)}
        {from + k < to - 1 && gap}
      </span>
    ));
  return (
    <span className={`selectable font-mono ${wrap ? "break-all" : "whitespace-nowrap"} ${className}`}>
      <span className="opacity-55">0x</span>
      {gap}
      {cut ? (
        <>
          {run(0, ends)}
          <span className="mx-1 opacity-50">⋯</span>
          {run(groups.length - ends, groups.length)}
        </>
      ) : (
        run(0, groups.length)
      )}
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
