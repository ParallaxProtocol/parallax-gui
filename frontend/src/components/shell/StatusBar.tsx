import { Link } from "react-router-dom";
import { Pickaxe } from "lucide-react";
import { formatDuration, formatHashrate, formatInt } from "../../lib/format";
import { nodeState, syncProgress, useMiner, useNode } from "../../lib/live";
import { useT } from "../../i18n";
import { Indicator, type Grade } from "../ui/Indicator";
import { Meter } from "../ui/bits";

const STATE_GRADE: Record<ReturnType<typeof nodeState>, Grade> = {
  stopped: "off",
  syncing: "info",
  synced: "good",
};

/**
 * StatusBar runs along the window's foot with the node's heartbeat, in
 * view from every page: its state, sync progress, the block height,
 * peers and uptime, and the miner's rate while it runs.
 */
export default function StatusBar({ version }: { version: string }) {
  const t = useT();
  const node = useNode();
  const { status: miner } = useMiner();
  const state = nodeState(node);
  const progress = syncProgress(node);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-sidebar px-3 text-sm text-muted-foreground tabular-nums">
      <span className="flex items-center gap-1.5 text-foreground/85">
        <Indicator grade={STATE_GRADE[state]} ping={state !== "stopped"} cause={state} />
        {t(`node.state.${state}`)}
      </span>

      {node?.running && (
        <>
          {state === "syncing" && (
            <span className="flex items-center gap-2">
              <Meter value={progress} className="w-28" label={t("node.state.syncing")} />
              {(progress * 100).toFixed(1)}%
            </span>
          )}
          <Divider />
          <span title={t("clock.bestBlock")}>
            {t("status.block")} {formatInt(node.currentBlock)}
          </span>
          <Divider />
          <span>{t(node.peers === 1 ? "node.peer" : "node.peers", { n: node.peers })}</span>
          <Divider />
          <span title={t("overview.uptime")}>{t("status.uptime", { time: formatDuration(node.uptimeSeconds) })}</span>
        </>
      )}

      <span className="flex-1" />

      {miner?.running && (
        <Link to="/mining" className="flex items-center gap-1.5 hover:text-foreground">
          <Pickaxe className="size-3 text-brand" />
          {formatHashrate(miner.hashrate)}
        </Link>
      )}
      {version && <span className="text-faint">{version}</span>}
    </footer>
  );
}

function Divider() {
  return <span aria-hidden className="h-3 w-px bg-border-strong" />;
}
