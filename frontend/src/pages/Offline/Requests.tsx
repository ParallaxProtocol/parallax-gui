import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Ban, Loader2, QrCode, ScanLine, Trash2 } from "lucide-react";
import { api, PendingRequest, SigningRequest, walletError } from "../../lib/api";
import { formatInt, formatLax, sameAddress, shortHex } from "../../lib/format";
import { useNode } from "../../lib/live";
import { STAGGER, useStagger } from "../../lib/motion";
import { useContacts } from "../../lib/contacts";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Panel, Section } from "../../components/ui/Panel";
import { Pill } from "../../components/ui/Pill";
import { Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { DocBody, Fingerprint } from "../../components/offline/parts";
import { docFileName } from "../../lib/offline";

const TONE = { waiting: "info", broadcast: "brand", replaced: "neutral", stale: "warn" } as const;

/**
 * PendingRequests lists the signing requests the wallet follows for its
 * watch-only accounts, until each transaction is in a block: to show one
 * again, scan back its signature, cancel it with a replacement for its
 * nonce, or let it go. It shows nothing while there are none.
 */
export function PendingRequests() {
  const t = useT();
  const stagger = useStagger();
  const navigate = useNavigate();
  const node = useNode();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const [list, setList] = useState<PendingRequest[]>([]);
  const [shown, setShown] = useState<SigningRequest | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "replace" | "discard"; req: PendingRequest } | null>(null);
  const [tick, setTick] = useState(0);
  const head = node?.currentBlock ?? 0;
  const watching = !!info?.accounts.some((a) => a.watchOnly);

  useEffect(() => {
    if (!watching) return;
    let alive = true;
    api
      .offlinePendingRequests()
      .then((l) => alive && setList(l ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [watching, head, tick]);

  if (!watching || list.length === 0) return null;
  const accounts = info?.accounts ?? [];
  const name = (a: string) => {
    const own = accounts.find((x) => sameAddress(x.address, a));
    return own ? accountLabel(own, accounts, t) : (byAddress(a)?.name ?? shortHex(a, 8, 6));
  };
  // A request with a later one from its account behind it holds that one up
  const blocksLater = (r: PendingRequest) =>
    list.some((o) => o.tx.from === r.tx.from && o.tx.nonce > r.tx.nonce && o.status !== "stale");

  return (
    <Section title={t("offline.pending.title")} count={list.length}>
      <Panel className="overflow-hidden">
        <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
          {list.map((r) => (
            <motion.li variants={STAGGER.item} key={r.tx.id} className="flex items-center gap-3.5 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  <span className="truncate">
                    {r.tx.to === r.tx.from && r.tx.valueWei === "0"
                      ? t("offline.pending.cancel")
                      : t("offline.pending.to", { name: name(r.tx.to) })}
                  </span>
                  <Pill tone={TONE[r.status]}>{t(`offline.pending.status.${r.status}`)}</Pill>
                </div>
                <div className="flex items-center gap-2 truncate text-sm text-muted-foreground tabular-nums">
                  <span>{name(r.tx.from)}</span>·<span>{t("offline.pending.nonce", { n: formatInt(r.tx.nonce) })}</span>
                  ·
                  <Fingerprint value={r.tx.fingerprint} />
                  {r.tx.memo && <span className="truncate">· {r.tx.memo}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right font-semibold tabular-nums">
                {formatLax(r.tx.valueWei, 6)} <span className="font-normal text-muted-foreground">LAX</span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {r.status === "waiting" && (
                  <>
                    <Tooltip content={t("offline.pending.show")}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon text-muted-foreground"
                        aria-label={t("offline.pending.show")}
                        onClick={() => setShown({ doc: r.doc, tx: r.tx })}
                      >
                        <QrCode className="size-4" />
                      </button>
                    </Tooltip>
                    <Tooltip content={t("offline.send.scanSigned")}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon text-muted-foreground"
                        aria-label={t("offline.send.scanSigned")}
                        onClick={() => navigate("/broadcast")}
                      >
                        <ScanLine className="size-4" />
                      </button>
                    </Tooltip>
                  </>
                )}
                {(r.status === "waiting" || r.status === "broadcast") && (
                  <Tooltip content={t("offline.pending.replace")}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon text-muted-foreground"
                      aria-label={t("offline.pending.replace")}
                      onClick={() => setConfirm({ kind: "replace", req: r })}
                    >
                      <Ban className="size-4" />
                    </button>
                  </Tooltip>
                )}
                {r.status !== "broadcast" && (
                  <Tooltip content={t("offline.pending.discard")}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon text-muted-foreground hover:text-critical-ink"
                      aria-label={t("offline.pending.discard")}
                      onClick={() => setConfirm({ kind: "discard", req: r })}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </Tooltip>
                )}
              </div>
            </motion.li>
          ))}
        </motion.ul>
      </Panel>

      <Modal
        open={!!shown}
        onClose={() => setShown(null)}
        title={t("offline.send.requestTitle")}
        subtitle={shown ? t("offline.pending.nonce", { n: formatInt(shown.tx.nonce) }) : undefined}
        icon={<QrCode className="size-4" />}
      >
        {shown && (
          <div className="flex flex-col gap-4 px-5 pb-5">
            <p className="text-sm text-muted-foreground">{t("offline.send.requestDesc")}</p>
            <DocBody
              doc={shown.doc}
              fingerprint={shown.tx.fingerprint}
              fileName={docFileName("request", shown.tx.nonce, shown.tx.fingerprint)}
              qrClassName="size-72"
            />
          </div>
        )}
      </Modal>
      <ConfirmModal
        confirm={confirm}
        blocksLater={confirm ? blocksLater(confirm.req) : false}
        onClose={() => setConfirm(null)}
        onReplaced={(req) => {
          setConfirm(null);
          setShown(req);
          setTick((n) => n + 1);
        }}
        onDiscarded={() => {
          setConfirm(null);
          setTick((n) => n + 1);
        }}
      />
    </Section>
  );
}

function ConfirmModal({
  confirm,
  blocksLater,
  onClose,
  onReplaced,
  onDiscarded,
}: {
  confirm: { kind: "replace" | "discard"; req: PendingRequest } | null;
  blocksLater: boolean;
  onClose: () => void;
  onReplaced: (r: SigningRequest) => void;
  onDiscarded: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [confirm]);
  const replace = confirm?.kind === "replace";

  const go = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (replace) onReplaced(await api.offlineReplaceRequest(confirm.req.tx.id));
      else {
        await api.offlineDiscardRequest(confirm.req.tx.id);
        onDiscarded();
      }
    } catch (e) {
      setError(walletError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!confirm}
      onClose={onClose}
      title={replace ? t("offline.pending.replaceTitle") : t("offline.pending.discardTitle")}
      subtitle={confirm ? t("offline.pending.nonce", { n: formatInt(confirm.req.tx.nonce) }) : undefined}
      icon={replace ? <Ban className="size-4" /> : <Trash2 className="size-4" />}
      tone={replace ? "default" : "danger"}
    >
      {confirm && (
        <ModalForm
          busy={busy}
          onSubmit={go}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className={`btn ${replace ? "btn-primary" : "btn-danger"}`}
                disabled={busy}
                autoFocus
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {replace ? t("offline.pending.replaceCta") : t("offline.pending.discardCta")}
              </button>
            </>
          }
        >
          <p className="text-muted-foreground">
            {replace ? t("offline.pending.replaceDesc") : t("offline.pending.discardDesc")}
          </p>
          {!replace && blocksLater && <Notice tone="warn">{t("offline.pending.discardBlocks")}</Notice>}
          {error && <Notice tone="critical">{error}</Notice>}
        </ModalForm>
      )}
    </Modal>
  );
}
