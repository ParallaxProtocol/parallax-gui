import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Check, Eye, FileKey2, HardDrive, KeyRound, Lock, Pencil, Plus, ScrollText, Trash2, X } from "lucide-react";
import { api, SeedInfo, walletError, WalletAccount } from "../../lib/api";
import { shortHex } from "../../lib/format";
import { STAGGER, useStagger } from "../../lib/motion";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Panel, Section } from "../../components/ui/Panel";
import { IconBadge } from "../../components/ui/IconBadge";
import { Pill } from "../../components/ui/Pill";
import { RadioMark } from "../../components/ui/Choice";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { BackupModal, DeriveModal, PasswordModal, RemoveModal, RemoveSeedModal } from "./AccountForms";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { RevealPhraseModal } from "./Phrase";
import { useSettingsSheet } from "../../components/shell/SettingsSheet";
import { RemoveWatchOnlyModal } from "./WatchOnly";
import { useOfflineMode } from "../../lib/offline";

type Action = "backup" | "remove";
type SeedAction = "reveal" | "derive" | "remove";

/**
 * AccountsSettings is Settings' Accounts section, managing the wallet: its
 * accounts (which one the app shows, their names and backups, adding and
 * removing them), its recovery phrases, its password, and where the
 * encrypted keys are kept on this computer. Adding an account leaves
 * Settings for the page that does it.
 */
export function AccountsSettings() {
  const t = useT();
  const stagger = useStagger();
  const wallet = useWallet();
  const { setOpen } = useSettingsSheet();
  const offline = useOfflineMode();
  const [seedAction, setSeedAction] = useState<{ kind: SeedAction; seed: SeedInfo } | null>(null);
  const [changing, setChanging] = useState(false);
  const [action, setAction] = useState<{ kind: Action; account: WalletAccount } | null>(null);

  const info = wallet.info;
  if (!info) return null;
  const label = (a: WalletAccount) => accountLabel(a, info.accounts, t);
  const close = () => setAction(null);
  const target = action?.account ?? null;

  return (
    <div className="flex flex-col gap-7">
      {/* The accounts, then the ways to add one */}
      <section>
        <Panel className="overflow-hidden">
          {info.accounts.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">{t("wallet.accounts.empty")}</p>
          ) : (
            <motion.ul {...stagger} className="divide-y divide-border">
              {info.accounts.map((a) => (
                <motion.li variants={STAGGER.item} key={a.address}>
                  <AccountRow
                    account={a}
                    label={label(a)}
                    seedName={info.seeds.find((s) => s.id === a.seedId)?.name}
                    selected={a.address === wallet.account?.address}
                    onSelect={() => wallet.select(a.address)}
                    onAction={(kind) => setAction({ kind, account: a })}
                  />
                </motion.li>
              ))}
            </motion.ul>
          )}
          {/* Adding one, at the list's foot, as a settings list does */}
          <div className="flex flex-col divide-y divide-border border-t border-border">
            <AddRow to="/accounts/new" icon={Plus} label={t("wallet.accounts.create")} onGo={() => setOpen(false)} />
            <AddRow
              to="/accounts/import"
              icon={KeyRound}
              label={t("wallet.accounts.import")}
              onGo={() => setOpen(false)}
            />
            {/* An offline signer holds keys only; following one is for a wallet online */}
            {!offline && (
              <AddRow to="/accounts/watch" icon={Eye} label={t("offline.watch.add")} onGo={() => setOpen(false)} />
            )}
          </div>
        </Panel>
      </section>

      {info.seeds.length > 0 && (
        <Section title={t("wallet.phrase.section")} count={info.seeds.length}>
          <Panel className="overflow-hidden">
            <motion.ul {...stagger} className="divide-y divide-border">
              {info.seeds.map((seed) => (
                <motion.li variants={STAGGER.item} key={seed.id}>
                  <SeedRow seed={seed} onAction={(kind) => setSeedAction({ kind, seed })} />
                </motion.li>
              ))}
            </motion.ul>
          </Panel>
        </Section>
      )}

      <div className="flex flex-col gap-7">
        {info.hasPassword && (
          <Section title={t("wallet.security")}>
            <Panel className="flex h-full items-center gap-3.5 p-5">
              <IconBadge icon={Lock} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-semibold">{t("wallet.walletPassword")}</span>
                <span className="text-sm text-muted-foreground">{t("wallet.securityDesc")}</span>
              </div>
              <button type="button" className="btn btn-tinted btn-sm shrink-0" onClick={() => setChanging(true)}>
                {t("wallet.changePassword.title")}
              </button>
            </Panel>
          </Section>
        )}

        <Section title={t("wallet.accounts.storage")}>
          <Panel className="flex h-full flex-col gap-3 p-5">
            <div className="flex items-start gap-3.5">
              <IconBadge icon={HardDrive} />
              <p className="text-sm text-muted-foreground">{t("wallet.accounts.storageDesc")}</p>
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted py-1 pr-1 pl-3">
              <code className="selectable min-w-0 flex-1 truncate font-mono text-sm">{info.keystoreDir}</code>
              <CopyButton value={info.keystoreDir} />
            </div>
          </Panel>
        </Section>
      </div>

      <BackupModal
        open={action?.kind === "backup"}
        onClose={close}
        account={target}
        label={target ? label(target) : ""}
      />
      <PasswordModal open={changing} onClose={() => setChanging(false)} />
      <RevealPhraseModal
        open={seedAction?.kind === "reveal"}
        onClose={() => setSeedAction(null)}
        seedId={seedAction?.seed.id ?? null}
      />
      <DeriveModal
        open={seedAction?.kind === "derive"}
        onClose={() => setSeedAction(null)}
        seed={seedAction?.seed ?? null}
      />
      <RemoveSeedModal
        open={seedAction?.kind === "remove"}
        onClose={() => setSeedAction(null)}
        seed={seedAction?.seed ?? null}
      />
      <RemoveModal
        open={action?.kind === "remove" && !target?.watchOnly}
        onClose={close}
        account={target}
        label={target ? label(target) : ""}
      />
      <RemoveWatchOnlyModal
        account={action?.kind === "remove" && target?.watchOnly ? target : null}
        label={target ? label(target) : ""}
        onClose={close}
      />
    </div>
  );
}

function AccountRow({
  account,
  label,
  seedName,
  selected,
  onSelect,
  onAction,
}: {
  account: WalletAccount;
  label: string;
  seedName?: string;
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
    <div
      className={`group flex flex-col gap-2 px-4 py-3.5 transition-colors ${selected ? "bg-selected/60" : "hover:bg-hover"}`}
    >
      <div className="flex items-center gap-3.5">
        {/* The row picks the account the wallet shows, as a list in Settings would */}
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={t("wallet.accounts.show", { name: label })}
          className="rounded-full"
        >
          <RadioMark selected={selected} className="hover:border-foreground/40" />
        </button>
        <AddressAvatar address={account.address} size={40} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {editing ? (
            <RenameForm
              value={name}
              placeholder={label}
              onChange={setName}
              onSave={rename}
              onCancel={() => {
                setName(account.name);
                setEditing(false);
              }}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{label}</span>
              {account.watchOnly ? (
                <Tooltip content={t("offline.watchOnly.desc")}>
                  <Pill>{t("offline.watchOnly")}</Pill>
                </Tooltip>
              ) : (
                !account.backedUp && <Pill tone="warn">{t("wallet.accounts.noBackup")}</Pill>
              )}
            </div>
          )}
          <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <Tooltip content={account.address} mono>
              <span className="font-mono">{shortHex(account.address, 12, 10)}</span>
            </Tooltip>
            <CopyButton value={account.address} className="-my-1" />
            {account.fromSeed && (
              <Tooltip content={account.seedPath} mono>
                <span className="ml-1 flex min-w-0 items-center gap-1">
                  <ScrollText className="size-3 shrink-0" />
                  <span className="truncate">
                    {account.seedStandard
                      ? t("wallet.accounts.fromPhrase", { name: seedName ?? "", n: account.seedIndex + 1 })
                      : `${seedName ?? ""} · ${account.seedPath}`}
                  </span>
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!account.watchOnly && (
            <button type="button" className="btn btn-tinted btn-sm" onClick={() => onAction("backup")}>
              <FileKey2 className="size-3.5" />
              {t("wallet.backup.cta")}
            </button>
          )}
          <RowActions
            onRename={() => setEditing(true)}
            onRemove={() => onAction("remove")}
            removeLabel={t("wallet.remove.title")}
          />
        </div>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </div>
  );
}

/** SeedRow is one recovery phrase: its name (renamable), its state, and what can be done with it. */
function SeedRow({ seed, onAction }: { seed: SeedInfo; onAction: (a: SeedAction) => void }) {
  const t = useT();
  const wallet = useWallet();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(seed.name);
  const [error, setError] = useState<string | null>(null);

  const rename = async () => {
    try {
      await api.walletRenameSeed(seed.id, name);
      setEditing(false);
      setError(null);
      await wallet.refresh();
    } catch (e) {
      setError(walletError(e, t));
    }
  };

  return (
    <div className="group flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-hover">
      <div className="flex items-center gap-3.5">
        <IconBadge icon={ScrollText} tone={seed.confirmed ? "neutral" : "warn"} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {editing ? (
            <RenameForm
              value={name}
              onChange={setName}
              onSave={rename}
              onCancel={() => {
                setName(seed.name);
                setEditing(false);
              }}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{seed.name}</span>
              {seed.hasPassphrase && <Pill>{t("wallet.passphrase.badge")}</Pill>}
            </div>
          )}
          <span className="text-sm text-muted-foreground">
            <span className={seed.confirmed ? "" : "text-warn-ink"}>
              {seed.confirmed ? t("wallet.phrase.statusConfirmed") : t("wallet.phrase.statusUnconfirmed")}
            </span>
            {" · "}
            {seed.accounts === 1 ? t("wallet.phrase.account") : t("wallet.phrase.accounts", { n: seed.accounts })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="btn btn-tinted btn-sm" onClick={() => onAction("reveal")}>
            {seed.confirmed ? t("wallet.phrase.show") : t("wallet.phrase.showConfirm")}
          </button>
          <button type="button" className="btn btn-tinted btn-sm" onClick={() => onAction("derive")}>
            <Plus className="size-3.5" />
            {t("wallet.derive.cta")}
          </button>
          <RowActions
            onRename={() => setEditing(true)}
            onRemove={() => onAction("remove")}
            removeLabel={t("wallet.removeSeed.title")}
          />
        </div>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </div>
  );
}

/** AddRow is a list's last rows: a way to add to it, leaving Settings for the page that does it. */
function AddRow({ to, icon: Icon, label, onGo }: { to: string; icon: typeof Plus; label: string; onGo: () => void }) {
  return (
    <Link to={to} onClick={onGo} className="flex h-14 items-center gap-3.5 px-4 transition-colors hover:bg-hover">
      <IconBadge icon={Icon} />
      <span className="font-medium">{label}</span>
    </Link>
  );
}

/** RowActions are a row's quieter actions, renaming and removing, shown as the row is pointed at. */
function RowActions({
  onRename,
  onRemove,
  removeLabel,
}: {
  onRename: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  const t = useT();
  return (
    // Folded away until the row is pointed at, so the row's buttons sit at its
    // end; then it slides open, nudging them aside
    <span className="-mr-1 flex max-w-0 items-center overflow-hidden pl-0 opacity-0 transition-[max-width,opacity,padding] duration-200 ease-out group-focus-within:max-w-20 group-focus-within:pl-1 group-focus-within:opacity-100 group-hover:max-w-20 group-hover:pl-1 group-hover:opacity-100">
      <Tooltip content={t("wallet.accounts.rename")}>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onRename}
          aria-label={t("wallet.accounts.rename")}
        >
          <Pencil className="size-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={removeLabel}>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon text-critical-ink"
          onClick={onRemove}
          aria-label={removeLabel}
        >
          <Trash2 className="size-3.5" />
        </button>
      </Tooltip>
    </span>
  );
}

/** RenameForm edits a name in place: Enter saves, the cross cancels. */
function RenameForm({
  value,
  placeholder,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <input
        className="input max-w-64"
        value={value}
        maxLength={64}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
        onClick={onCancel}
      >
        <X className="size-3.5" />
      </button>
    </form>
  );
}
