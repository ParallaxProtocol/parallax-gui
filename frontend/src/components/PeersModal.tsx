import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, PeerView } from "../lib/api";
import { useT } from "../i18n";

type Filter = "all" | "in" | "out";

export default function PeersModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  // Poll only while open. Closing the modal stops the 2s peer fetch
  // immediately so the dashboard isn't paying for a list nobody is
  // looking at.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = async () => {
      try {
        const p = await api.peers();
        if (alive) setPeers(p);
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

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = peers.filter((p) => {
    if (filter === "in") return p.inbound;
    if (filter === "out") return !p.inbound;
    return true;
  });

  const inCount = peers.filter((p) => p.inbound).length;
  const outCount = peers.length - inCount;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="peers-backdrop"
          className="fixed inset-0 z-[100] flex items-center justify-center px-6 py-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm" />

          {/* Modal panel */}
          <motion.div
            key="peers-panel"
            className="relative w-full max-w-3xl max-h-full flex flex-col rounded-lg border border-border-strong bg-bg-elev shadow-card-hover"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 px-7 pt-6 pb-5 border-b border-border">
              <div>
                <div className="eyebrow mb-1">{t("peers.eyebrow")}</div>
                <h2 className="font-serif text-2xl text-fg leading-tight">
                  {t("peers.title")}
                </h2>
                <div className="text-xs text-muted tabular-nums mt-1">
                  {peers.length} {t("peers.totalStats")} · {inCount} {t("peers.inbound")} · {outCount} {t("peers.outbound")}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="text-muted hover:text-fg transition-colors text-xl leading-none px-2 py-1"
              >
                ✕
              </button>
            </header>

            <div className="flex items-center justify-between px-7 py-4 border-b border-border">
              <div className="flex gap-2">
                {(["all", "in", "out"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    className={`px-3.5 py-1.5 rounded text-[11px] uppercase tracking-wider transition-all duration-200 ${
                      filter === k
                        ? "bg-gold text-gold-fg shadow-gold-glow"
                        : "border border-border-strong text-muted hover:text-fg hover:border-fg/30"
                    }`}
                  >
                    {k === "all" ? t("peers.filter.all") : k === "in" ? t("peers.filter.in") : t("peers.filter.out")}
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted tabular-nums">
                {t("peers.showing")} {filtered.length} {t("peers.of")} {peers.length}
              </div>
            </div>

            {error && (
              <div className="mx-7 mt-5 card border-danger/40 bg-danger/10 text-danger text-sm">
                {error}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto px-7 py-3">
              {filtered.length === 0 ? (
                <p className="text-muted text-sm py-8 text-center">
                  {t("peers.empty")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((p) => {
                    const isExpanded = expanded === p.fullId;
                    return (
                      <li key={p.fullId} className="py-4">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded(isExpanded ? null : p.fullId)
                          }
                          className="w-full flex items-center gap-4 text-left group"
                        >
                          <span
                            className={p.inbound ? "pill-warn" : "pill-ok"}
                            title={
                              p.inbound ? t("peers.tooltip.in") : t("peers.tooltip.out")
                            }
                          >
                            <span
                              className={
                                p.inbound
                                  ? "live-dot-warn"
                                  : "live-dot-success"
                              }
                            />
                            {p.inbound ? t("peers.in") : t("peers.out")}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-3">
                              <span className="font-mono text-xs text-fg">
                                {p.id}
                              </span>
                              <span className="text-sm text-fg/80 truncate group-hover:text-fg transition-colors">
                                {p.name || t("peers.unknown")}
                              </span>
                              {p.trusted && (
                                <span className="pill-ok">{t("peers.trusted")}</span>
                              )}
                              {p.static && (
                                <span className="pill-warn">{t("peers.static")}</span>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-muted truncate mt-0.5">
                              {p.remoteAddr} · {p.caps.join(", ")}
                            </div>
                          </div>
                          <motion.span
                            className="text-muted text-xs"
                            animate={{ rotate: isExpanded ? 90 : 0 }}
                            transition={{
                              duration: 0.3,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                          >
                            ▸
                          </motion.span>
                        </button>

                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              key="content"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{
                                duration: 0.4,
                                ease: [0.16, 1, 0.3, 1],
                              }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 ml-12 space-y-3 text-sm">
                                <Detail
                                  label={t("peers.fullId")}
                                  value={p.fullId}
                                  mono
                                />
                                <Detail
                                  label={t("peers.enode")}
                                  value={p.enode}
                                  mono
                                  wrap
                                />
                                <Detail
                                  label={t("peers.remoteAddr")}
                                  value={p.remoteAddr}
                                  mono
                                />
                                <Detail
                                  label={t("peers.localAddr")}
                                  value={p.localAddr}
                                  mono
                                />
                                <Detail
                                  label={t("peers.caps")}
                                  value={p.caps.join(", ") || t("peers.none")}
                                  mono
                                />
                                {p.protocols &&
                                  Object.keys(p.protocols).length > 0 && (
                                    <div>
                                      <div className="eyebrow mb-2">
                                        {t("peers.protocols")}
                                      </div>
                                      <pre className="font-mono text-[11px] text-muted bg-bg-elev-2 rounded p-3 overflow-x-auto border border-border">
                                        {JSON.stringify(p.protocols, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Detail({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 items-baseline">
      <div className="eyebrow">{label}</div>
      <div
        className={`text-fg/90 ${mono ? "font-mono text-xs" : ""} ${
          wrap ? "break-all" : "truncate"
        }`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
