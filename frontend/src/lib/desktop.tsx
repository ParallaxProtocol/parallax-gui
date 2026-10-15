import { useEffect, useRef } from "react";
import { api, onEvent } from "./api";
import { formatInt, formatLax, sameAddress, shortHex } from "./format";
import { useNode } from "./live";
import { useNotifications } from "./notifications";
import { accountLabel, useWallet } from "./wallet";
import { useContacts } from "./contacts";
import { useT } from "../i18n";

/** A sync shorter than this (a new block arriving at the tip) isn't worth a notification. */
const LONG_SYNC_MS = 2 * 60 * 1000;

export function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission === "denied") return;
  const n = new Notification(title, { body, silent: false });
  n.onclick = () => window.focus();
}

/**
 * DesktopBehaviors carries out the Settings that act outside the window:
 * keeping the computer awake while syncing, and notifying the user when
 * a long sync finishes, the node stops itself to protect its database
 * from a full disk, a wallet account receives LAX, or one of its sends is
 * confirmed or fails. Those always go to the app's own notifications (the
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

  // The wallet's transactions in each new block, from the block the watch
  // started at: while syncing it waits, so a catch-up isn't announced as news
  const { info } = useWallet();
  const accounts = useRef(info?.accounts ?? []);
  accounts.current = info?.accounts ?? [];
  // The other side by its contact name when it has one
  const { byAddress } = useContacts();
  const contactName = useRef(byAddress);
  contactName.current = byAddress;
  const seen = useRef<number | null>(null);
  const reading = useRef(false);
  const watching = !!node?.running && !node.syncing && !!info?.hasPassword && (info?.accounts.length ?? 0) > 0;
  const head = node?.currentBlock ?? 0;
  useEffect(() => {
    if (!watching) {
      seen.current = null;
      return;
    }
    if (seen.current === null) {
      seen.current = head;
      return;
    }
    if (head <= seen.current || reading.current) return;
    reading.current = true;
    api
      .walletActivitySince(seen.current)
      .then(({ transactions, head: readTo }) => {
        seen.current = Math.max(seen.current ?? 0, readTo);
        const mine = accounts.current;
        const find = (a: string) => mine.find((x) => sameAddress(x.address, a));
        for (const tx of transactions) {
          const from = find(tx.from);
          const to = tx.to ? find(tx.to) : undefined;
          const amount = `${formatLax(tx.valueWei, 6)} LAX`;
          const block = formatInt(tx.block);
          let kind: "received" | "sent" | "failed", title: string, body: string;
          if (from) {
            const account = accountLabel(from, mine, t);
            const dest = to
              ? accountLabel(to, mine, t)
              : tx.to
                ? (contactName.current(tx.to)?.name ?? shortHex(tx.to, 8, 6))
                : t("mempool.creation");
            kind = tx.failed ? "failed" : "sent";
            title = t(tx.failed ? "notify.txFailed" : "notify.sent", { amount });
            body = t("notify.sent.body", { account, to: dest, block });
          } else if (to) {
            kind = "received";
            title = t("notify.received", { amount });
            const sender = contactName.current(tx.from)?.name ?? shortHex(tx.from, 8, 6);
            body = t("notify.received.body", { account: accountLabel(to, mine, t), from: sender, block });
          } else continue;
          push(kind, title, body);
          if (on.current) notify(title, body);
        }
      })
      .catch(() => {})
      .finally(() => {
        reading.current = false;
      });
  }, [watching, head, t, push]);

  return null;
}
