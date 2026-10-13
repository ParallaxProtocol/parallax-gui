import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api, PeerView } from "../../lib/api";
import { useT } from "../../i18n";
import { Drawer } from "../../components/ui/Drawer";
import { Segmented } from "../../components/ui/Segmented";
import { CopyButton, Notice } from "../../components/ui/bits";

type Filter = "all" | "in" | "out";

/**
 * PeersDrawer lists the node's connected peers, filtered by direction,
 * each expanding to its full detail. It polls only while open.
 */
export default function PeersDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = async () => {
      try {
        const p = await api.peers();
        if (alive) {
          setPeers(p);
          setError(null);
        }
      } catch (e: any) {
        if (alive) setError(e?.message || String(e));
      }
    };
    refresh();
    const id = setInterval(refresh, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  const inCount = peers.filter((p) => p.inbound).length;
  const outCount = peers.length - inCount;
  const shown = peers.filter((p) => (filter === "in" ? p.inbound : filter === "out" ? !p.inbound : true));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={t("peers.eyebrow")}
      title={t("peers.title")}
      meta={t("peers.summary", { total: peers.length, in: inCount, out: outCount })}
      width="max-w-2xl"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-surface-elevated px-6 py-3">
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("peers.filter.all") },
            { value: "in", label: t("peers.filter.in") },
            { value: "out", label: t("peers.filter.out") },
          ]}
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {t("peers.showing", { n: shown.length, total: peers.length })}
        </span>
      </div>

      {error && <Notice tone="critical" className="mx-6 mt-4">{error}</Notice>}

      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{t("peers.empty")}</p>
      ) : (
        <ul className="divide-y divide-border px-6">
          {shown.map((p) => {
              const open = expanded === p.fullId;
              return (
                <li key={p.fullId} className="py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : p.fullId)}
                    className="group flex w-full items-center gap-4 text-left"
                    aria-expanded={open}
                  >
                    <span
                      className={`w-11 shrink-0 rounded-sm border py-0.5 text-center font-mono text-[10px] tracking-wider ${
                        p.inbound ? "border-warn/40 text-warn-ink" : "border-brand/40 text-brand"
                      }`}
                      title={p.inbound ? t("peers.tooltip.in") : t("peers.tooltip.out")}
                    >
                      {p.inbound ? t("peers.in") : t("peers.out")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-xs">{p.id}</span>
                        <span className="truncate text-sm text-foreground/80 transition-colors group-hover:text-foreground">
                          {p.name || t("peers.unknown")}
                        </span>
                        {p.trusted && <Badge>{t("peers.trusted")}</Badge>}
                        {p.static && <Badge>{t("peers.static")}</Badge>}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {p.remoteAddr}
                        {p.minPingMs ? ` · ${p.minPingMs.toFixed(0)} ms` : ""}
                      </div>
                    </div>
                    <ChevronRight
                      className={`size-4 text-muted-foreground transition-transform duration-300 ${open ? "rotate-90" : ""}`}
                    />
                  </button>

                  {open && (
                        <dl className="rise mt-3 ml-15 space-y-2.5 rounded-md border border-border bg-background p-4 text-sm">
                          <Detail label={t("peers.fullId")} value={p.fullId} copy />
                          <Detail label={t("peers.enode")} value={p.enode} wrap copy />
                          <Detail label={t("peers.remoteAddr")} value={p.remoteAddr} />
                          <Detail label={t("peers.localAddr")} value={p.localAddr} />
                          <Detail label={t("peers.network")} value={p.network || "—"} />
                          <Detail
                            label={t("peers.minPing")}
                            value={p.minPingMs ? `${p.minPingMs.toFixed(1)} ms` : "—"}
                          />
                          <Detail label={t("peers.caps")} value={p.caps.join(", ") || t("peers.none")} />
                          {p.protocols && Object.keys(p.protocols).length > 0 && (
                            <div>
                              <dt className="mb-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                                {t("peers.protocols")}
                              </dt>
                              <pre className="overflow-x-auto rounded-sm border border-border bg-surface-elevated p-3 font-mono text-[11px] text-muted-foreground">
                                {JSON.stringify(p.protocols, null, 2)}
                              </pre>
                            </div>
                          )}
                        </dl>
                  )}
                </li>
              );
          })}
        </ul>
      )}
    </Drawer>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-foreground/5 px-1.5 py-px font-mono text-[9px] tracking-wider text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function Detail({ label, value, wrap, copy }: { label: string; value: string; wrap?: boolean; copy?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-baseline gap-3">
      <dt className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={`font-mono text-xs text-foreground/90 ${wrap ? "break-all" : "truncate"}`}>{value || "—"}</dd>
      {copy && value ? <CopyButton value={value} compact className="-my-1" /> : <span />}
    </div>
  );
}
