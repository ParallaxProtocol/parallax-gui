import { memo, useEffect, useRef, useState } from "react";
import { Pause, Play, Search } from "lucide-react";
import { api, LogLine, onEvent } from "../../lib/api";
import { useT } from "../../i18n";
import { Indicator } from "../../components/ui/Indicator";
import { CopyButton } from "../../components/ui/bits";

const KEEP = 1000;

/** A line with a stable id, so appending re-renders only the new rows. */
type Row = LogLine & { id: number };

const LEVEL: Record<string, string> = {
  EROR: "text-critical-ink",
  ERROR: "text-critical-ink",
  CRIT: "text-critical-ink",
  WARN: "text-warn-ink",
  INFO: "text-brand",
  DEBG: "text-muted-foreground",
  DEBUG: "text-muted-foreground",
  TRCE: "text-muted-foreground",
};

/**
 * LogsPanel is the live tail of node and GUI logs, streamed from the
 * backend's batched "logs" event, with a filter, pause and copy.
 */
export default function LogsPanel() {
  const t = useT();
  const [lines, setLines] = useState<Row[]>([]);
  const seq = useRef(0);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const add = (batch: LogLine[]) =>
      setLines((prev) => {
        const next = prev.concat(batch.map((l) => ({ ...l, id: seq.current++ })));
        return next.length > KEEP ? next.slice(next.length - KEEP) : next;
      });
    api.getLogTail(500).then(add).catch(() => {});
    return onEvent<LogLine[]>("logs", add);
  }, []);

  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, paused]);

  const visible = filter ? lines.filter((l) => l.msg.toLowerCase().includes(filter.toLowerCase())) : lines;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input className="input pl-9" placeholder={t("logs.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {paused ? t("logs.resume") : t("logs.pause")}
        </button>
        <CopyButton value={visible.map((l) => `${l.level.trim()} ${l.msg}`).join("\n")} className="h-10 px-3" />
      </div>
      <div className="relative">
        <span className="absolute top-3 right-4 z-10 flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-2.5 py-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          <Indicator grade={paused ? "off" : "good"} ping={!paused} cause={String(paused)} />
          {paused ? t("logs.paused") : t("logs.live")}
        </span>
        <div
          ref={box}
          className="h-[420px] overflow-y-auto rounded-md border border-border bg-background px-4 py-3 font-mono text-[11px] leading-relaxed"
        >
          {visible.length === 0 ? (
            <p className="text-muted-foreground">{t("logs.empty")}</p>
          ) : (
            visible.map((l) => <LogRow key={l.id} level={l.level} msg={l.msg} />)
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * LogRow is one line. Memoised, so new lines don't re-render the rest; and
 * with content-visibility the browser skips laying out rows scrolled away.
 */
const LogRow = memo(function LogRow({ level, msg }: { level: string; msg: string }) {
  const lvl = level.trim().toUpperCase();
  return (
    <div className="grid grid-cols-[48px_1fr] gap-3 py-px [contain-intrinsic-size:auto_18px] [content-visibility:auto]">
      <span className={LEVEL[lvl] ?? "text-muted-foreground"}>{lvl}</span>
      <span className="break-words whitespace-pre-wrap text-foreground/85">{msg}</span>
    </div>
  );
});
