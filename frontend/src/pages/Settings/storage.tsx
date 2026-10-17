import { useEffect, useState, type ReactNode } from "react";
import { FolderInput as FolderInputIcon, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { api, CONFIG_UPDATED_EVENT, onEvent, pickFolder, type StorageProgress } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { CopyButton, Meter, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { Panel, Rows } from "../../components/ui/Panel";
import { IconTile, TILE } from "../../components/ui/IconTile";
import { Field, WalletPasswordPrompt } from "../Wallet/common";
import { useBusy } from "../Wallet/accountActions";
import { Advanced, Setting } from "./fields";

/**
 * WalletStorage is the wallet's part of Settings' Storage: the folder its
 * encrypted keys are kept in on this computer and, folded under Advanced,
 * moving them to another folder. Wiping the wallet is a group of its own
 * (WipeWallet).
 */
export function WalletStorage() {
  const t = useT();
  const { info } = useWallet();
  const [moveTo, setMoveTo] = useState<string | null>(null);
  if (!info) return null;

  // The wallet's folder: the keystore's
  const folder = info.keystoreDir.replace(/[\\/][^\\/]*[\\/]?$/, "");
  const choose = async () => {
    const dir = await pickFolder(t("storage.wallet.pick"), folder);
    if (dir) setMoveTo(dir);
  };

  return (
    <>
      <Rows>
        {/* Shown, not chosen: the wallet moves with its files (Move wallet, below) */}
        <Setting title={t("storage.wallet.folder")} desc={t("wallet.accounts.storageDesc")}>
          <div className="flex w-72 items-center gap-1 rounded-xl bg-muted py-1 pr-1 pl-3">
            <Tooltip content={folder} mono>
              {/* A long path keeps its end, the folder's own name, in view */}
              <code className="selectable min-w-0 flex-1 truncate font-mono text-sm [direction:rtl]">
                <bdi>{folder}</bdi>
              </code>
            </Tooltip>
            <CopyButton value={folder} />
          </div>
        </Setting>
        <Advanced id="walletStorage" changed={0}>
          <Setting title={t("storage.wallet.move")} desc={t("storage.wallet.moveDesc")}>
            <button type="button" className="btn btn-tinted btn-sm" onClick={choose}>
              {t("storage.move.cta")}
            </button>
          </Setting>
        </Advanced>
      </Rows>
      <MoveModal
        store="wallet"
        to={moveTo}
        onClose={() => setMoveTo(null)}
        title={t("storage.wallet.moveTitle")}
        body={t("storage.wallet.moveConfirm")}
        busyLabel={t("storage.wallet.moving")}
        submit={t("storage.wallet.moveSubmit")}
        // The app restarts onto the copy: nothing more to do here
        move={async (dir) => {
          await api.walletMove(dir);
          return "restart";
        }}
      />
    </>
  );
}

/**
 * WipeWallet is Settings' Storage's last group, apart from the rest as
 * what can't be undone: wiping the whole wallet. Only a wallet with a
 * password has anything to wipe.
 */
export function WipeWallet() {
  const t = useT();
  const [wiping, setWiping] = useState(false);
  return (
    <>
      {/* Set apart as System Settings sets apart what erases: the panel's edge
          in the destructive colour, the row marked by a red symbol, its name
          and its button in red, and a footnote under the group */}
      <Panel tone="critical">
        <div className="flex min-h-14 items-center gap-3.5 px-4 py-3">
          <IconTile icon={TriangleAlert} color={TILE.red} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium text-critical-ink">{t("storage.wallet.delete")}</span>
            <span className="text-sm text-muted-foreground">{t("storage.wallet.deleteDesc")}</span>
          </div>
          <button type="button" className="btn btn-danger btn-sm shrink-0" onClick={() => setWiping(true)}>
            {t("storage.wallet.wipeCta")}
          </button>
        </div>
      </Panel>
      <p className="px-1 text-sm text-muted-foreground">{t("storage.danger.note")}</p>
      <WipeModal open={wiping} onClose={() => setWiping(false)} />
    </>
  );
}

/**
 * NodeStorageActions are the node's data's rows of Settings' Storage,
 * under its Advanced: moving the data to another folder or drive, and
 * deleting the chain for a fresh sync.
 */
export function NodeStorageActions({ dataDir }: { dataDir: string }) {
  const t = useT();
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const choose = async () => {
    const dir = await pickFolder(t("storage.node.pick"), dataDir);
    if (dir) setMoveTo(dir);
  };

  return (
    <>
      <Setting title={t("storage.node.move")} desc={t("storage.node.moveDesc")}>
        <button type="button" className="btn btn-tinted btn-sm" onClick={choose}>
          {t("storage.move.cta")}
        </button>
      </Setting>
      <Setting title={t("storage.node.clear")} desc={t("storage.node.clearDesc")}>
        <button type="button" className="btn btn-tinted btn-sm text-critical-ink" onClick={() => setClearing(true)}>
          {t("storage.delete.cta")}
        </button>
      </Setting>
      <MoveModal
        store="node"
        to={moveTo}
        onClose={() => setMoveTo(null)}
        title={t("storage.node.moveTitle")}
        body={t("storage.node.moveConfirm")}
        busyLabel={t("storage.node.moving")}
        submit={t("storage.node.moveSubmit")}
        move={async (dir) => {
          await api.nodeMoveData(dir);
          // The data folder shows where it went
          window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
          return "done";
        }}
      />
      <ClearChainModal open={clearing} onClose={() => setClearing(false)} />
    </>
  );
}

/**
 * MoveModal confirms moving a store to the folder picked, then shows the
 * copy's progress: it can't be closed until the move is done.
 */
function MoveModal({
  store,
  to,
  onClose,
  title,
  body,
  busyLabel,
  submit,
  move,
}: {
  store: StorageProgress["store"];
  to: string | null;
  onClose: () => void;
  title: string;
  body: string;
  busyLabel: string;
  submit: string;
  move: (dir: string) => Promise<"done" | "restart">;
}) {
  const t = useT();
  const { busy, error, setError, run } = useBusy();
  const [progress, setProgress] = useState<StorageProgress | null>(null);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    if (!busy) return;
    return onEvent<StorageProgress>("storage-progress", (p) => p.store === store && setProgress(p));
  }, [busy, store]);
  useEffect(() => {
    if (to) {
      setError(null);
      setProgress(null);
    }
  }, [to, setError]);

  const held = busy || restarting;
  const go = async () => {
    if (!to || held) return;
    const result = await run(() => move(to));
    if (result === "restart") setRestarting(true);
    else if (result === "done") onClose();
  };

  return (
    <Modal open={!!to} onClose={held ? () => {} : onClose} title={title} icon={<FolderInputIcon className="size-4" />}>
      <ModalForm
        onSubmit={go}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={held}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={held}>
              {held && <Loader2 className="size-3.5 animate-spin" />}
              {submit}
            </button>
          </>
        }
      >
        <p>{body}</p>
        <Destination path={to ?? ""} />
        {held ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{restarting ? t("storage.wallet.restarting") : busyLabel}</span>
              {progress && progress.total > 0 && !restarting && (
                <span className="text-muted-foreground tabular-nums">
                  {t("storage.progress", { done: formatBytes(progress.done), total: formatBytes(progress.total) })}
                </span>
              )}
            </div>
            <Meter
              value={restarting ? 1 : progress && progress.total > 0 ? progress.done / progress.total : undefined}
              live
              label={busyLabel}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("storage.moveHint")}</p>
        )}
        {error && <Notice tone="critical">{error}</Notice>}
      </ModalForm>
    </Modal>
  );
}

/** Destination is the folder a store goes to, as the folder row shows one. */
function Destination({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-muted py-2 pr-1 pl-3">
      <code className="selectable min-w-0 flex-1 truncate font-mono text-sm">{path}</code>
    </div>
  );
}

/** ClearChainModal confirms deleting the node's chain, for a sync from scratch. */
function ClearChainModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { busy, error, setError, run } = useBusy();
  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);
  const clear = async () => {
    if (busy) return;
    const ok = await run(async () => {
      await api.nodeClearChainData();
      return true;
    });
    if (ok) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={t("storage.node.clearTitle")}
      icon={<Trash2 className="size-4" />}
      tone="danger"
    >
      <ModalForm
        busy={busy}
        onSubmit={clear}
        footer={<DangerFooter busy={busy} onClose={onClose} label={t("storage.node.clearSubmit")} />}
      >
        <p className="text-critical-ink">{t("storage.node.clearWarn")}</p>
        {error && <Notice tone="critical">{error}</Notice>}
      </ModalForm>
    </Modal>
  );
}

/**
 * WipeModal confirms wiping the whole wallet: the word typed, then the
 * wallet password. The app then restarts (app.go), as on a first launch,
 * to set a new password; the dialog stays until it does.
 */
function WipeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [restarting, setRestarting] = useState(false);
  return (
    <Modal
      open={open}
      onClose={restarting ? () => {} : onClose}
      title={t("storage.wallet.deleteTitle")}
      icon={<Trash2 className="size-4" />}
      tone="danger"
    >
      {open && <Wipe onClose={onClose} restarting={restarting} onWiped={() => setRestarting(true)} />}
    </Modal>
  );
}
function Wipe({ onClose, restarting, onWiped }: { onClose: () => void; restarting: boolean; onWiped: () => void }) {
  const t = useT();
  const [word, setWord] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useBusy();
  useEffect(() => () => setPassword(""), []);
  const confirmWord = t("storage.wallet.deleteWord");
  const typed = word.trim().toLocaleUpperCase() === confirmWord.toLocaleUpperCase();
  const held = busy || restarting;

  const wipe = async () => {
    if (held || !typed || !password) return;
    const ok = await run(async () => {
      await api.walletWipe(password);
      return true;
    });
    if (ok) {
      setPassword("");
      onWiped();
    }
  };

  return (
    <ModalForm
      busy={held}
      busyLabel={restarting ? t("storage.wallet.restarting") : undefined}
      onSubmit={wipe}
      footer={
        <DangerFooter
          busy={held}
          onClose={onClose}
          label={restarting ? t("storage.wallet.restarting") : t("storage.wallet.deleteSubmit")}
          disabled={!typed || !password}
        />
      }
    >
      <p className="text-critical-ink">{t("storage.wallet.deleteWarn")}</p>
      <p className="text-sm text-muted-foreground">{t("storage.wallet.deleteList")}</p>
      <p className="text-sm text-muted-foreground">{t("storage.wallet.deleteAfter")}</p>
      <Field label={t("storage.wallet.deleteType", { word: confirmWord })}>
        {(id) => (
          <input
            id={id}
            className="input"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={confirmWord}
            disabled={held}
          />
        )}
      </Field>
      {/* The password opens once the word is typed, as removing an account's does once it's acknowledged */}
      <WalletPasswordPrompt value={password} onChange={setPassword} locked={!typed || held} />
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}

function DangerFooter({
  busy,
  onClose,
  label,
  disabled,
}: {
  busy: boolean;
  onClose: () => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
        {t("common.cancel")}
      </button>
      <button type="submit" className="btn btn-danger" disabled={busy || disabled}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        {label}
      </button>
    </>
  );
}
