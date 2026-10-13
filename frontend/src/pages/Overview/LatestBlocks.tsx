import { useRef } from "react";
import { BlockView } from "../../lib/api";
import { formatInt, formatLax, formatPercent, sameAddress, shortHex } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { useAgo, useT } from "../../i18n";
import { Panel } from "../../components/ui/Panel";

const HEAD = "h-7 px-3 text-left text-sm font-medium text-muted-foreground first:pl-4 last:pr-4";
const CELL = "h-8 px-3 whitespace-nowrap tabular-nums first:pl-4 last:pr-4";

/**
 * LatestBlocks lists the newest blocks: when each was found and by whom,
 * what it carried and how full it was. A block that arrives while the
 * table is shown is highlighted briefly; blocks the user's own mining
 * address found are marked.
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
    <Panel className="overflow-hidden">
      {blocks.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t("blocks.waiting")}</p>
      ) : (
        <table className="w-full">
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
                  <tr key={b.number} className={`even:bg-muted/40 ${fresh ? "row-flash" : ""}`}>
                    <td className={`${CELL} font-medium`}>{formatInt(b.number)}</td>
                    <td className={`${CELL} text-muted-foreground`}>{ago(b.timestamp, now)}</td>
                    <td className={CELL}>
                      <span className="flex items-center gap-2" title={b.coinbase}>
                        <span className="font-mono text-sm">{shortHex(b.coinbase, 8, 6)}</span>
                        {ours && <span className="badge bg-brand-muted text-brand">{t("blocks.yours")}</span>}
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
                        <span className="w-9 text-right text-sm text-muted-foreground">{formatPercent(full)}</span>
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
    </Panel>
  );
}
