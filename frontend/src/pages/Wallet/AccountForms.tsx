import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { api, saveBackup, walletError, WalletAccount } from "../../lib/api";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Drawer } from "../../components/ui/Drawer";
import { Notice } from "../../components/ui/bits";
import { Address, Field, NewPassword, PasswordInput } from "./common";

/**
 * The quick actions on one account, each in a drawer over the page it is
 * taken from: saving its backup, changing its password, removing it. The
 * form pieces are shared with the add-account pages (AddAccount.tsx).
 * Passwords stay in the form's own state, sent to the backend for the one
 * action they are typed for, and are gone when the form closes.
 */

type DrawerProps = { open: boolean; onClose: () => void };

/** Form is a drawer's body: its fields, an error, and the actions at its foot. */
export function Form({
  onSubmit,
  error,
  actions,
  children,
}: {
  onSubmit: () => void;
  error: string | null;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      {error && <Notice tone="critical">{error}</Notice>}
      <div className="flex justify-end gap-2 pt-1">{actions}</div>
    </form>
  );
}

export function Submit({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
      {busy && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

/** useBusy runs one action at a time, keeping its error in the user's language. */
export function useBusy() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(walletError(e, t));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/**
 * backUp saves an account's keystore file where the user picks, once the
 * password opens it, and records it as backed up. False if they cancelled.
 */
export async function backUp(address: string, password: string): Promise<boolean> {
  const b = await api.walletBackup(address, password);
  const saved = await saveBackup(b.fileName, b.keyfile);
  if (saved) await api.walletMarkBackedUp(address);
  return saved;
}

/** BackupSaved is the line saying a backup was saved, and what keeps it safe. */
export function BackupSaved() {
  const t = useT();
  return (
    <Notice tone="info" title={t("wallet.backup.saved")}>
      {t("wallet.backup.savedDesc")}
    </Notice>
  );
}

export function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <Field label={t("wallet.name")} hint={t("wallet.name.hint")}>
      {(id) => (
        <input
          id={id}
          className="input"
          value={value}
          maxLength={64}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("wallet.name.placeholder")}
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

type AccountDrawerProps = DrawerProps & { account: WalletAccount | null; label: string };

export function BackupDrawer({ open, onClose, account, label }: AccountDrawerProps) {
  const t = useT();
  return (
    <Drawer open={open} onClose={onClose} title={t("wallet.backup.title")} meta={label}>
      {open && account && <Backup account={account} onClose={onClose} />}
    </Drawer>
  );
}

function Backup({ account, onClose }: { account: WalletAccount; onClose: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useBusy();
  useEffect(() => () => setPassword(""), []);

  return (
    <Form
      onSubmit={async () => {
        const ok = await run(() => backUp(account.address, password));
        if (ok) {
          setPassword("");
          setSaved(true);
          await wallet.refresh();
        }
      }}
      error={error}
      actions={
        saved ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("common.done")}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <Submit busy={busy} disabled={!password}>
              {t("wallet.backup.cta")}
            </Submit>
          </>
        )
      }
    >
      <p className="text-muted-foreground">{t("wallet.backup.desc")}</p>
      {saved ? (
        <BackupSaved />
      ) : (
        <Field label={t("wallet.password")} hint={t("wallet.backup.passwordHint")}>
          {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoFocus />}
        </Field>
      )}
    </Form>
  );
}

export function PasswordDrawer({ open, onClose, account, label }: AccountDrawerProps) {
  const t = useT();
  return (
    <Drawer open={open} onClose={onClose} title={t("wallet.changePassword.title")} meta={label}>
      {open && account && <ChangePassword account={account} onClose={onClose} />}
    </Drawer>
  );
}

function ChangePassword({ account, onClose }: { account: WalletAccount; onClose: () => void }) {
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

  return (
    <Form
      onSubmit={async () => {
        const ok = await run(async () => {
          await api.walletChangePassword(account.address, current, next);
          return true;
        });
        if (ok) {
          await wallet.refresh();
          onClose();
        }
      }}
      error={error}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <Submit busy={busy} disabled={!current || !next}>
            {t("wallet.changePassword.cta")}
          </Submit>
        </>
      }
    >
      <p className="text-muted-foreground">{t("wallet.changePassword.desc")}</p>
      <Field label={t("wallet.password.current")}>
        {(id) => <PasswordInput id={id} value={current} onChange={setCurrent} autoFocus />}
      </Field>
      <NewPassword onChange={setNext} />
      {account.backedUp && <Notice tone="info">{t("wallet.changePassword.oldBackups")}</Notice>}
    </Form>
  );
}

export function RemoveDrawer({ open, onClose, account, label }: AccountDrawerProps) {
  const t = useT();
  return (
    <Drawer open={open} onClose={onClose} title={t("wallet.remove.title")} meta={label}>
      {open && account && <Remove account={account} onClose={onClose} />}
    </Drawer>
  );
}

function Remove({ account, onClose }: { account: WalletAccount; onClose: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const { busy, error, run } = useBusy();
  useEffect(() => () => setPassword(""), []);

  return (
    <Form
      onSubmit={async () => {
        const ok = await run(async () => {
          await api.walletRemove(account.address, password);
          return true;
        });
        if (ok) {
          await wallet.refresh();
          onClose();
        }
      }}
      error={error}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !password || !understood}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("wallet.remove.cta")}
          </button>
        </>
      }
    >
      <Notice tone="critical" title={t("wallet.remove.warnTitle")}>
        {account.backedUp ? t("wallet.remove.warn") : t("wallet.remove.warnNoBackup")}
      </Notice>
      <Address value={account.address} className="text-sm" />
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        {t("wallet.remove.confirm")}
      </label>
      <Field label={t("wallet.password")}>
        {(id) => <PasswordInput id={id} value={password} onChange={setPassword} />}
      </Field>
    </Form>
  );
}
