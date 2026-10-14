import { useEffect, useRef } from "react";
import { onEvent } from "./api";
import { useMiner, useNode } from "./live";
import { useT } from "../i18n";

/** A sync shorter than this (a new block arriving at the tip) isn't worth a notification. */
const LONG_SYNC_MS = 2 * 60 * 1000;

function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission === "denied") return;
  const n = new Notification(title, { body, silent: false });
  n.onclick = () => window.focus();
}

/**
 * DesktopBehaviors carries out the Settings that act outside the window:
 * keeping the computer awake while mining or syncing, and notifying the
 * user when a long sync finishes, a solo block is found, or the node stops
 * itself to protect its database from a full disk. It renders nothing.
 */
export function DesktopBehaviors({ notifications, preventSleep }: { notifications: boolean; preventSleep: boolean }) {
  const t = useT();
  const node = useNode();
  const { status: miner } = useMiner();

  const busy = !!miner?.running || (!!node?.running && node.syncing);
  const awake = preventSleep && busy;
  useEffect(() => {
    window.parallax?.keepAwake?.(awake);
  }, [awake]);
  useEffect(() => () => window.parallax?.keepAwake?.(false), []);

  // Sync finished: the node was syncing for a while and has caught up
  const syncingSince = useRef<number | null>(null);
  useEffect(() => {
    if (!node?.running) {
      syncingSince.current = null;
      return;
    }
    if (node.syncing) {
      syncingSince.current ??= Date.now();
      return;
    }
    const since = syncingSince.current;
    syncingSince.current = null;
    if (notifications && since !== null && Date.now() - since >= LONG_SYNC_MS) {
      notify(t("notify.synced"), t("notify.synced.body", { block: node.currentBlock.toLocaleString() }));
    }
  }, [node?.running, node?.syncing, node?.currentBlock, notifications, t]);

  // A solo block found: the count rises within one mining run
  const found = useRef<number | null>(null);
  const blocks = miner?.running ? miner.soloBlocksFound : null;
  useEffect(() => {
    if (blocks !== null && found.current !== null && blocks > found.current && notifications) {
      notify(t("notify.blockFound"), t("notify.blockFound.body", { n: blocks }));
    }
    found.current = blocks;
  }, [blocks, notifications, t]);

  // The free disk space guard stopped the node
  const on = useRef(notifications);
  on.current = notifications;
  useEffect(
    () =>
      onEvent<{ kind: string }>("node", (evt) => {
        if (evt?.kind === "lowdisk" && on.current) notify(t("notify.lowDisk"), t("notify.lowDisk.body"));
      }),
    [t],
  );

  return null;
}
