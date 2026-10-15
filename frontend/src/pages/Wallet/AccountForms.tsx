import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileKey2, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { SPRING } from "../../lib/motion";
import { api, SeedInfo, WalletAccount } from "../../lib/api";
import { backUp, useBusy, useDefaultName } from "./accountActions";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/bits";
import { Address, Checkbox, DrawnCheck, Field, NewPassword, PasswordInput } from "./common";
import { AddressAvatar } from "../../components/ui/AddressAvatar";

/**
 * The actions on one account, each a dialog over the page it is taken
 * from: saving its backup, changing its password, removing it. Some pieces
 * are shared with the add-account pages (AddAccount.tsx).
 * Passwords stay in the form's own state, sent to the backend for the one
 * action they are typed for, and are gone when the form closes.
 */

export function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const defaultName = useDefaultName();
  return (
    <Field label={t("wallet.name")} hint={t("wallet.name.hint")}>
      {(id) => (
        <input
          id={id}
          className="input"
          value={value}
          maxLength={64}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultName}
          spellCheck={false}
          autoFocus
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Backup, password, removal: one account at a time
// ---------------------------------------------------------------------------

type AccountModalProps = { open: boolean; onClose: () => void; account: WalletAccount | null; label: string };

/** BackupModal saves an account's keystore file, encrypted with the wallet password. */
export function BackupModal({ open, onClose, account, label }: AccountModalProps) {
  const t = useT();
  return (
    <Modal
      open={open && !!account}
      onClose={onClose}
      title={t("wallet.backup.title")}
      subtitle={label}
      icon={<FileKey2 className="size-4" />}
    >
      {account && <Backup account={account} onClose={onClose} />}
    </Modal>
  );
}

function Backup({ account, onClose }: { account: WalletAccount; onClose: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useBusy();

  return (
    <ModalForm
      onSubmit={async () => {
        if (busy || saved) return;
        const ok = await run(() => backUp(account.address));
        if (ok) {
          setSaved(true);
          await wallet.refresh();
        }
      }}
      footer={
        saved ? (
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            {t("common.done")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy} autoFocus>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileKey2 className="size-3.5" />}
              {t("wallet.backup.cta")}
            </button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {saved ? (
          <motion.div
            key="saved"
            className="flex flex-col items-center gap-3 py-3 text-center"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING}
          >
            <DrawnCheck />
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold">{t("wallet.backup.saved")}</span>
              <span className="max-w-xs text-muted-foreground">{t("wallet.created.savedDesc")}</span>
            </div>
          </motion.div>
        ) : (
          <motion.div key="form" className="flex flex-col gap-4" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <div className="flex flex-col gap-2 leading-relaxed">
              <p>{t("wallet.backup.what")}</p>
              <p className="text-muted-foreground">
                {rich(t("wallet.backup.restore"), {
                  file: <strong className="font-medium text-foreground">{t("wallet.backup.restore.file")}</strong>,
                  password: (
                    <strong className="font-medium text-foreground">{t("wallet.backup.restore.password")}</strong>
                  ),
                })}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}

/**
 * PasswordModal changes the wallet password: every key and every recovery
 * phrase is encrypted again under the new one, which takes a few seconds a
 * key.
 */
export function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("wallet.changePassword.title")}
      icon={<KeyRound className="size-4" />}
    >
      <ChangePassword onClose={onClose} />
    </Modal>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const { busy, error, run } = useBusy();
  useEffect(
    () => () => {
      setCurrent("");
      setNext("");
    },
    [],
  );
  const keys = wallet.info?.accounts.length ?? 0;
  const anyBackup = wallet.info?.accounts.some((a) => a.backedUp && !a.fromSeed) ?? false;

  return (
    <ModalForm
      onSubmit={async () => {
        if (busy || !current || !next) return;
        const ok = await run(async () => {
          await api.walletChangePassword(current, next);
          return true;
        });
        if (ok) {
          await wallet.refresh();
          onClose();
        }
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !current || !next}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? t("wallet.changePassword.busy") : t("wallet.changePassword.cta")}
          </button>
        </>
      }
    >
      <p className="text-muted-foreground">{t("wallet.changePassword.desc", { n: keys })}</p>
      <Field label={t("wallet.password.current")}>
        {(id) => <PasswordInput id={id} value={current} onChange={setCurrent} />}
      </Field>
      <NewPassword onChange={setNext} />
      {anyBackup && <Notice tone="info">{t("wallet.changePassword.oldBackups")}</Notice>}
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}

/**
 * RemoveModal asks to delete an account's key for good. It takes the
 * password, and an explicit acknowledgement that the key is going.
 */
export function RemoveModal({ open, onClose, account, label }: AccountModalProps) {
  const t = useT();
  return (
    <Modal
      open={open && !!account}
      onClose={onClose}
      title={t("wallet.remove.title")}
      icon={<Trash2 className="size-4" />}
      tone="danger"
    >
      {account && <Remove account={account} label={label} onClose={onClose} />}
    </Modal>
  );
}
function Remove({ account, label, onClose }: { account: WalletAccount; label: string; onClose: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const { busy, error, run } = useBusy();
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => setPassword(""), []);

  // The password unlocks only once the consequence is acknowledged, and
  // locks (and empties) again if the acknowledgement is taken back
  const acknowledge = (on: boolean) => {
    setUnderstood(on);
    if (on) requestAnimationFrame(() => passwordInput.current?.focus());
    else setPassword("");
  };

  const remove = async () => {
    if (busy || !password || !understood) return;
    const ok = await run(async () => {
      await api.walletRemove(account.address, password);
      return true;
    });
    if (ok) {
      await wallet.refresh();
      onClose();
    }
  };

  return (
    <ModalForm
      onSubmit={remove}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !password || !understood}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {t("wallet.remove.cta")}
          </button>
        </>
      }
    >
      <p className="text-critical-ink">
        {account.backedUp ? t("wallet.remove.warn") : t("wallet.remove.warnNoBackup")}
      </p>
      <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
        <AddressAvatar address={account.address} size={30} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{label}</span>
          <Address value={account.address} className="text-sm" />
        </div>
      </div>
      <Checkbox checked={understood} onChange={acknowledge}>
        {t("wallet.remove.confirm")}
      </Checkbox>
      <div className={`transition-opacity duration-200 ${understood ? "" : "opacity-50"}`}>
        <Field label={t("wallet.walletPassword")}>
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              disabled={!understood}
              inputRef={passwordInput}
            />
          )}
        </Field>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}

/**
 * rich fills a translated sentence's {name} slots with elements, so a word
 * can be emphasised wherever the language puts it.
 */
function rich(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name && name in parts ? <Fragment key={i}>{parts[name]}</Fragment> : piece;
  });
}

/** DeriveModal makes another account from one recovery phrase, named Account N (renamable in the list), with the wallet password. */
export function DeriveModal({ open, onClose, seed }: { open: boolean; onClose: () => void; seed: SeedInfo | null }) {
  const t = useT();
  return (
    <Modal
      open={open && !!seed}
      onClose={onClose}
      title={t("wallet.derive.title")}
      subtitle={seed?.name}
      icon={<Plus className="size-4" />}
    >
      {seed && <Derive seed={seed} onClose={onClose} />}
    </Modal>
  );
}

function Derive({ seed, onClose }: { seed: SeedInfo; onClose: () => void }) {
  const t = useT();
  const defaultName = useDefaultName();
  const wallet = useWallet();
  const { busy, error, run } = useBusy();
  return (
    <ModalForm
      onSubmit={async () => {
        if (busy) return;
        const acc = await run(() => api.walletDeriveAccount(seed.id, defaultName));
        if (acc) {
          await wallet.refresh();
          onClose();
        }
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} autoFocus>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("wallet.create.cta")}
          </button>
        </>
      }
    >
      <p className="text-muted-foreground">{t("wallet.derive.desc")}</p>
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}

/**
 * RemoveSeedModal deletes a recovery phrase and every account made from it,
 * once the consequence is acknowledged and the wallet password given.
 */
export function RemoveSeedModal({
  open,
  onClose,
  seed,
}: {
  open: boolean;
  onClose: () => void;
  seed: SeedInfo | null;
}) {
  const t = useT();
  return (
    <Modal
      open={open && !!seed}
      onClose={onClose}
      title={t("wallet.removeSeed.title")}
      subtitle={seed?.name}
      icon={<Trash2 className="size-4" />}
      tone="danger"
    >
      {seed && <RemoveSeed seed={seed} onClose={onClose} />}
    </Modal>
  );
}

function RemoveSeed({ seed, onClose }: { seed: SeedInfo; onClose: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const { busy, error, run } = useBusy();
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => setPassword(""), []);

  const acknowledge = (on: boolean) => {
    setUnderstood(on);
    if (on) requestAnimationFrame(() => passwordInput.current?.focus());
    else setPassword("");
  };

  return (
    <ModalForm
      onSubmit={async () => {
        if (busy || !password || !understood) return;
        const ok = await run(async () => {
          await api.walletRemoveSeed(seed.id, password);
          return true;
        });
        if (ok) {
          await wallet.refresh();
          onClose();
        }
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !password || !understood}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {t("wallet.removeSeed.cta")}
          </button>
        </>
      }
    >
      <p className="text-critical-ink">
        {seed.confirmed
          ? t("wallet.removeSeed.warn", { n: seed.accounts })
          : t("wallet.removeSeed.warnUnconfirmed", { n: seed.accounts })}
      </p>
      <Checkbox checked={understood} onChange={acknowledge}>
        {t("wallet.removeSeed.confirm")}
      </Checkbox>
      <div className={`transition-opacity duration-200 ${understood ? "" : "opacity-50"}`}>
        <Field label={t("wallet.walletPassword")}>
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={setPassword}
              disabled={!understood}
              inputRef={passwordInput}
            />
          )}
        </Field>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}
