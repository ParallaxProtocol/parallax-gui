import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Check,
  ChevronRight,
  Download,
  FileKey2,
  Lock,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { api, SeedInfo, walletError, WalletAccount } from "../../lib/api";
import { shortHex } from "../../lib/format";
import { STAGGER, useStagger } from "../../lib/motion";
import { accountLabel, groupAccounts, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Panel, Section } from "../../components/ui/Panel";
import { IconBadge } from "../../components/ui/IconBadge";
import { Pill } from "../../components/ui/Pill";
import { RadioMark } from "../../components/ui/Choice";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { BackupModal, DeriveModal, PasswordModal, RemoveModal, RemoveSeedModal } from "./AccountForms";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { GroupedAddress } from "../../components/ui/AccountParts";
import { RevealPhraseModal } from "./Phrase";
import { useSettingsSheet, type SettingsPage } from "../../components/shell/SettingsSheet";
import { AccountPage } from "../Settings/accounts";
import { RemoveWatchOnlyModal } from "./WatchOnly";
import { Select } from "../../components/ui/Select";
import { CONFIG_UPDATED_EVENT } from "../../App";

type Action = "backup" | "remove";
type SeedAction = "reveal" | "derive" | "remove";

/**
 * AccountsSettings is Settings' Accounts section, managing the wallet: its
 * accounts grouped by what keeps their keys (each recovery phrase, with
 * its own accounts and the way to add another; single keys; watch-only
 * accounts), which one the app shows, and their names and backups.
 * Adding accounts, or finding more of a phrase's, drills into a page
 * within the section, and comes back to the list.
 */
export function AccountsSettings() {
  const t = useT();
  const wallet = useWallet();
  const { setOpen, page, setPage } = useSettingsSheet();
  const navigate = useNavigate();
  const [seedAction, setSeedAction] = useState<{ kind: SeedAction; seed: SeedInfo } | null>(null);
  const [action, setAction] = useState<{ kind: Action; account: WalletAccount } | null>(null);

  const info = wallet.info;
  if (!info) return null;
  if (page) return <AccountPage page={page} onLeave={() => setPage(null)} />;
  // Adding accounts takes the wallet password: until there is one, the
  // Welcome page sets it
  const drill = (p: SettingsPage) => {
    if (info.hasPassword) return setPage(p);
    setOpen(false);
    navigate("/");
  };
  const label = (a: WalletAccount) => accountLabel(a, info.accounts, t);
  const close = () => setAction(null);
  const target = action?.account ?? null;

  const groups = groupAccounts(info);
  const ofSeed = (id: string) => groups.find((g) => g.kind === "phrase" && g.seed.id === id)?.accounts ?? [];
  const keys = groups.find((g) => g.kind === "keys")?.accounts ?? [];
  const watched = groups.find((g) => g.kind === "watch")?.accounts ?? [];
  const row = (a: WalletAccount) => (
    <AccountRow
      account={a}
      label={label(a)}
      selected={a.address === wallet.account?.address}
      onSelect={() => wallet.select(a.address)}
      onAction={(kind) => setAction({ kind, account: a })}
    />
  );

  return (
    <div className="flex flex-col gap-7">
      <Panel className="overflow-hidden">
        {info.accounts.length === 0 && (
          <p className="border-b border-border py-10 text-center text-muted-foreground">{t("wallet.accounts.empty")}</p>
        )}
        <AddRow
          icon={Plus}
          label={t("wallet.accounts.createTitle")}
          onClick={() => drill({ kind: "accounts.add" })}
          chevron
        />
        <div className="border-t border-border">
          <AddRow
            icon={Download}
            label={t("wallet.accounts.importTitle")}
            onClick={() => drill({ kind: "accounts.import" })}
            chevron
          />
        </div>
      </Panel>

      {info.seeds.length > 0 && (
        <Section title={t("wallet.accounts.phrases")} count={info.seeds.length}>
          {info.seeds.map((seed) => (
            <Panel key={seed.id} className="overflow-hidden">
              <SeedRow
                seed={seed}
                onAction={(kind) =>
                  kind === "find" ? drill({ kind: "accounts.find", seedId: seed.id }) : setSeedAction({ kind, seed })
                }
              />
              <Rows accounts={ofSeed(seed.id)} row={row} />
              <AddRow
                icon={Plus}
                label={t("wallet.derive.cta")}
                onClick={() => setSeedAction({ kind: "derive", seed })}
              />
            </Panel>
          ))}
        </Section>
      )}

      {keys.length > 0 && (
        <Section title={t("wallet.accounts.keys")} count={keys.length}>
          <Panel className="overflow-hidden">
            <Rows accounts={keys} row={row} />
          </Panel>
        </Section>
      )}

      {watched.length > 0 && (
        <Section title={t("offline.watchOnly")} count={watched.length}>
          <Panel className="overflow-hidden">
            <Rows accounts={watched} row={row} />
          </Panel>
        </Section>
      )}

      <BackupModal
        open={action?.kind === "backup"}
        onClose={close}
        account={target}
        label={target ? label(target) : ""}
      />
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

/**
 * SecuritySettings is Settings' Security section: the wallet's password,
 * and how long the wallet stays unlocked. Shown once the wallet has a
 * password.
 */
export function SecuritySettings() {
  const t = useT();
  const [changing, setChanging] = useState(false);
  return (
    <>
      <Panel className="flex h-full flex-col divide-y divide-border">
        <div className="flex items-center gap-3.5 p-5">
          <IconBadge icon={Lock} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span>{t("wallet.walletPassword")}</span>
            <span className="text-sm text-muted-foreground">{t("wallet.securityDesc")}</span>
          </div>
          <button type="button" className="btn btn-tinted btn-sm shrink-0" onClick={() => setChanging(true)}>
            {t("wallet.changePassword.title")}
          </button>
        </div>
        <AutoLockRow />
      </Panel>
      <PasswordModal open={changing} onClose={() => setChanging(false)} />
    </>
  );
}

/** Rows lists a group's accounts, one after another as they first show. */
function Rows({ accounts, row }: { accounts: WalletAccount[]; row: (a: WalletAccount) => ReactNode }) {
  const stagger = useStagger();
  if (accounts.length === 0) return null;
  return (
    <motion.ul {...stagger} className="divide-y divide-border border-b border-border last:border-b-0">
      {accounts.map((a) => (
        <motion.li variants={STAGGER.item} key={a.address}>
          {row(a)}
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * AccountRow is one account: whether it's the one shown, its name
 * (renamable), its address, and its backup. An account of a recovery
 * phrase is backed up by the phrase, whose state its group shows.
 */
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
  const single = !account.watchOnly && !account.fromSeed;

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
        <div className="@container flex min-w-0 flex-1 flex-col gap-0.5">
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
              <span className="truncate">{label}</span>
              {single && !account.backedUp && <Pill tone="warn">{t("wallet.accounts.noBackup")}</Pill>}
            </div>
          )}
          <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            {/* The whole address, grouped as a card number is, where the row
                has room for it; shortened where it hasn't */}
            <span className="hidden @md:inline">
              <GroupedAddress address={account.address} />
            </span>
            <Tooltip content={account.address} mono>
              <span className="font-mono @md:hidden">{shortHex(account.address, 12, 10)}</span>
            </Tooltip>
            <CopyButton value={account.address} className="-my-1" />
            {/* Where under its phrase: a number along the standard path, the path itself along another */}
            {account.fromSeed && (
              <Tooltip content={account.seedPath} mono>
                <span className={`ml-1 truncate ${account.seedStandard ? "" : "font-mono"}`}>
                  {account.seedStandard ? `#${account.seedIndex + 1}` : account.seedPath}
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {single && (
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

/**
 * SeedRow heads a recovery phrase's group: its name (renamable), its
 * state, and what can be done with it: showing it (and confirming it was
 * written down), finding more of its accounts, renaming and removing it.
 */
function SeedRow({ seed, onAction }: { seed: SeedInfo; onAction: (a: SeedAction | "find") => void }) {
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
    <div className="group flex flex-col gap-2 border-b border-border bg-background/30 px-4 py-3.5">
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
          <button type="button" className="btn btn-tinted btn-sm" onClick={() => onAction("find")}>
            <Search className="size-3.5" />
            {t("wallet.find.cta")}
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

/** AddRow is a way to add to a list: at a group's foot, or (leading on to a page) above the groups. */
function AddRow({
  icon: Icon,
  label,
  onClick,
  chevron,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-14 w-full items-center gap-3.5 px-4 text-left transition-colors hover:bg-hover"
    >
      <IconBadge icon={Icon} />
      <span className="flex-1">{label}</span>
      {chevron && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
      )}
    </button>
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

/** The auto-lock times on offer, in minutes; -1 for as long as the app runs. */
const AUTO_LOCK = [1, 5, 15, 30, 60, 240, -1];

/**
 * AutoLockRow picks how long the wallet stays unlocked with nothing done in
 * the app (backend/session.go), saved at once.
 */
function AutoLockRow() {
  const t = useT();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .getConfig()
      // 0 is the default, 15 minutes
      .then((c) => setMinutes(c.autoLockMinutes || 15))
      .catch(() => {});
  }, []);

  const label = (m: number) =>
    m < 0
      ? t("wallet.autoLock.never")
      : m < 60
        ? t(m === 1 ? "wallet.autoLock.minute" : "wallet.autoLock.minutes", { n: m })
        : t(m === 60 ? "wallet.autoLock.hour" : "wallet.autoLock.hours", { n: m / 60 });
  const change = async (m: number) => {
    setMinutes(m);
    setError(null);
    try {
      const fresh = await api.getConfig();
      await api.updateConfig({ ...fresh, autoLockMinutes: m });
      window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
    } catch (e) {
      setError(walletError(e, t));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3.5">
        <IconBadge icon={Timer} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span>{t("wallet.autoLock")}</span>
          <span className="text-sm text-muted-foreground">{t("wallet.autoLockDesc")}</span>
        </div>
        {minutes !== null && (
          <Select
            value={minutes}
            // A time saved outside the menu (by hand in the config) shows too
            options={(AUTO_LOCK.includes(minutes) ? AUTO_LOCK : [...AUTO_LOCK, minutes]).map((m) => ({
              value: m,
              label: label(m),
            }))}
            onChange={change}
            size="sm"
            aria-label={t("wallet.autoLock")}
          />
        )}
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
    </div>
  );
}
