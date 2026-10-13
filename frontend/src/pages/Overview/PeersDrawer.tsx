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
      title={t("peers.title")}
      meta={t("peers.summary", { total: peers.length, in: inCount, out: outCount })}
      width="max-w-2xl"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background px-4 py-2">
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
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("peers.showing", { n: shown.length, total: peers.length })}
        </span>
      </div>

      {error && <Notice tone="critical" className="mx-4 mt-3">{error}</Notice>}

      {shown.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{t("peers.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((p) => {
              const open = expanded === p.fullId;
              return (
                <li key={p.fullId}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : p.fullId)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-hover"
                    aria-expanded={open}
                  >
                    <ChevronRight
                      className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                    />
                    <span
                      className={`badge w-10 justify-center ${p.inbound ? "bg-warn/15 text-warn-ink" : "bg-brand-muted text-brand"}`}
                      title={p.inbound ? t("peers.tooltip.in") : t("peers.tooltip.out")}
                    >
                      {p.inbound ? t("peers.in") : t("peers.out")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-sm">{p.id}</span>
                        <span className="truncate">
                          {p.name || t("peers.unknown")}
                        </span>
                        {p.trusted && <Badge>{t("peers.trusted")}</Badge>}
                        {p.static && <Badge>{t("peers.static")}</Badge>}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {p.remoteAddr}
                        {p.minPingMs ? ` · ${p.minPingMs.toFixed(0)} ms` : ""}
                      </div>
                    </div>
                  </button>

                  {open && (
                        <dl className="mx-4 mb-3 space-y-2 rounded-md border border-border bg-surface p-3">
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
                              <dt className="mb-1 text-sm text-muted-foreground">
                                {t("peers.protocols")}
                              </dt>
                              <pre className="overflow-x-auto rounded-md border border-border bg-field p-2.5 font-mono text-xs text-muted-foreground">
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
    <span className="badge">{children}</span>
  );
}

function Detail({ label, value, wrap, copy }: { label: string; value: string; wrap?: boolean; copy?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr_auto] items-baseline gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`font-mono text-sm ${wrap ? "break-all" : "truncate"}`}>{value || "—"}</dd>
      {copy && value ? <CopyButton value={value} className="-my-1" /> : <span />}
    </div>
  );
}
