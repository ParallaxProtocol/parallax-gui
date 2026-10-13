import { useState } from "react";
import { Loader2, Square } from "lucide-react";
import { MinerStatus } from "../../lib/api";
import { formatDifficulty, formatDuration, formatHashrate, formatInt, formatPercent } from "../../lib/format";
import { Sample } from "../../lib/live";
import { useT } from "../../i18n";
import { AreaChart } from "../../components/ui/Chart";
import { Indicator } from "../../components/ui/Indicator";
import { Label, Plate } from "../../components/ui/Plate";
import { Rolling } from "../../components/ui/Rolling";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { Tile } from "../../components/ui/Tile";
import { Fill, Meter } from "../../components/ui/bits";

/**
 * Live is the miner while it runs: the hashrate large over its chart,
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
    <div className="flex flex-col gap-10">
      <Plate className="flex flex-col gap-6 p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2">
              <Indicator grade={status.generatingDag ? "info" : "good"} ping cause={String(status.generatingDag)} />
              <Label>
                {status.generatingDag ? t("mining.generatingDag") : t("mining.mining")} ·{" "}
                {t(`mining.mode.${status.mode}`)}
              </Label>
            </span>
            <p className="text-6xl font-semibold tracking-tight tabular-nums">
              <Rolling value={formatHashrate(status.hashrate)} />
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {t("mining.avg", { rate: formatHashrate(avg) })} · {t("mining.for", { time: formatDuration(status.uptimeSeconds) })}
            </p>
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
            {stopping ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5 fill-current" />}
            {stopping ? t("mining.stopping") : t("mining.stop")}
          </button>
        </div>

        {status.generatingDag && (
          <div className="rise flex flex-col gap-2 pb-1">
            <span className="text-xs text-muted-foreground">
              {t("mining.genDagEpoch")} {status.epoch} · {t("mining.dagDesc")}
            </span>
            <Meter />
          </div>
        )}

        <AreaChart samples={history} height={160} format={formatHashrate} floorZero={false} label={t("mining.hashrate")} />
      </Plate>

      <div className="flex flex-col gap-4">
        <SectionHeader index={1} title={t("mining.liveStats")} />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {gpu ? (
            <Tile
              label={t("mining.shares")}
              readout={shares > 0 ? formatPercent(acceptedShare) : undefined}
              value={formatInt(status.sharesAccepted)}
              qualifier={t("mining.sharesDetail", { rejected: status.sharesRejected, failed: status.sharesFailed })}
              tone={acceptedShare < 0.9 ? "warn" : null}
              flashKey={status.sharesAccepted}
            >
              {/* Rejected shares show as the red track behind the accepted fill */}
              <div className="relative h-1.5 overflow-hidden rounded-full bg-critical">
                <Fill value={acceptedShare} className="bg-brand-mark" />
              </div>
            </Tile>
          ) : (
            <Tile
              label={t("mining.blocksFound")}
              value={formatInt(status.soloBlocksFound)}
              qualifier={t("mining.blocksFoundDesc")}
              flashKey={status.soloBlocksFound}
            />
          )}
          {status.mode === "solo" ? (
            <Tile
              label={t("mining.difficulty")}
              value={formatDifficulty(status.soloDifficulty || "0")}
              qualifier={t("mining.difficultyDesc")}
            />
          ) : (
            <Tile
              label={t("mining.lastShare")}
              value={status.secsSinceLastShare > 0 ? formatDuration(status.secsSinceLastShare) : "—"}
              qualifier={t("mining.lastShareDesc")}
            />
          )}
          <Tile
            label={status.mode === "pool" ? t("mining.poolLabel") : t("mining.nodeLabel")}
            value={
              <span className="flex items-center gap-3 text-2xl">
                <Indicator
                  grade={status.mode === "solo" || status.poolConnected ? "good" : "critical"}
                  ping
                  cause={String(status.poolConnected)}
                />
                {status.mode === "solo" || status.poolConnected ? t("mining.connected") : t("mining.disconnected")}
              </span>
            }
            qualifier={
              status.poolUri ? (
                <span className="block truncate font-mono text-xs" title={status.poolUri}>
                  {status.poolUri}
                </span>
              ) : undefined
            }
          />
          <Tile label={t("mining.uptime")} value={formatDuration(status.uptimeSeconds)} qualifier={t("mining.uptimeDesc")} />
        </div>
      </div>

      {gpu && status.devices?.length > 0 && (
        <div className="flex flex-col gap-4">
          <SectionHeader index={2} title={t("mining.gpuDevicesStat")} aside={t("mining.devices", { n: status.devices.length })} />
          <Plate className="px-5 py-2">
            <ul className="divide-y divide-border">
              {status.devices.map((d) => {
                const share = status.hashrate > 0 ? d.hashrate / status.hashrate : 0;
                return (
                  <li key={d.index} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Indicator grade={d.paused ? "off" : "good"} />
                        <span className="truncate">
                          #{d.index} {d.name}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {d.mode} · {d.accepted} {t("mining.accepted")}
                        {d.rejected > 0 && ` · ${d.rejected} ${t("mining.rejected")}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 font-mono text-xs tabular-nums">
                      {d.tempC > 0 && (
                        <span className={d.tempC > 80 ? "text-critical-ink" : d.tempC > 70 ? "text-warn-ink" : "text-muted-foreground"}>
                          {d.tempC}°C
                        </span>
                      )}
                      {d.fanPct > 0 && <span className="text-muted-foreground">{t("mining.fan", { pct: d.fanPct })}</span>}
                      {d.powerW > 0 && <span className="text-muted-foreground">{d.powerW.toFixed(0)} W</span>}
                      <span className="w-24 text-right text-sm text-foreground">{formatHashrate(d.hashrate)}</span>
                    </div>
                    <div className="relative col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                      <Fill value={share} className="brand-gradient-mark" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Plate>
        </div>
      )}
    </div>
  );
}
