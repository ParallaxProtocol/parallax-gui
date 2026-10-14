import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Pencil, Pickaxe } from "lucide-react";
import { api, AddressView } from "../../lib/api";
import { formatInt, formatLax, isAddress, sameAddress, shortHex } from "../../lib/format";
import { useNode } from "../../lib/live";
import { useNow } from "../../lib/useNow";
import { STAGGER, useStagger } from "../../lib/motion";
import { Counter } from "../../components/ui/Counter";
import { useAgo, useT } from "../../i18n";
import { Panel, Section, Stat, StatStrip } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";

type Activity =
  | { kind: "in" | "out"; block: number; time: number; amountWei: string; other: string; hash: string }
  | { kind: "mined"; block: number; time: number; amountWei: string; hash: string };

/**
 * Watched follows one address through the local node: its balance at the
 * head, the blocks it mined and the transactions it sent or received in
 * the last week of blocks. Nothing leaves the machine: it all comes from
 * the node's own chain.
 */
export default function Watched({ title }: { title: string }) {
  const t = useT();
  const stagger = useStagger();
  const ago = useAgo();
  const now = useNow(5000);
  const node = useNode();
  const [address, setAddress] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<AddressView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then((c) => {
        const a = c.watchAddress || c.miningWallet || "";
        setAddress(a);
        setDraft(a);
        if (!a) setEditing(true);
      })
      .catch(() => setAddress(""));
  }, []);

  const running = !!node?.running;
  // While syncing the head moves on every poll: refetch only every few
  // hundred blocks then, so the week-long scan stays off the sync's back
  const head = node?.syncing ? Math.floor(node.currentBlock / 500) : (node?.currentBlock ?? 0);

  // Fetched again as the head moves; the backend caches per head
  useEffect(() => {
    if (!running || !address) return;
    let alive = true;
    api
      .addressSummary(address)
      .then((v) => {
        if (!alive) return;
        setView(v);
        setErr(null);
      })
      .catch((e: any) => alive && setErr(e?.message || String(e)));
    return () => {
      alive = false;
    };
  }, [running, address, head]);

  const save = async () => {
    const a = draft.trim();
    if (!isAddress(a)) return;
    // Read afresh so a change saved elsewhere since this page loaded survives
    const c = await api.getConfig();
    await api.updateConfig({ ...c, watchAddress: a });
    setView(null);
    setAddress(a);
    setEditing(false);
  };

  const activity = useMemo<Activity[]>(() => {
    if (!view) return [];
    const items: Activity[] = view.transactions.map((tx) => {
      const out = sameAddress(tx.from, view.address);
      return {
        kind: out ? "out" : "in",
        block: tx.block,
        time: tx.timestamp,
        amountWei: tx.valueWei,
        other: (out ? tx.to : tx.from) || "",
        hash: tx.hash,
      };
    });
    for (const b of view.minedBlocks) {
      items.push({ kind: "mined", block: b.number, time: b.timestamp, amountWei: b.rewardWei, hash: b.hash });
    }
    return items.sort((a, b) => b.block - a.block).slice(0, 20);
  }, [view]);

  if (address === null) return null;

  if (editing) {
    return (
      <Section title={title}>
        <Panel className="flex flex-col gap-3 p-4">
          <p className="max-w-2xl text-muted-foreground">{t("wallet.watch.desc")}</p>
          <form
            className="flex max-w-2xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              className="input font-mono"
              placeholder="0x…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              autoFocus
              aria-label={t("wallet.watch.title")}
            />
            {address && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setDraft(address);
                  setEditing(false);
                }}
              >
                {t("common.cancel")}
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={!isAddress(draft)}>
              {t("wallet.watch.cta")}
            </button>
          </form>
          {draft && !isAddress(draft) && <span className="text-sm text-critical-ink">{t("wallet.watch.invalid")}</span>}
        </Panel>
      </Section>
    );
  }

  const balanceKnown = !!view?.balanceWei;

  return (
    <Section
      title={title}
      aside={
        <>
          <Tooltip content={address} mono>
            <span className="font-mono">{shortHex(address, 10, 8)}</span>
          </Tooltip>
          <CopyButton value={address} />
          <Tooltip content={t("wallet.watch.change")}>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setEditing(true)}
              aria-label={t("wallet.watch.change")}
            >
              <Pencil className="size-3.5" />
            </button>
          </Tooltip>
        </>
      }
    >
      {!running && <Notice tone="info">{t("wallet.watch.nodeOff")}</Notice>}
      {err && <Notice tone="critical">{err}</Notice>}

      <StatStrip columns="2fr 1fr 1fr">
        <Stat
          label={t("wallet.balance")}
          value={
            balanceKnown ? (
              <Counter value={Number(formatLax(view!.balanceWei, 4))} format={(v) => formatAmount(v)} />
            ) : (
              "—"
            )
          }
          unit="LAX"
          detail={
            !view
              ? "…"
              : balanceKnown
                ? t("wallet.balanceAt", { block: formatInt(view.headBlock) })
                : t("wallet.balanceSyncing")
          }
        />
        <Stat
          label={t("wallet.mined")}
          value={view ? formatInt(view.blocksMined) : "—"}
          detail={view ? t("wallet.minedReward", { lax: formatLax(view.minedWei, 2) }) : t("wallet.window")}
        />
        <Stat label={t("wallet.sent")} value={view ? formatInt(view.nonce) : "—"} detail={t("wallet.sentDesc")} />
      </StatStrip>

      <div className="mt-3 flex min-h-6 items-center justify-between gap-4 px-1">
        <h3 className="text-sm font-semibold text-muted-foreground">{t("wallet.activity")}</h3>
        {view && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("wallet.activityWindow", { from: formatInt(view.scannedFrom) })}
          </span>
        )}
      </div>
      <Panel className="overflow-hidden">
        {activity.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">{view ? t("wallet.activityEmpty") : "…"}</p>
        ) : (
          <motion.ul {...stagger}>
            {activity.map((a) => (
              <motion.li
                variants={STAGGER.item}
                key={`${a.kind}-${a.hash}`}
                className="flex h-11 items-center gap-3 px-4 transition-colors even:bg-muted/40 hover:bg-hover"
              >
                <ActivityIcon kind={a.kind} />
                <div className="min-w-0 flex-1">
                  <div>{t(`wallet.kind.${a.kind}`)}</div>
                  <div className="truncate text-sm text-muted-foreground tabular-nums">
                    {t("wallet.inBlock", { block: formatInt(a.block) })}
                    {a.kind !== "mined" && a.other && (
                      <>
                        {" · "}
                        <span className="font-mono">{shortHex(a.other, 8, 6)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className={a.kind === "out" ? "" : "text-good-ink"}>
                    {a.kind === "out" ? "−" : "+"}
                    {formatLax(a.amountWei, 4)} LAX
                  </div>
                  <div className="text-sm text-muted-foreground">{ago(a.time, now)}</div>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </Panel>
    </Section>
  );
}

function ActivityIcon({ kind }: { kind: Activity["kind"] }) {
  const Icon = kind === "in" ? ArrowDownLeft : kind === "out" ? ArrowUpRight : Pickaxe;
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-full ${
        kind === "out" ? "bg-muted text-muted-foreground" : "bg-brand-muted text-brand"
      }`}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

/** Up to four decimals, without trailing zeros, as formatLax shows a balance. */
function formatAmount(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false });
}
