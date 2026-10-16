import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronRight, CircleDot, Hourglass, Search, X } from "lucide-react";
import { api, MempoolTx, MempoolView } from "../../lib/api";
import { formatGwei, formatInt, formatLax, shortHex } from "../../lib/format";
import { SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { Segmented } from "../../components/ui/Segmented";
import { Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { Swapping } from "../../components/ui/Swapping";
import { IconBadge } from "../../components/ui/IconBadge";
import { Fact, Facts } from "../../components/ui/Panel";
import { Details, Hex, Party, Unfold } from "./parts";

type Filter = "all" | "pending" | "queued";

/** How often the open list refreshes, and how many transactions it shows at most. */
const POLL_MS = 3000;
const LIMIT = 200;
/** How long typing pauses before the search runs. */
const DEBOUNCE_MS = 250;

/**
 * MempoolList lists the transactions waiting in the node's pool inside the
 * Overview's mempool figure: searchable by hash, sender or recipient
 * (the backend matches, so a large pool isn't shipped to the window), and
 * filtered by whether each can be mined yet. Each row expands to the full
 * transaction. It polls only while open.
 *
 * Until its first page arrives it goes by `known`, the pool's counts the
 * Overview already has: an empty pool says so at once, and a busy one
 * holds its rows' place, so the panel unfolds to its size in one go.
 */
export default function MempoolList({ known }: { known?: { pending: number; queued: number } }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<MempoolView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Search once typing pauses
  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api
        .mempool(search, LIMIT)
        .then((v) => {
          if (!alive) return;
          setView(v);
          setError(null);
        })
        .catch((e: any) => alive && setError(e?.message || String(e)));
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [search]);

  const txs = view?.txs ?? [];
  const shown = txs.filter((tx) => (filter === "pending" ? !tx.queued : filter === "queued" ? tx.queued : true));
  const total = view ? view.pending + view.queued : known ? known.pending + known.queued : 0;
  // Nothing fetched yet, but the pool is known to be empty
  const knownEmpty = !view && !!known && total === 0 && !search;

  return (
    <div className="border-t border-border">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input rounded-full pr-8 pl-8"
            placeholder={t("mempool.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            spellCheck={false}
            aria-label={t("mempool.search")}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
              aria-label={t("common.clear")}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("peers.filter.all") },
            { value: "pending", label: t("mempool.pending") },
            { value: "queued", label: t("mempool.queued") },
          ]}
        />
        <span className="ml-auto text-sm whitespace-nowrap text-muted-foreground tabular-nums">
          {view
            ? t("peers.showing", { n: formatInt(shown.length), total: formatInt(search ? view.matched : total) })
            : knownEmpty
              ? t("peers.showing", { n: 0, total: 0 })
              : "…"}
        </span>
      </div>

      {error && (
        <Notice tone="critical" className="mx-5 mb-3">
          {error}
        </Notice>
      )}

      {/* Switching filter fades one list into the other, its height gliding */}
      <Swapping swap={filter}>
        {!view && !knownEmpty ? (
          <Placeholder rows={Math.min(Math.max(total, 1), 6)} />
        ) : knownEmpty || shown.length === 0 ? (
          <p className="border-t border-border py-12 text-center text-muted-foreground">
            {search || filter !== "all" ? t("mempool.noMatch") : t("mempool.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {/* Column heads over the rows' grid */}
            <li className={`grid ${ROW} gap-3 px-5 pt-2.5 pb-2 text-xs font-medium text-muted-foreground`} aria-hidden>
              <span className="col-start-3">{t("mempool.col.tx")}</span>
              <span>{t("mempool.col.parties")}</span>
              <span className="text-right">{t("mempool.value")}</span>
              <span className="text-right">{t("mempool.gasPrice")}</span>
            </li>
            <AnimatePresence initial={false}>
              {shown.map((tx) => (
                <Row
                  key={tx.hash}
                  tx={tx}
                  open={expanded === tx.hash}
                  onToggle={() => setExpanded((h) => (h === tx.hash ? null : tx.hash))}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Swapping>

      {view && view.matched > txs.length && (
        <p className="border-t border-border px-5 py-2.5 text-center text-sm text-muted-foreground">
          {t("mempool.more", { n: formatInt(txs.length), total: formatInt(view.matched) })}
        </p>
      )}
    </div>
  );
}

/** The rows' columns: chevron, status, transaction, from → to, value, gas price. */
const ROW = "grid-cols-[14px_32px_minmax(0,1fr)_minmax(0,1fr)_minmax(96px,auto)_76px]";

/** Placeholder holds the place of rows still on their way: the same height, a faint shimmer. */
function Placeholder({ rows }: { rows: number }) {
  return (
    <ul className="divide-y divide-border border-t border-border" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={`grid h-[64px] ${ROW} items-center gap-3 px-5`}>
          <span />
          <span className="size-8 rounded-full bg-muted" />
          <span className="flex flex-col gap-1.5">
            <span className="h-3 w-40 rounded bg-muted" />
            <span className="h-2.5 w-20 rounded bg-muted/70" />
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="h-3 w-32 rounded bg-muted" />
            <span className="h-2.5 w-32 rounded bg-muted/70" />
          </span>
          <span className="ml-auto h-3 w-16 rounded bg-muted" />
          <span className="ml-auto h-3 w-14 rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}

function Row({ tx, open, onToggle }: { tx: MempoolTx; open: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={SPRING}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`grid w-full ${ROW} items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-hover ${open ? "bg-hover" : ""}`}
      >
        <ChevronRight
          className={`size-3.5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <Tooltip
          content={
            tx.queued ? (
              <>
                <span className="font-medium">{t("mempool.queued")}</span>
                <span className="text-muted-foreground"> · {t("mempool.tooltip.queued")}</span>
              </>
            ) : (
              t("mempool.tooltip.pending")
            )
          }
        >
          <IconBadge
            icon={tx.queued ? Hourglass : CircleDot}
            tone={tx.queued ? "warn" : "brand"}
            size="sm"
            aria-label={tx.queued ? t("mempool.queued") : t("mempool.pending")}
            role="img"
          />
        </Tooltip>
        <span className="min-w-0">
          <Tooltip content={tx.hash} mono>
            <span className="block truncate font-mono text-sm">{shortHex(tx.hash, 10, 8)}</span>
          </Tooltip>
          <span className="block truncate text-sm text-muted-foreground">
            {t("mempool.nonceN", { n: tx.nonce })}
            {/* A creation already says so in the From → To column */}
            {tx.dataBytes > 0 && tx.to && ` · ${t("mempool.call")}`}
          </span>
        </span>
        <span className="min-w-0 font-mono text-sm">
          <Tooltip content={tx.from} mono>
            <span className="block truncate">{shortHex(tx.from, 8, 6)}</span>
          </Tooltip>
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
            <ArrowRight className="size-3 shrink-0" />
            <Tooltip content={tx.to} mono>
              <span className="truncate">
                {tx.to ? shortHex(tx.to, 8, 6) : <span className="font-sans">{t("mempool.creation")}</span>}
              </span>
            </Tooltip>
          </span>
        </span>
        <span className="truncate text-right tabular-nums">
          {formatLax(tx.valueWei, 4)} <span className="text-muted-foreground">LAX</span>
        </span>
        <span className="text-right text-sm text-muted-foreground tabular-nums">{formatGwei(tx.gasPriceWei)}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <Unfold>
            <Details>
              {/* Two columns where there's room, as an account's activity:
                  who and what it is on the left, what it costs on the right */}
              <div className="grid items-start gap-3 lg:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <Facts>
                    <Fact label={t("mempool.from")}>
                      <Party address={tx.from} />
                    </Fact>
                    <Fact label={t("mempool.to")}>{tx.to ? <Party address={tx.to} /> : t("mempool.creation")}</Fact>
                  </Facts>
                  <Facts>
                    <Fact label={t("mempool.hash")}>
                      <Hex value={tx.hash} />
                    </Fact>
                    <Fact label={t("mempool.nonce")}>{formatInt(tx.nonce)}</Fact>
                    <Fact label={t("mempool.data")}>
                      {tx.dataBytes ? t("mempool.bytes", { n: formatInt(tx.dataBytes) }) : t("peers.none")}
                    </Fact>
                  </Facts>
                </div>
                <div className="flex flex-col gap-3">
                  <Facts>
                    <Fact label={t("mempool.value")}>{formatLax(tx.valueWei, 18)} LAX</Fact>
                    <Fact label={t("mempool.maxFee")}>{formatLax(maxFeeWei(tx), 18)} LAX</Fact>
                    <Fact label={t("mempool.gasPrice")}>{formatGwei(tx.gasPriceWei)}</Fact>
                    <Fact label={t("mempool.gas")}>{formatInt(tx.gas)}</Fact>
                  </Facts>
                  <Facts>
                    <Fact label={t("mempool.size")}>{t("mempool.bytes", { n: formatInt(tx.sizeBytes) })}</Fact>
                  </Facts>
                </div>
              </div>
            </Details>
          </Unfold>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** The most the transaction can cost in fees: its gas limit at its gas price, in wei. */
function maxFeeWei(tx: MempoolTx): string {
  try {
    return (BigInt(tx.gas) * BigInt(tx.gasPriceWei || "0")).toString();
  } catch {
    return "0";
  }
}
