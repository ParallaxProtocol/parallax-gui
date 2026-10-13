import { useState } from "react";
import { Loader2, Square } from "lucide-react";
import { MinerStatus } from "../../lib/api";
import { formatDifficulty, formatDuration, formatHashrate, formatInt, formatPercent } from "../../lib/format";
import { Sample } from "../../lib/live";
import { useT } from "../../i18n";
import { AreaChart } from "../../components/ui/Chart";
import { Indicator } from "../../components/ui/Indicator";
import { Label, Panel, Rows, Section, Stat, StatStrip } from "../../components/ui/Panel";
import { Fill, Meter } from "../../components/ui/bits";

/**
 * Live is the miner while it runs: the hashrate over its chart,
 * shares or found blocks, the link to the pool or node, and each GPU.
 */
export default function Live({
  status,
  history,
  onStop,
}: {
  status: MinerStatus;
  history: Sample[];
  onStop: () => Promise<void>;
}) {
  const t = useT();
  const [stopping, setStopping] = useState(false);
  const gpu = status.mode === "pool" || status.mode === "sologpu";
  const shares = status.sharesAccepted + status.sharesRejected + status.sharesFailed;
  const acceptedShare = shares > 0 ? status.sharesAccepted / shares : 1;
  const avg = history.length ? history.reduce((s, p) => s + p.v, 0) / history.length : 0;

  return (
    <>
      <Panel className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <Indicator grade={status.generatingDag ? "info" : "good"} ping cause={String(status.generatingDag)} />
              <Label>
                {status.generatingDag ? t("mining.generatingDag") : t("mining.mining")} · {t(`mining.mode.${status.mode}`)}
              </Label>
            </span>
            <span className="text-2xl font-semibold tabular-nums">{formatHashrate(status.hashrate)}</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("mining.avg", { rate: formatHashrate(avg) })} · {t("mining.for", { time: formatDuration(status.uptimeSeconds) })}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await onStop();
              } finally {
                setStopping(false);
              }
            }}
          >
            {stopping ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3 fill-current" />}
            {stopping ? t("mining.stopping") : t("mining.stop")}
          </button>
        </div>

        {status.generatingDag && (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">
              {t("mining.genDagEpoch")} {status.epoch} · {t("mining.dagDesc")}
            </span>
            <Meter />
          </div>
        )}

        <AreaChart samples={history} height={140} format={formatHashrate} floorZero={false} label={t("mining.hashrate")} />
      </Panel>

      <StatStrip>
        {gpu ? (
          <Stat
            label={t("mining.shares")}
            value={formatInt(status.sharesAccepted)}
            detail={
              <span className={acceptedShare < 0.9 ? "text-warn-ink" : ""}>
                {shares > 0 && `${formatPercent(acceptedShare)} · `}
                {t("mining.sharesDetail", { rejected: status.sharesRejected, failed: status.sharesFailed })}
              </span>
            }
          />
        ) : (
          <Stat label={t("mining.blocksFound")} value={formatInt(status.soloBlocksFound)} detail={t("mining.blocksFoundDesc")} />
        )}
        {status.mode === "solo" ? (
          <Stat
            label={t("mining.difficulty")}
            value={formatDifficulty(status.soloDifficulty || "0")}
            detail={t("mining.difficultyDesc")}
          />
        ) : (
          <Stat
            label={t("mining.lastShare")}
            value={status.secsSinceLastShare > 0 ? formatDuration(status.secsSinceLastShare) : "—"}
            detail={t("mining.lastShareDesc")}
          />
        )}
        <Stat
          label={status.mode === "pool" ? t("mining.poolLabel") : t("mining.nodeLabel")}
          value={
            <span className="flex items-center gap-2">
              <Indicator
                grade={status.mode === "solo" || status.poolConnected ? "good" : "critical"}
                ping
                cause={String(status.poolConnected)}
              />
              {status.mode === "solo" || status.poolConnected ? t("mining.connected") : t("mining.disconnected")}
            </span>
          }
          detail={
            status.poolUri ? (
              <span className="font-mono" title={status.poolUri}>
                {status.poolUri}
              </span>
            ) : undefined
          }
        />
        <Stat label={t("mining.uptime")} value={formatDuration(status.uptimeSeconds)} detail={t("mining.uptimeDesc")} />
      </StatStrip>

      {gpu && status.devices?.length > 0 && (
        <Section title={t("mining.gpuDevicesStat")} aside={t("mining.devices", { n: status.devices.length })}>
          <Rows>
            {status.devices.map((d) => {
              const share = status.hashrate > 0 ? d.hashrate / status.hashrate : 0;
              return (
                <div key={d.index} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Indicator grade={d.paused ? "off" : "good"} />
                      <span className="truncate font-medium">
                        GPU {d.index}: {d.name}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {d.mode} · {d.accepted} {t("mining.accepted")}
                      {d.rejected > 0 && ` · ${d.rejected} ${t("mining.rejected")}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-sm tabular-nums">
                    {d.tempC > 0 && (
                      <span className={d.tempC > 80 ? "text-critical-ink" : d.tempC > 70 ? "text-warn-ink" : "text-muted-foreground"}>
                        {d.tempC}°C
                      </span>
                    )}
                    {d.fanPct > 0 && <span className="text-muted-foreground">{t("mining.fan", { pct: d.fanPct })}</span>}
                    {d.powerW > 0 && <span className="text-muted-foreground">{d.powerW.toFixed(0)} W</span>}
                    <span className="w-24 text-right text-base font-medium">{formatHashrate(d.hashrate)}</span>
                  </div>
                  <div className="relative col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                    <Fill value={share} className="bg-brand-mark" />
                  </div>
                </div>
              );
            })}
          </Rows>
        </Section>
      )}
    </>
  );
}
