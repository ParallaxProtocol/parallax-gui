import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Eye, Pencil, Pickaxe } from "lucide-react";
import { api, AddressView } from "../../lib/api";
import { formatInt, formatLax, isAddress, sameAddress, shortHex } from "../../lib/format";
import { useNode } from "../../lib/live";
import { useNow } from "../../lib/useNow";
import { useAgo, useT } from "../../i18n";
import { Label, Plate } from "../../components/ui/Plate";
import { Rolling } from "../../components/ui/Rolling";
import { Tile } from "../../components/ui/Tile";
import { CopyButton, Notice } from "../../components/ui/bits";

type Activity =
  | { kind: "in" | "out"; block: number; time: number; amountWei: string; other: string; hash: string }
  | { kind: "mined"; block: number; time: number; amountWei: string; hash: string };

/**
 * Watched follows one address through the local node: its balance at the
 * head, the blocks it mined and the transactions it sent or received in
 * the last week of blocks. Nothing leaves the machine: it all comes from
 * the node's own chain.
 */
export default function Watched() {
  const t = useT();
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
      <Plate className="p-6">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="flex items-center gap-2">
            <Eye className="size-4 text-brand" />
            <Label>{t("wallet.watch.title")}</Label>
          </span>
          <p className="text-sm text-muted-foreground">{t("wallet.watch.desc")}</p>
          <form
            className="mt-1 flex gap-2"
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
            />
            <button type="submit" className="btn btn-primary" disabled={!isAddress(draft)}>
              {t("wallet.watch.cta")}
            </button>
            {address && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setDraft(address);
                  setEditing(false);
                }}
              >
                {t("common.cancel")}
              </button>
            )}
          </form>
          {draft && !isAddress(draft) && (
            <span className="text-xs text-critical-ink">{t("wallet.watch.invalid")}</span>
          )}
        </div>
      </Plate>
    );
  }

  const balanceKnown = !!view?.balanceWei;

  return (
    <div className="flex flex-col gap-4">
      {!running && <Notice tone="info">{t("wallet.watch.nodeOff")}</Notice>}
      {err && <Notice tone="critical">{err}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
        <Plate className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <Label>{t("wallet.balance")}</Label>
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-xs text-muted-foreground" title={address}>
                {shortHex(address, 10, 8)}
              </span>
              <CopyButton value={address} compact className="-my-1" />
              <button
                type="button"
                className="btn btn-ghost btn-sm -my-1 px-2"
                onClick={() => setEditing(true)}
                aria-label={t("wallet.watch.change")}
                title={t("wallet.watch.change")}
              >
                <Pencil className="size-3.5" />
              </button>
            </span>
          </div>
          <div className="text-5xl font-semibold tracking-tight tabular-nums">
            {balanceKnown ? <Rolling value={formatLax(view!.balanceWei, 4)} /> : <span className="text-muted-foreground">—</span>}
            <span className="ml-2 text-xl font-normal text-muted-foreground">LAX</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {!view
              ? "…"
              : balanceKnown
                ? t("wallet.balanceAt", { block: formatInt(view.headBlock) })
                : t("wallet.balanceSyncing")}
          </p>
        </Plate>
        <Tile
          label={t("wallet.mined")}
          readout={t("wallet.window")}
          value={view ? formatInt(view.blocksMined) : "—"}
          qualifier={view ? t("wallet.minedReward", { lax: formatLax(view.minedWei, 2) }) : undefined}
        />
        <Tile
          label={t("wallet.sent")}
          readout={t("wallet.allTime")}
          value={view ? formatInt(view.nonce) : "—"}
          qualifier={t("wallet.sentDesc")}
        />
      </div>

      <Plate className="px-5 py-4">
        <div className="mb-2 flex items-baseline justify-between">
          <Label>{t("wallet.activity")}</Label>
          {view && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("wallet.activityWindow", { from: formatInt(view.scannedFrom) })}
            </span>
          )}
        </div>
        {activity.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {view ? t("wallet.activityEmpty") : "…"}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((a) => (
                <li key={`${a.kind}-${a.hash}`} className="rise flex items-center gap-4 py-3">
                  <ActivityIcon kind={a.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{t(`wallet.kind.${a.kind}`)}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      #{formatInt(a.block)}
                      {a.kind !== "mined" && a.other && ` · ${shortHex(a.other, 8, 6)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`font-mono text-sm tabular-nums ${
                        a.kind === "out" ? "" : "text-good-ink"
                      }`}
                    >
                      {a.kind === "out" ? "−" : "+"}
                      {formatLax(a.amountWei, 4)} LAX
                    </div>
                    <div className="text-[11px] text-muted-foreground">{ago(a.time, now)}</div>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Plate>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: Activity["kind"] }) {
  const Icon = kind === "in" ? ArrowDownLeft : kind === "out" ? ArrowUpRight : Pickaxe;
  return (
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-full border ${
        kind === "mined"
          ? "border-transparent brand-gradient text-brand-foreground"
          : kind === "in"
            ? "border-brand/40 text-brand"
            : "border-border-strong text-muted-foreground"
      }`}
    >
      <Icon className="size-4" />
    </span>
  );
}
