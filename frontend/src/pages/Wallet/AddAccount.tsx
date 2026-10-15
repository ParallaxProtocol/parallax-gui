import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronRight, FileKey2, KeyRound, Loader2, Plus, ScrollText } from "lucide-react";
import { api, SeedInfo, WalletAccount } from "../../lib/api";
import { SPRING, STAGGER } from "../../lib/motion";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Notice } from "../../components/ui/bits";
import { DrawnCheck, Field, PasswordInput } from "./common";
import { NameField } from "./AccountForms";
import { backUp, useBusy } from "./accountActions";
import { CreateIntro, DetailsStep, SetupPasswordStep } from "./CreateStep";
import { FlowPage, Part, StepFooter, StepPanel } from "./flow";
import { PhraseGrid, PhraseQuiz, PhraseWarning } from "./Phrase";
import { PhraseImport } from "./PhraseImport";
import { Pill } from "../../components/ui/Pill";
import { IconBadge } from "../../components/ui/IconBadge";
import { Choice } from "../../components/ui/Choice";

/**
 * The pages that add an account to the wallet, each a few steps laid out
 * as the rest of the app is (flow.tsx). They run once the wallet has its
 * password (set from the Welcome page, before anything else), and ask for
 * it where it is needed. Passwords, words and keys typed here stay in the
 * page's own state and are gone once it is left.
 */

/** useUnlocked sends a page back to Welcome while the wallet has no password. */
function useUnlocked(): ReactNode | null {
  const wallet = useWallet();
  return wallet.info && !wallet.info.hasPassword ? <Navigate to="/" replace /> : null;
}

/**
 * SetupPasswordPage sets the wallet password, from the Welcome page's Get
 * started (or, for a wallet that has keys but no password yet, its Set
 * password), then unlocks the wallet and goes to its overview.
 */
export function SetupPasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [existing] = useState(() => !!wallet.info?.needsSetup);
  // The password just set, kept only to make the phrase if the user wants one
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState<{ seedId: string; words: string[] } | null>(null);
  const [offered, setOffered] = useState(false);
  const { busy, error, run } = useBusy();
  useEffect(
    () => () => {
      setPassword("");
      setPhrase(null);
    },
    [],
  );

  const steps = [t("wallet.setup.step"), t("wallet.create.step.phrase"), t("wallet.create.step.confirm")];
  const done = () => {
    setPassword("");
    setPhrase(null);
    navigate("/", { replace: true });
  };

  if (phrase) {
    return (
      <PhraseSteps
        seedId={phrase.seedId}
        words={phrase.words}
        hasPassphrase={false}
        steps={steps}
        at={1}
        onDone={done}
      />
    );
  }

  if (offered) {
    return (
      <FlowPage title={t("wallet.offer.title")} steps={steps} current={1}>
        <StepPanel>
          <Part className="gap-3">
            <p>{t("wallet.offer.desc")}</p>
            <p className="text-sm text-muted-foreground">{t("wallet.offer.later")}</p>
            {error && <Notice tone="critical">{error}</Notice>}
          </Part>
          <StepFooter>
            <button type="button" className="btn btn-secondary" onClick={done} disabled={busy}>
              {t("hello.skip")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              autoFocus
              onClick={async () => {
                const made = await run(() => api.walletCreateSeed("", password, ""));
                if (made) {
                  setPassword("");
                  setPhrase({ seedId: made.seedId, words: made.words });
                  await wallet.refresh();
                }
              }}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t("wallet.offer.cta")}
              {!busy && <ArrowRight className="size-3.5" />}
            </button>
          </StepFooter>
        </StepPanel>
      </FlowPage>
    );
  }

  return (
    <FlowPage title={t("wallet.setup.title")} steps={existing ? [] : steps} current={0}>
      <SetupPasswordStep
        existing={existing}
        onBack={() => navigate(-1)}
        onSet={async (pass) => {
          await wallet.refresh();
          // A wallet that already has keys needs no new phrase offered
          if (existing) return done();
          setPassword(pass);
          setOffered(true);
        }}
      />
    </FlowPage>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

type CreateKind = "phrase" | "derive" | "key";

/**
 * CreateAccountPage sets the wallet password if need be, then asks what
 * kind of account to make: from a new recovery phrase, from one the wallet
 * already has, or with a single key of its own, backed up as a file.
 */
export function CreateAccountPage() {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const locked = useUnlocked();
  const [kind, setKind] = useState<CreateKind | null>(null);
  const back = () => setKind(null);
  const seeds = wallet.info?.seeds ?? [];

  if (locked) return locked;
  if (kind === "key") return <CreateKey onBack={back} />;
  if (kind === "phrase") return <CreateWallet onBack={back} />;
  if (kind === "derive") return <DeriveAccount seeds={seeds} onBack={back} />;

  return (
    <FlowPage title={t("wallet.create.kindTitle")} steps={[]} current={0}>
      <StepPanel>
        <Part>
          <p className="text-muted-foreground">{t("wallet.create.kindDesc")}</p>
        </Part>
        {seeds.length > 0 && (
          <SourceChoice
            icon={Plus}
            title={t("wallet.create.kind.derive")}
            desc={t("wallet.create.kind.deriveDesc")}
            onClick={() => setKind("derive")}
          />
        )}
        <SourceChoice
          icon={ScrollText}
          title={t("wallet.create.kind.phrase")}
          desc={t("wallet.create.kind.phraseDesc")}
          badge={seeds.length === 0 ? t("wallet.create.recommended") : undefined}
          onClick={() => setKind("phrase")}
        />
        <SourceChoice
          icon={KeyRound}
          title={t("wallet.create.kind.key")}
          desc={t("wallet.create.kind.keyDesc")}
          onClick={() => setKind("key")}
        />
        <StepFooter onBack={() => navigate(-1)}>{null}</StepFooter>
      </StepPanel>
    </FlowPage>
  );
}

type PhraseStage = "intro" | "details" | "phrase" | "confirm";

/**
 * CreateWallet makes a new recovery phrase and its first account: what will
 * happen, a name and the wallet password, an optional passphrase,
 * the words to write down, and three of them typed back to prove it.
 */
function CreateWallet({ onBack }: { onBack: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [stage, setStage] = useState<PhraseStage>("intro");
  const [seedId, setSeedId] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const { busy, error, run } = useBusy();

  // The words live here only while the page shows
  useEffect(() => () => setWords([]), []);

  const steps = [
    t("wallet.create.step.intro"),
    t("wallet.create.step.details"),
    t("wallet.create.step.phrase"),
    t("wallet.create.step.confirm"),
  ];
  const done = () => navigate("/", { replace: true });

  if (stage === "intro") {
    return (
      <FlowPage title={t("wallet.create.step.intro")} steps={steps} current={0}>
        <CreateIntro kind="phrase" onBack={onBack} onContinue={() => setStage("details")} />
      </FlowPage>
    );
  }

  if (stage === "details") {
    return (
      <FlowPage title={t("wallet.create.detailsTitle")} steps={steps} current={1}>
        <DetailsStep
          busy={busy}
          error={error}
          next={t("wallet.create.next")}
          allowPassphrase
          onBack={() => setStage("intro")}
          onSubmit={async (name, password, passphrase) => {
            const phrase = await run(() => api.walletCreateSeed(name, password, passphrase));
            if (phrase) {
              setSeedId(phrase.seedId);
              setWords(phrase.words);
              setHasPassphrase(!!passphrase);
              setStage("phrase");
              await wallet.refresh();
            }
          }}
        />
      </FlowPage>
    );
  }

  return (
    <PhraseSteps
      seedId={seedId}
      words={words}
      hasPassphrase={hasPassphrase}
      steps={steps}
      at={2}
      onBack={() => setStage("details")}
      onDone={() => {
        setWords([]);
        done();
      }}
    />
  );
}

/**
 * PhraseSteps shows a phrase just made and checks it was written down: the
 * words, veiled until revealed, then three of them typed back. They are
 * the steps at and at+1 of a flow's steps. onDone runs when the user goes
 * on, confirmed or (from the words) leaving it for later.
 */
function PhraseSteps({
  seedId,
  words,
  hasPassphrase,
  steps,
  at,
  onDone,
}: {
  seedId: string;
  words: string[];
  hasPassphrase: boolean;
  steps: string[];
  at: number;
  onBack?: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const wallet = useWallet();
  const [stage, setStage] = useState<"phrase" | "confirm">("phrase");
  const [valid, setValid] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, run } = useBusy();

  if (stage === "phrase") {
    return (
      <FlowPage title={t("wallet.phrase.yours")} steps={steps} current={at}>
        <StepPanel>
          <Part className="gap-4">
            <p>{t("wallet.phrase.writeDown")}</p>
            <PhraseGrid words={words} />
            {hasPassphrase && <Notice tone="info">{t("wallet.passphrase.remember")}</Notice>}
            <PhraseWarning />
          </Part>
          <StepFooter hint={<span className="text-warn-ink">{t("wallet.phrase.laterWarn")}</span>}>
            <button type="button" className="btn btn-secondary" onClick={onDone}>
              {t("wallet.created.later")}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStage("confirm")}>
              {t("wallet.phrase.written")}
              <ArrowRight className="size-3.5" />
            </button>
          </StepFooter>
        </StepPanel>
      </FlowPage>
    );
  }

  return (
    <FlowPage title={t("wallet.phrase.quizTitle")} steps={steps} current={confirmed ? at + 2 : at + 1}>
      <StepPanel
        onSubmit={async () => {
          if (confirmed) return onDone();
          if (!valid || busy) return;
          const ok = await run(async () => {
            await api.walletConfirmSeed(seedId);
            return true;
          });
          if (ok) {
            setConfirmed(true);
            await wallet.refresh();
          }
        }}
      >
        <Part className="gap-4">
          <AnimatePresence mode="wait" initial={false}>
            {confirmed ? (
              <motion.div
                key="ready"
                className="flex flex-col items-center gap-3 py-4 text-center"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING}
              >
                <DrawnCheck />
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-semibold">{t("wallet.phrase.ready")}</span>
                  <span className="max-w-sm text-muted-foreground">{t("wallet.phrase.readyDesc")}</span>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="quiz"
                className="flex flex-col gap-4"
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              >
                <p>{t("wallet.phrase.quizDesc")}</p>
                <PhraseQuiz words={words} onValid={setValid} />
                {error && <Notice tone="critical">{error}</Notice>}
              </motion.div>
            )}
          </AnimatePresence>
        </Part>
        <StepFooter onBack={confirmed ? undefined : () => setStage("phrase")}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || (!confirmed && !valid)}
            autoFocus={confirmed}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {confirmed ? t("wallet.created.open") : t("wallet.phrase.confirm")}
            {confirmed && <ArrowRight className="size-3.5" />}
          </button>
        </StepFooter>
      </StepPanel>
    </FlowPage>
  );
}

/**
 * DeriveAccount makes another account from one of the wallet's recovery
 * phrases, which already backs it up: which phrase, a name, and the wallet
 * password.
 */
function DeriveAccount({ seeds, onBack }: { seeds: SeedInfo[]; onBack: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [seedId, setSeedId] = useState(seeds[0]?.id ?? "");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useBusy();
  useEffect(() => () => setPassword(""), []);
  const ready = !!seedId && !!password && !busy;

  return (
    <FlowPage title={t("wallet.derive.title")} steps={[]} current={0}>
      <StepPanel
        onSubmit={async () => {
          if (!ready) return;
          const acc = await run(() => api.walletDeriveAccount(seedId, name, password));
          if (acc) {
            await wallet.refresh();
            navigate("/", { replace: true });
          }
        }}
      >
        <Part>
          <p className="text-muted-foreground">{t("wallet.derive.desc")}</p>
        </Part>
        {seeds.length > 1 && (
          <Part className="gap-2">
            <span className="font-medium">{t("wallet.derive.which")}</span>
            <div role="radiogroup" className="flex flex-col gap-2">
              {seeds.map((s) => (
                <Choice
                  key={s.id}
                  selected={s.id === seedId}
                  onClick={() => setSeedId(s.id)}
                  icon={<ScrollText className="size-4 shrink-0 text-muted-foreground" />}
                  title={s.name}
                  aside={s.accounts === 1 ? t("wallet.phrase.account") : t("wallet.phrase.accounts", { n: s.accounts })}
                />
              ))}
            </div>
          </Part>
        )}
        <Part className="gap-4">
          <NameField value={name} onChange={setName} />
          <Field label={t("wallet.walletPassword")}>
            {(id) => <PasswordInput id={id} value={password} onChange={setPassword} />}
          </Field>
          {error && <Notice tone="critical">{error}</Notice>}
        </Part>
        <StepFooter onBack={onBack}>
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("wallet.create.cta")}
          </button>
        </StepFooter>
      </StepPanel>
    </FlowPage>
  );
}

type KeyStage = "intro" | "details" | "backup";

/**
 * CreateKey makes a single account with a key of its own: what will happen,
 * a name and the wallet password, then the key's backup, its
 * keystore file.
 */
function CreateKey({ onBack }: { onBack: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [stage, setStage] = useState<KeyStage>("intro");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<WalletAccount | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useBusy();

  // Kept only so the backup right after needn't ask again
  useEffect(() => () => setPassword(""), []);

  const steps = [t("wallet.create.step.intro"), t("wallet.create.step.details"), t("wallet.create.step.backup")];
  const done = () => navigate("/", { replace: true });

  if (stage === "intro") {
    return (
      <FlowPage title={t("wallet.create.step.intro")} steps={steps} current={0}>
        <CreateIntro kind="key" onBack={onBack} onContinue={() => setStage("details")} />
      </FlowPage>
    );
  }

  if (stage === "details" || !created) {
    return (
      <FlowPage title={t("wallet.create.detailsTitle")} steps={steps} current={1}>
        <DetailsStep
          busy={busy}
          error={error}
          next={t("wallet.create.keyNext")}
          onBack={() => setStage("intro")}
          onSubmit={async (name, pass) => {
            const acc = await run(() => api.walletCreate(name, pass));
            if (acc) {
              setPassword(pass);
              setCreated(acc);
              setStage("backup");
              await wallet.refresh();
            }
          }}
        />
      </FlowPage>
    );
  }

  return (
    <FlowPage title={t("wallet.backup.title")} steps={steps} current={saved ? 3 : 2}>
      <StepPanel>
        <Part className="gap-4 py-5">
          <div className="flex items-center gap-3">
            <DrawnCheck />
            <div className="flex min-w-0 flex-col">
              <span className="text-[15px] font-semibold">{t("wallet.create.done")}</span>
              <span className="truncate font-mono text-sm text-muted-foreground">{created.address}</span>
            </div>
          </div>
        </Part>
        <Part className="gap-3">
          <AnimatePresence mode="wait" initial={false}>
            {saved ? (
              <motion.div
                key="saved"
                className="flex flex-col gap-1"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING}
              >
                <span className="font-semibold text-good-ink">{t("wallet.backup.saved")}</span>
                <span className="text-muted-foreground">{t("wallet.created.savedDesc")}</span>
              </motion.div>
            ) : (
              <motion.div
                key="save"
                className="flex flex-col gap-2 leading-relaxed"
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              >
                <p>{t("wallet.backup.what")}</p>
                <p className="text-muted-foreground">{t("wallet.create.keyBackupWhy")}</p>
              </motion.div>
            )}
          </AnimatePresence>
          {error && <Notice tone="critical">{error}</Notice>}
        </Part>
        <StepFooter hint={saved ? undefined : <span className="text-warn-ink">{t("wallet.backup.missingTitle")}</span>}>
          {saved ? (
            <button type="button" className="btn btn-primary" onClick={done} autoFocus>
              {t("wallet.created.open")}
              <ArrowRight className="size-3.5" />
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={done} disabled={busy}>
                {t("wallet.created.later")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(() => backUp(created.address, password));
                  if (ok) {
                    setPassword("");
                    setSaved(true);
                    await wallet.refresh();
                  }
                }}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileKey2 className="size-3.5" />}
                {t("wallet.backup.cta")}
              </button>
            </>
          )}
        </StepFooter>
      </StepPanel>
    </FlowPage>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

type ImportKind = "phrase" | "keyfile" | "key";

export function ImportAccountPage() {
  const t = useT();
  const navigate = useNavigate();
  const locked = useUnlocked();
  const [kind, setKind] = useState<ImportKind | null>(null);
  const steps = [t("wallet.import.step.source"), t("wallet.import.step.details")];

  if (locked) return locked;
  if (kind === "phrase") return <PhraseImport onBack={() => setKind(null)} />;

  if (!kind) {
    return (
      <FlowPage title={t("wallet.import.step.source")} steps={steps} current={0}>
        <StepPanel>
          <Part>
            <p className="text-muted-foreground">{t("wallet.import.choose.desc")}</p>
          </Part>
          <SourceChoice
            icon={ScrollText}
            title={t("wallet.import.phrase")}
            desc={t("wallet.import.phraseDesc")}
            onClick={() => setKind("phrase")}
          />
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
          <StepFooter onBack={() => navigate(-1)}>{null}</StepFooter>
        </StepPanel>
      </FlowPage>
    );
  }
  return (
    <FlowPage title={kind === "key" ? t("wallet.import.key") : t("wallet.import.keyfile")} steps={steps} current={1}>
      <ImportDetails kind={kind} onBack={() => setKind(null)} />
    </FlowPage>
  );
}

/** SourceChoice is one way to go on: a row of the panel that leads to it. */
function SourceChoice({
  icon: Icon,
  title,
  desc,
  badge,
  onClick,
  disabled,
}: {
  icon: typeof KeyRound;
  title: string;
  desc: string;
  badge?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      variants={STAGGER.item}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center gap-3 px-4 py-3.5 text-left transition-colors enabled:hover:bg-hover disabled:opacity-50"
    >
      <IconBadge icon={Icon} tone="brand" size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          {badge && <Pill tone="brand">{badge}</Pill>}
        </span>
        <span className="text-sm text-muted-foreground">{desc}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
    </motion.button>
  );
}

/** ImportDetails brings in a single key, from a keystore file or as hex, under the wallet password. */
function ImportDetails({ kind, onBack }: { kind: "keyfile" | "key"; onBack: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [file, setFile] = useState<{ name: string; json: string } | null>(null);
  const [filePassword, setFilePassword] = useState("");
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
  const walletPassword = password;
  const ready = !busy && !!walletPassword && (kind === "key" ? keyOk : !!file && !!filePassword);

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
    <StepPanel
      onSubmit={async () => {
        if (!ready) return;
        const acc = await run(() =>
          kind === "key"
            ? api.walletImportPrivateKey(name, keyHex, walletPassword)
            : api.walletImportKeyfile(name, file!.json, filePassword, walletPassword),
        );
        if (acc) {
          await wallet.refresh();
          navigate("/", { replace: true });
        }
      }}
    >
      <Part>
        <NameField value={name} onChange={setName} />
      </Part>
      {kind === "keyfile" ? (
        <Part className="gap-4">
          <p className="text-sm text-muted-foreground">{t("wallet.import.keyfileDesc")}</p>
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
        </Part>
      ) : (
        <Part className="gap-4">
          <Notice tone="warn">{t("wallet.import.keyWarn")}</Notice>
          <Field
            label={t("wallet.import.keyLabel")}
            error={key && !keyOk ? t("wallet.err.badKey") : null}
            hint={t("wallet.import.keyHint")}
          >
            {(id) => <PasswordInput id={id} value={key} onChange={setKey} placeholder="0x…" />}
          </Field>
        </Part>
      )}
      <Part className="gap-4">
        <Field label={t("wallet.walletPassword")} hint={t("wallet.import.reencrypt")}>
          {(id) => <PasswordInput id={id} value={password} onChange={setPassword} />}
        </Field>
        {error && <Notice tone="critical">{error}</Notice>}
      </Part>
      <StepFooter onBack={onBack}>
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? t("wallet.import.busy") : t("wallet.import.cta")}
        </button>
      </StepFooter>
    </StepPanel>
  );
}
