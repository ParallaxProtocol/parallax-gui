import { memo, useEffect, useRef, useState } from "react";
import { Pause, Play, Search, Trash2 } from "lucide-react";
import { api, LogLine, onEvent } from "../../lib/api";
import { useT } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { CopyButton } from "../../components/ui/bits";
import { Panel } from "../../components/ui/Panel";
import { Pill } from "../../components/ui/Pill";
import { Tooltip } from "../../components/ui/Tooltip";
import { Segmented } from "../../components/ui/Segmented";

const KEEP = 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** clock is a line's local time of day, as the terminal shows it: 15:04:05. */
function clock(ts: number): string {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** stamp is a line's full local date and time, for copying and the time's tooltip: 2026-10-14 15:04:05. */
function stamp(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(ts)}`;
}

/** A line with a stable id, so appending re-renders only the new rows. */
type Row = LogLine & { id: number };

const LEVEL: Record<string, string> = {
  EROR: "text-critical-ink",
  ERROR: "text-critical-ink",
  CRIT: "text-critical-ink",
  WARN: "text-warn-ink",
  INFO: "text-info-ink",
  DEBG: "text-muted-foreground",
  DEBUG: "text-muted-foreground",
  TRCE: "text-muted-foreground",
};

/**
 * LogsPanel is the live tail of the logs, streamed from the backend's
 * batched "logs" event: the node's and the app's own in tabs of their own,
 * each with a filter, pause and copy, and a way to clear them all (the
 * file they're kept in across restarts too).
 */
export default function LogsPanel() {
  const t = useT();
  // Each source keeps its own tail, so a busy node can't push the app's
  // rarer lines out
  const [lines, setLines] = useState<Record<LogLine["source"], Row[]>>({ node: [], app: [] });
  const seq = useRef(0);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState<LogLine["source"]>("node");
  const [paused, setPaused] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const add = (batch: LogLine[]) =>
      setLines((prev) => {
        const next = { node: prev.node, app: prev.app };
        for (const src of ["node", "app"] as const) {
          const mine = batch.filter((l) => (l.source ?? "node") === src);
          if (mine.length === 0) continue;
          const all = next[src].concat(mine.map((l) => ({ ...l, id: seq.current++ })));
          next[src] = all.length > KEEP ? all.slice(all.length - KEEP) : all;
        }
        return next;
      });
    api
      .getLogTail(500)
      .then(add)
      .catch(() => {});
    return onEvent<LogLine[]>("logs", add);
  }, []);

  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, paused, source]);

  const ofSource = lines[source];
  const visible = filter ? ofSource.filter((l) => l.msg.toLowerCase().includes(filter.toLowerCase())) : ofSource;

  return (
    // One card, as Console shows a log: the toolbar across its top, the
    // lines below
    <Panel className="flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Segmented<LogLine["source"]>
          size="sm"
          value={source}
          onChange={setSource}
          options={[
            { value: "node", label: t("logs.tab.node") },
            { value: "app", label: t("logs.tab.app") },
          ]}
        />
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input h-7 rounded-full pl-8 text-sm"
            placeholder={t("logs.filter")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
          />
        </div>
        <Pill tone={paused ? "neutral" : "good"} className="gap-1.5">
          <Indicator grade={paused ? "off" : "good"} ping={!paused} />
          {paused ? t("logs.paused") : t("logs.live")}
        </Pill>
        <div className="flex items-center">
          <Tooltip content={paused ? t("logs.resume") : t("logs.pause")}>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? t("logs.resume") : t("logs.pause")}
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </button>
          </Tooltip>
          <CopyButton value={visible.map((l) => `${stamp(l.ts)} ${l.level.trim()} ${l.msg}`).join("\n")} />
          <Tooltip content={t("logs.clear")}>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              aria-label={t("logs.clear")}
              onClick={() =>
                api
                  .clearLogs()
                  .then(() => setLines({ node: [], app: [] }))
                  .catch(() => {})
              }
            >
              <Trash2 className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div ref={box} className="h-96 overflow-y-auto py-1.5 font-mono text-xs leading-5">
        {visible.length === 0 ? (
          <p className="px-4 py-2 text-muted-foreground">{t("logs.empty")}</p>
        ) : (
          visible.map((l) => <LogRow key={l.id} ts={l.ts} level={l.level} msg={l.msg} />)
        )}
      </div>
    </Panel>
  );
}

/**
 * LogRow is one line. Memoised, so new lines don't re-render the rest; and
 * with content-visibility the browser skips laying out rows scrolled away.
 */
const LogRow = memo(function LogRow({ ts, level, msg }: { ts: number; level: string; msg: string }) {
  const lvl = level.trim().toUpperCase();
  return (
    <div className="grid grid-cols-[64px_44px_1fr] gap-3 px-4 [contain-intrinsic-size:auto_20px] [content-visibility:auto] hover:bg-hover">
      <span className="text-muted-foreground tabular-nums" title={stamp(ts)}>
        {clock(ts)}
      </span>
      <span className={LEVEL[lvl] ?? "text-muted-foreground"}>{lvl}</span>
      <span className="break-words whitespace-pre-wrap text-foreground/90">{msg}</span>
    </div>
  );
});
