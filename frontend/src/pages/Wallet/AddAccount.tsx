import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CheckCircle2, FileKey2, KeyRound } from "lucide-react";
import { api, WalletAccount } from "../../lib/api";
import { PAGE } from "../../lib/motion";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Panel } from "../../components/ui/Panel";
import { Notice } from "../../components/ui/bits";
import { StepMark } from "../../components/ui/StepMark";
import { Address, Field, NewPassword, PasswordInput } from "./common";
import { BackupSaved, backUp, Form, NameField, Submit, useBusy } from "./AccountForms";

/**
 * The pages that add an account to the wallet, each a few steps in the
 * main view: making a new key and backing it up, or bringing one from a
 * keystore file or a private key. Passwords and keys typed here stay in the
 * page's own state and are gone once it is left.
 */

/** Steps is the flow's progress across the top: the steps behind ticked off, the current one in the accent. */
function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-3">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-3" aria-current={i === current ? "step" : undefined}>
          {i > 0 && <span className="h-px w-8 bg-border-strong" aria-hidden />}
          <span className="flex items-center gap-2">
            <StepMark state={i < current ? "done" : i === current ? "current" : "todo"} size={18} />
            <span className={i === current ? "font-medium" : "text-muted-foreground"}>{s}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Flow lays out an add-account page: a way back, its steps, and the step at hand, which changes in place. */
function Flow({
  title,
  steps,
  current,
  onBack,
  children,
}: {
  title: string;
  steps: string[];
  current: number;
  onBack?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5">
      <div className="flex items-center justify-between gap-4">
        <button type="button" className="btn btn-ghost -ml-2" onClick={onBack ?? (() => navigate(-1))}>
          <ArrowLeft className="size-3.5" />
          {t("common.back")}
        </button>
        <Steps steps={steps} current={current} />
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={current} {...PAGE}>
          <Panel>{children}</Panel>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function CreateAccountPage() {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<WalletAccount | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useBusy();

  // The password is kept only so the backup right after needn't ask again
  useEffect(() => () => setPassword(""), []);

  const steps = [t("wallet.create.step.password"), t("wallet.create.step.backup")];
  const done = () => navigate("/", { replace: true });

  if (created) {
    return (
      <Flow title={t("wallet.backup.nowTitle")} steps={steps} current={saved ? 2 : 1} onBack={done}>
        <Form
          onSubmit={async () => {
            const ok = await run(() => backUp(created.address, password));
            if (ok) {
              setPassword("");
              setSaved(true);
              await wallet.refresh();
            }
          }}
          error={error}
          actions={
            saved ? (
              <button type="button" className="btn btn-primary" onClick={done}>
                {t("common.done")}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" onClick={done}>
                  {t("wallet.backup.later")}
                </button>
                <Submit busy={busy}>
                  <FileKey2 className="size-3.5" />
                  {t("wallet.backup.cta")}
                </Submit>
              </>
            )
          }
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good-ink" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{t("wallet.create.done")}</span>
              <Address value={created.address} className="text-sm" />
            </div>
          </div>
          {saved ? (
            <BackupSaved />
          ) : (
            <>
              <Notice tone="warn">{t("wallet.backup.nowDesc")}</Notice>
              <p className="text-muted-foreground">{t("wallet.backup.desc")}</p>
            </>
          )}
        </Form>
      </Flow>
    );
  }

  return (
    <Flow title={t("wallet.create.title")} steps={steps} current={0}>
      <Form
        onSubmit={async () => {
          const acc = await run(() => api.walletCreate(name, password));
          if (acc) {
            setCreated(acc);
            await wallet.refresh();
          }
        }}
        error={error}
        actions={
          <Submit busy={busy} disabled={!password}>
            {busy ? t("wallet.create.busy") : t("wallet.create.cta")}
          </Submit>
        }
      >
        <p className="text-muted-foreground">{t("wallet.create.desc")}</p>
        <NameField value={name} onChange={setName} />
        <NewPassword onChange={setPassword} />
        <Notice tone="warn">{t("wallet.password.noRecovery")}</Notice>
      </Form>
    </Flow>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type ImportKind = "keyfile" | "key";

export function ImportAccountPage() {
  const t = useT();
  const [kind, setKind] = useState<ImportKind | null>(null);
  const steps = [t("wallet.import.step.source"), t("wallet.import.step.details")];

  if (!kind) {
    return (
      <Flow title={t("wallet.import.title")} steps={steps} current={0}>
        <div className="flex flex-col gap-3 p-5">
          <p className="text-muted-foreground">{t("wallet.import.choose.desc")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SourceChoice
              icon={FileKey2}
              title={t("wallet.import.keyfile")}
              desc={t("wallet.import.keyfileDesc")}
              onClick={() => setKind("keyfile")}
            />
            <SourceChoice
              icon={KeyRound}
              title={t("wallet.import.key")}
              desc={t("wallet.import.keyDesc")}
              onClick={() => setKind("key")}
            />
          </div>
        </div>
      </Flow>
    );
  }
  return (
    <Flow
      title={kind === "key" ? t("wallet.import.key") : t("wallet.import.keyfile")}
      steps={steps}
      current={1}
      onBack={() => setKind(null)}
    >
      <ImportDetails kind={kind} />
    </Flow>
  );
}

function SourceChoice({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: typeof KeyRound;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-4 text-left transition-colors hover:border-border-strong hover:bg-hover"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

function ImportDetails({ kind }: { kind: ImportKind }) {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [file, setFile] = useState<{ name: string; json: string } | null>(null);
  const [filePassword, setFilePassword] = useState("");
  const [renew, setRenew] = useState(false);
  const [password, setPassword] = useState("");
  const { busy, error, setError, run } = useBusy();
  const fileInput = useRef<HTMLInputElement>(null);

  // Nothing typed here outlives the page
  useEffect(
    () => () => {
      setKey("");
      setFilePassword("");
      setPassword("");
    },
    [],
  );

  const keyHex = key.trim().replace(/^0x/i, "");
  const keyOk = /^[0-9a-fA-F]{64}$/.test(keyHex);
  const ready = kind === "key" ? keyOk && !!password : !!file && !!filePassword && (!renew || !!password);

  const readFile = async (f: File | undefined) => {
    setFile(null);
    setError(null);
    if (!f) return;
    if (f.size > 64 * 1024) {
      setError(t("wallet.err.badKeyfile"));
      return;
    }
    const text = await f.text();
    try {
      JSON.parse(text);
    } catch {
      setError(t("wallet.err.badKeyfile"));
      return;
    }
    setFile({ name: f.name, json: text });
  };

  return (
    <Form
      onSubmit={async () => {
        const acc = await run(() =>
          kind === "key"
            ? api.walletImportPrivateKey(name, keyHex, password)
            : api.walletImportKeyfile(name, file!.json, filePassword, renew ? password : ""),
        );
        if (acc) {
          await wallet.refresh();
          navigate("/", { replace: true });
        }
      }}
      error={error}
      actions={
        <Submit busy={busy} disabled={!ready}>
          {busy ? t("wallet.import.busy") : t("wallet.import.cta")}
        </Submit>
      }
    >
      <NameField value={name} onChange={setName} />
      {kind === "keyfile" ? (
        <>
          <Field label={t("wallet.import.file")}>
            {(id) => (
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  ref={fileInput}
                  type="file"
                  className="sr-only"
                  onChange={(e) => readFile(e.target.files?.[0])}
                />
                <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
                  <FileKey2 className="size-3.5" />
                  {t("wallet.import.choose")}
                </button>
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {file ? file.name : t("wallet.import.noFile")}
                </span>
              </div>
            )}
          </Field>
          <Field label={t("wallet.import.filePassword")} hint={t("wallet.import.filePasswordHint")}>
            {(id) => <PasswordInput id={id} value={filePassword} onChange={setFilePassword} />}
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={renew} onChange={(e) => setRenew(e.target.checked)} />
            {t("wallet.import.renew")}
          </label>
          {renew && <NewPassword onChange={setPassword} />}
        </>
      ) : (
        <>
          <Notice tone="warn">{t("wallet.import.keyWarn")}</Notice>
          <Field
            label={t("wallet.import.keyLabel")}
            error={key && !keyOk ? t("wallet.err.badKey") : null}
            hint={t("wallet.import.keyHint")}
          >
            {(id) => <PasswordInput id={id} value={key} onChange={setKey} placeholder="0x…" />}
          </Field>
          <NewPassword onChange={setPassword} />
        </>
      )}
    </Form>
  );
}
