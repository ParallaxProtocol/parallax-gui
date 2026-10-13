import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BlockView } from "../../lib/api";
import { formatInt, formatLax, formatPercent, sameAddress, shortHex } from "../../lib/format";
import { SPRING } from "../../lib/motion";
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
  // The newest block on first render: only blocks after it count as arrivals
  const first = useRef<number | null>(null);
  if (first.current === null && blocks.length > 0) first.current = blocks[0].number;

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
            <AnimatePresence initial={false}>
              {blocks.map((b) => {
                const fresh = first.current !== null && b.number > first.current;
                const ours = sameAddress(b.coinbase, mine);
                const full = b.gasLimit > 0 ? b.gasUsed / b.gasLimit : 0;
                return (
                  <motion.tr
                    key={b.number}
                    layout="position"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={SPRING}
                    className={`border-b border-border/60 last:border-0 ${fresh ? "row-flash" : ""}`}
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
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      )}
    </Plate>
  );
}
