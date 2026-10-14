import { useEffect, useRef } from "react";
import { onEvent } from "./api";
import { useNode } from "./live";
import { useNotifications } from "./notifications";
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
 * keeping the computer awake while syncing, and notifying the user when
 * a long sync finishes or the node stops itself to protect its database
 * from a full disk. Those always go to the app's own notifications (the
 * top bar's); the desktop ones are what the setting turns on. It renders
 * nothing.
 */
export function DesktopBehaviors({ notifications, preventSleep }: { notifications: boolean; preventSleep: boolean }) {
  const t = useT();
  const node = useNode();
  const { push } = useNotifications();

  const awake = preventSleep && !!node?.running && node.syncing;
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
    if (since !== null && Date.now() - since >= LONG_SYNC_MS) {
      const body = t("notify.synced.body", { block: node.currentBlock.toLocaleString() });
      push("synced", t("notify.synced"), body);
      if (notifications) notify(t("notify.synced"), body);
    }
  }, [node?.running, node?.syncing, node?.currentBlock, notifications, t, push]);

  // The free disk space guard stopped the node
  const on = useRef(notifications);
  on.current = notifications;
  useEffect(
    () =>
      onEvent<{ kind: string }>("node", (evt) => {
        if (evt?.kind !== "lowdisk") return;
        push("lowdisk", t("notify.lowDisk"), t("notify.lowDisk.body"));
        if (on.current) notify(t("notify.lowDisk"), t("notify.lowDisk.body"));
      }),
    [t, push],
  );

  return null;
}
