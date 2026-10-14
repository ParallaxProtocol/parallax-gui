import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Check, FileKey2, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, walletError, WalletAccount } from "../../lib/api";
import { shortHex } from "../../lib/format";
import { STAGGER, useStagger } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Panel, Section } from "../../components/ui/Panel";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { BackupDrawer, PasswordDrawer, RemoveDrawer } from "./AccountForms";

type Action = "backup" | "password" | "remove";

/**
 * AccountsPage manages the wallet's accounts: which one the app shows,
 * their names, backups and passwords, adding and removing them, and where
 * the encrypted keys are kept on this computer.
 */
export default function AccountsPage() {
  const t = useT();
  const stagger = useStagger();
  const wallet = useWallet();
  const [action, setAction] = useState<{ kind: Action; account: WalletAccount } | null>(null);

  const info = wallet.info;
  if (!info) return null;
  const label = (a: WalletAccount) => accountLabel(a, info.accounts, t);
  const close = () => setAction(null);
  const target = action?.account ?? null;

  return (
    <div className="flex max-w-4xl flex-col gap-6 p-5">
      <Section
        title={t("wallet.accounts.title")}
        aside={
          <>
            <Link to="/accounts/import" className="btn btn-secondary btn-sm">
              <KeyRound className="size-3.5" />
              {t("wallet.accounts.import")}
            </Link>
            <Link to="/accounts/new" className="btn btn-primary btn-sm">
              <Plus className="size-3.5" />
              {t("wallet.accounts.create")}
            </Link>
          </>
        }
      >
        <Panel className="overflow-hidden">
          {info.accounts.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">{t("wallet.accounts.empty")}</p>
          ) : (
            <motion.ul {...stagger} className="divide-y divide-border">
              {info.accounts.map((a) => (
                <motion.li variants={STAGGER.item} key={a.address}>
                  <AccountRow
                    account={a}
                    label={label(a)}
                    selected={a.address === wallet.account?.address}
                    onSelect={() => wallet.select(a.address)}
                    onAction={(kind) => setAction({ kind, account: a })}
                  />
                </motion.li>
              ))}
            </motion.ul>
          )}
        </Panel>
      </Section>

      <Section title={t("wallet.accounts.storage")}>
        <Panel className="flex flex-col gap-2 p-4">
          <p className="text-muted-foreground">{t("wallet.accounts.storageDesc")}</p>
          <div className="flex items-center gap-1">
            <code className="selectable min-w-0 truncate font-mono text-sm">{info.keystoreDir}</code>
            <CopyButton value={info.keystoreDir} />
          </div>
        </Panel>
      </Section>

      <BackupDrawer open={action?.kind === "backup"} onClose={close} account={target} label={target ? label(target) : ""} />
      <PasswordDrawer open={action?.kind === "password"} onClose={close} account={target} label={target ? label(target) : ""} />
      <RemoveDrawer open={action?.kind === "remove"} onClose={close} account={target} label={target ? label(target) : ""} />
    </div>
  );
}

function AccountRow({
  account,
  label,
  selected,
  onSelect,
  onAction,
}: {
  account: WalletAccount;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onAction: (a: Action) => void;
}) {
  const t = useT();
  const wallet = useWallet();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [error, setError] = useState<string | null>(null);

  const rename = async () => {
    try {
      await api.walletRename(account.address, name);
      setEditing(false);
      setError(null);
      await wallet.refresh();
    } catch (e) {
      setError(walletError(e, t));
    }
  };

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <input
          type="radio"
          name="selected-account"
          checked={selected}
          onChange={onSelect}
          aria-label={t("wallet.accounts.show", { name: label })}
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                rename();
              }}
            >
              <input
                className="input h-7 max-w-64"
                value={name}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
                placeholder={label}
                autoFocus
                aria-label={t("wallet.name")}
              />
              <button type="submit" className="btn btn-ghost btn-sm btn-icon" aria-label={t("common.save")}>
                <Check className="size-3.5" />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={t("common.cancel")}
                onClick={() => {
                  setName(account.name);
                  setEditing(false);
                }}
              >
                <X className="size-3.5" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{label}</span>
              {!account.backedUp && <span className="text-sm text-warn-ink">{t("wallet.accounts.noBackup")}</span>}
              <Tooltip content={t("wallet.accounts.rename")}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => setEditing(true)}
                  aria-label={t("wallet.accounts.rename")}
                >
                  <Pencil className="size-3" />
                </button>
              </Tooltip>
            </div>
          )}
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Tooltip content={account.address} mono>
              <span className="font-mono">{shortHex(account.address, 12, 10)}</span>
            </Tooltip>
            <CopyButton value={account.address} className="-my-1" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAction("backup")}>
            <FileKey2 className="size-3.5" />
            {t("wallet.backup.cta")}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAction("password")}>
            {t("wallet.accounts.password")}
          </button>
          <Tooltip content={t("wallet.remove.title")}>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon text-critical-ink"
              onClick={() => onAction("remove")}
              aria-label={t("wallet.remove.title")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </div>
  );
}
