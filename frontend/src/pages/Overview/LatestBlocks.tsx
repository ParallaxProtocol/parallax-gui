import { useRef } from "react";
import { BlockView } from "../../lib/api";
import { formatInt, formatLax, formatPercent, sameAddress, shortHex } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { useAgo, useT } from "../../i18n";
import { Plate } from "../../components/ui/Plate";

const HEAD = "px-3 pb-2.5 text-left font-mono text-[10px] font-normal tracking-wider text-muted-foreground uppercase first:pl-0 last:pr-0";
const CELL = "px-3 py-2.5 whitespace-nowrap tabular-nums first:pl-0 last:pr-0";

/**
 * LatestBlocks lists the newest blocks: when each was found and by whom,
 * what it carried and how full it was. A block that arrives while the
 * table is shown slides in at the top with a brief wash; blocks the
 * user's own mining address found are marked.
 */
export default function LatestBlocks({ blocks, mine }: { blocks: BlockView[]; mine?: string }) {
  const t = useT();
  const ago = useAgo();
  const now = useNow(5000);
  // Rows newer than `from` count as arrivals and wash in. It trails the
  // head by one update, and skips a jump of many blocks at once (first
  // render, or catching up during sync), when nothing new really "arrived"
  const seen = useRef<{ head: number; from: number } | null>(null);
  const top = blocks[0]?.number;
  if (top !== undefined) {
    if (seen.current === null) seen.current = { head: top, from: top };
    else if (top !== seen.current.head)
      seen.current = { head: top, from: top - seen.current.head > 3 ? top : seen.current.head };
  }
  const from = seen.current?.from ?? Infinity;

  return (
    <Plate className="px-5 pt-4 pb-2">
      {blocks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("blocks.waiting")}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className={HEAD}>{t("blocks.block")}</th>
              <th className={HEAD}>{t("blocks.found")}</th>
              <th className={HEAD}>{t("blocks.miner")}</th>
              <th className={`${HEAD} text-right`}>{t("blocks.txs")}</th>
              <th className={`${HEAD} w-36`}>{t("blocks.full")}</th>
              <th className={`${HEAD} text-right`}>{t("blocks.reward")}</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => {
                const fresh = b.number > from;
                const ours = sameAddress(b.coinbase, mine);
                const full = b.gasLimit > 0 ? b.gasUsed / b.gasLimit : 0;
                return (
                  // No layout animation: measuring every row on each re-render
                  // forced a synchronous reflow; a new block's row washes in instead
                  <tr
                    key={b.number}
                    className={`border-b border-border/60 last:border-0 ${fresh ? "row-flash rise" : ""}`}
                  >
                    <td className={`${CELL} font-mono`}>#{formatInt(b.number)}</td>
                    <td className={`${CELL} text-muted-foreground`}>{ago(b.timestamp, now)}</td>
                    <td className={`${CELL} font-mono`}>
                      <span className="flex items-center gap-2" title={b.coinbase}>
                        {shortHex(b.coinbase, 8, 6)}
                        {ours && (
                          <span className="brand-gradient rounded-sm px-1.5 py-px font-sans text-[9px] font-semibold tracking-wider text-brand-foreground uppercase">
                            {t("blocks.yours")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${CELL} text-right`}>{formatInt(b.txCount)}</td>
                    <td className={CELL}>
                      <span className="flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-brand-mark"
                            style={{ width: `${Math.max(full * 100, full > 0 ? 2 : 0)}%` }}
                          />
                        </span>
                        <span className="w-9 text-right text-muted-foreground">{formatPercent(full)}</span>
                      </span>
                    </td>
                    <td className={`${CELL} text-right`}>
                      {formatLax(b.rewardWei, 2)} <span className="text-muted-foreground">LAX</span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </Plate>
  );
}
