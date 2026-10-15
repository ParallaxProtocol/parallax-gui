import { useCallback, useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Loader2, Server, ShieldCheck } from "lucide-react";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { api, GUIConfig, NodeStatus, SeedCandidate, walletError } from "../../lib/api";
import { formatInt } from "../../lib/format";
import { syncProgress } from "../../lib/live";
import { Counter } from "../../components/ui/Counter";
import { useAnimationsOff } from "../../lib/prefs";
import { Lang, useLang, useT } from "../../i18n";
import { LANG_NAMES } from "../../i18n/translations";
import { Meter, Notice } from "../../components/ui/bits";
import logo from "../../assets/logo.svg";
import Toggle from "../../components/ui/Toggle";
import { Checkbox, DrawnCheck, Field, MIN_PASSWORD, PasswordInput } from "../Wallet/common";
import { rate, Requirement, StrengthMeter } from "../Wallet/CreateStep";
import { Choice } from "../../components/ui/Choice";
import { PhraseGrid, PhraseInput, PhraseQuiz, PhraseWarning } from "../Wallet/Phrase";
import { AccountPicker, Found, PHRASE_LENGTHS, pickKey, picksOf } from "../Wallet/PhraseImport";

/**
 * The words the greeting cycles through, each in its own language: the
 * app's languages and a few more, as a first launch on a Mac greets in
 * many. The last word shown is the user's own language's, from the app's
 * translations.
 */
const GREETINGS: [string, string][] = [
  ["Welcome", "en"],
  ["Bienvenue", "fr"],
  ["Willkommen", "de"],
  ["Bem-vindo", "pt"],
  ["Bienvenido", "es"],
  ["Benvenuto", "it"],
  ["Добро пожаловать", "ru"],
  ["欢迎", "zh-Hans"],
  ["ようこそ", "ja"],
  ["환영합니다", "ko"],
];
/**
 * greetingsFor leaves out the greetings in the user's own languages (the
 * system's, the app's) and the word the greeting settles on: those come
 * once, at the end, settled, rather than also in passing. The rest come
 * in a random order, new each launch.
 */
function greetingsFor(own: string[], settled: string): [string, string][] {
  const primary = (tag: string) => tag.toLowerCase().split("-")[0];
  const mine = new Set(own.filter(Boolean).map(primary));
  const rest = GREETINGS.filter(([word, lang]) => !mine.has(primary(lang)) && word !== settled);
  const out = rest.length > 0 ? rest : [...GREETINGS];
  // Fisher-Yates
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/** How many accounts a phrase scan reads at a time. */
const SCAN_BATCH = 5;
/** How long the logo shows before the greetings, in ms. */
const LOGO_MS = 1900;
/** How long each greeting stays, in ms. */
const STEP_MS = 1150;
const EASE = [0.16, 1, 0.3, 1] as const;

type Stage =
  | "greet"
  | "choose"
  | "language"
  | "mode"
  | "datadir"
  | "networking"
  | "sync"
  | "wallet"
  | "password"
  | "confirm"
  | "offer"
  | "import"
  | "importAccounts"
  | "phrase"
  | "quiz"
  | "done";

/** Where Back goes from each stage that has one. */
const BACK: Partial<Record<Stage, Stage>> = {
  language: "choose",
  mode: "language",
  datadir: "mode",
  networking: "datadir",
  confirm: "password",
  import: "offer",
  importAccounts: "import",
  quiz: "phrase",
};

/**
 * Hello is the app's first screen: the window to itself, "Welcome" in many
 * languages, then whatever the first launch needs, in full-screen steps of
 * one question each. On a new install that is the node's setup (language,
 * data directory, networking; everything else as it comes), after which
 * the node starts. While the wallet is new it is then the wallet password
 * and a recovery phrase, made and confirmed or imported: none of it can be
 * skipped. onDone tells whether a wallet password was made.
 */
export default function Hello({
  node,
  wallet,
  onDone,
}: {
  /** Whether the node still needs its first setup. */
  node: boolean;
  /** Whether the wallet is new: no password, no keys. */
  wallet: boolean;
  onDone: (created: boolean) => void;
}) {
  const t = useT();
  const off = useAnimationsOff();
  const [stage, setStage] = useState<Stage>(off ? "choose" : "greet");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState<{
    seedId: string;
    words: string[];
  } | null>(null);
  // A phrase being imported, and the accounts found in it
  const [words, setWords] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [found, setFound] = useState<Found>({ standard: [], ledgerlive: [], legacy: [] });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cfg, setCfg] = useState<GUIConfig | null>(null);
  const settle = useCallback(() => setStage((s) => (s === "greet" ? "choose" : s)), []);
  useEffect(() => {
    if (node)
      api
        .getConfig()
        .then(setCfg)
        .catch(() => {});
  }, [node]);
  // Nothing typed or shown here outlives the screen
  useEffect(
    () => () => {
      setPassword("");
      setPhrase(null);
      setWords("");
      setPassphrase("");
    },
    [],
  );
  const finish = () => {
    setPassword("");
    setPhrase(null);
    setWords("");
    setPassphrase("");
    setStage("done");
  };
  const back = BACK[stage] ?? (stage === "password" ? (node ? "wallet" : "choose") : undefined);

  const createPassword = (
    <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={() => setStage("password")} autoFocus>
      {t("hello.create")}
      <ArrowRight className="size-4" />
    </button>
  );

  return (
    <div className="hello fixed inset-0 overflow-hidden bg-background">
      <Glow />
      {/* The window's title bar: draggable, with room for its controls */}
      <div className="drag absolute inset-x-0 top-0 z-10 flex h-13 items-center">
        <span className="traffic-light-gap" />
        <span className="flex-1" />
        <span className="window-controls-gap" />
      </div>

      <AnimatePresence>
        {back && (
          <motion.button
            type="button"
            className="btn btn-ghost absolute top-14 left-6 z-10"
            onClick={() => setStage(back)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ArrowLeft className="size-3.5" />
            {t("common.back")}
          </motion.button>
        )}
      </AnimatePresence>

      <div className="relative grid h-full place-items-center px-6">
        <AnimatePresence mode="wait">
          {stage === "greet" || stage === "choose" ? (
            <Greeting
              key="greet"
              settled={stage === "choose"}
              onSettle={settle}
              lead={node ? t("hello.leadNode") : t("hello.wallet.desc")}
            >
              {node ? (
                <button
                  type="button"
                  className="btn btn-primary btn-lg min-w-64"
                  onClick={() => setStage("language")}
                  autoFocus
                >
                  {t("onboarding.welcome.cta")}
                  <ArrowRight className="size-4" />
                </button>
              ) : (
                createPassword
              )}
            </Greeting>
          ) : stage === "language" ? (
            <Language key="language" onNext={() => setStage("mode")} />
          ) : stage === "mode" && cfg ? (
            <Mode
              key="mode"
              onOnline={() => setStage("datadir")}
              onOffline={async () => {
                // An offline signer has no node to set up: straight to the wallet
                await api.saveBootstrap({ ...cfg, offlineSigner: true, autoStartNode: false });
                window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
                if (wallet) setStage("wallet");
                else onDone(false);
              }}
            />
          ) : stage === "datadir" && cfg ? (
            <DataDir
              key="datadir"
              value={cfg.dataDir}
              onChange={(dataDir) => setCfg({ ...cfg, dataDir })}
              onNext={() => setStage("networking")}
            />
          ) : stage === "networking" && cfg ? (
            <Networking
              key="networking"
              cfg={cfg}
              onChange={setCfg}
              onStarted={(running) => (running ? setStage("sync") : wallet ? setStage("wallet") : onDone(false))}
            />
          ) : stage === "sync" ? (
            <Sync key="sync" onNext={() => (wallet ? setStage("wallet") : onDone(false))} />
          ) : stage === "wallet" ? (
            <Screen key="wallet" title={t("hello.wallet.title")} desc={t("hello.wallet.desc")} top={<DrawnCheck />}>
              {createPassword}
            </Screen>
          ) : stage === "password" ? (
            <ChoosePassword key="password" value={password} onChange={setPassword} onNext={() => setStage("confirm")} />
          ) : stage === "confirm" ? (
            <ConfirmPassword key="confirm" password={password} onDone={() => setStage("offer")} />
          ) : stage === "offer" ? (
            <Offer
              key="offer"
              password={password}
              onMade={(made) => {
                setPassword("");
                setPhrase(made);
                setStage("phrase");
              }}
              onImport={() => setStage("import")}
            />
          ) : stage === "import" ? (
            <ImportPhrase
              key="import"
              words={words}
              onWords={setWords}
              passphrase={passphrase}
              onPassphrase={setPassphrase}
              onFound={(standard) => {
                setFound({ standard, ledgerlive: [], legacy: [] });
                // The first standard account is always offered, used or not, with every used one
                setPicked(new Set(standard.filter((c, i) => (i === 0 || c.used) && !c.inWallet).map(pickKey)));
                setStage("importAccounts");
              }}
            />
          ) : stage === "importAccounts" ? (
            <ImportAccounts
              key="importAccounts"
              words={words}
              passphrase={passphrase}
              password={password}
              found={found}
              setFound={setFound}
              picked={picked}
              setPicked={setPicked}
              onImported={finish}
            />
          ) : stage === "phrase" && phrase ? (
            <Screen key="phrase" title={t("wallet.phrase.yours")} desc={t("wallet.phrase.writeDown")} wide>
              <div className="flex w-full flex-col gap-4">
                <PhraseGrid words={phrase.words} />
                <PhraseWarning />
              </div>
              <div className="flex flex-col items-center gap-3">
                <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={() => setStage("quiz")}>
                  {t("wallet.phrase.written")}
                  <ArrowRight className="size-4" />
                </button>
              </div>
            </Screen>
          ) : stage === "quiz" && phrase ? (
            <Quiz key="quiz" phrase={phrase} onConfirmed={finish} />
          ) : stage === "done" ? (
            <Screen
              key="done"
              title={t("wallet.phrase.ready")}
              desc={t("wallet.phrase.readyDesc")}
              top={<DrawnCheck />}
            >
              <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={() => onDone(true)} autoFocus>
                {t("common.continue")}
                <ArrowRight className="size-4" />
              </button>
            </Screen>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Glow is a slow, soft drift of the brand's colours behind everything. */
function Glow() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-1/2 size-[56rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
      style={{
        background:
          "radial-gradient(closest-side, color-mix(in oklab, var(--app-brand-mark) 20%, transparent) 0%, color-mix(in oklab, var(--app-brand-mark) 14%, transparent) 20%, color-mix(in oklab, #5b5bf0 9%, transparent) 42%, color-mix(in oklab, #5b5bf0 4%, transparent) 64%, color-mix(in oklab, #5b5bf0 1.5%, transparent) 82%, transparent 100%)",
      }}
      animate={{ scale: [1, 1.08, 1], rotate: [0, 12, 0] }}
      transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/**
 * Greeting shows the logo, alone, then the welcomes one after another,
 * then settles on the user's own language and reveals what to do next
 * (children).
 */
function Greeting({
  settled,
  onSettle,
  lead,
  children,
}: {
  settled: boolean;
  onSettle: () => void;
  lead: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const { lang: appLang } = useLang();
  const [greetings] = useState(() =>
    greetingsFor([...(navigator.languages ?? []), navigator.language, appLang], t("nav.welcome")),
  );
  // -1 is the logo, before the first word
  const [i, setI] = useState(-1);
  // The rest arrives with the word that stays: at once if the greeting is skipped entirely
  const [arrived, setArrived] = useState(settled);

  useEffect(() => {
    if (settled) return;
    if (i >= greetings.length) {
      onSettle();
      return;
    }
    const id = setTimeout(() => setI((n) => n + 1), i < 0 ? LOGO_MS : STEP_MS);
    return () => clearTimeout(id);
  }, [i, settled, onSettle]);

  const intro = !settled && i < 0;
  const [word, lang] = settled ? [t("nav.welcome"), undefined] : (greetings[i] ?? greetings[greetings.length - 1]);

  return (
    <motion.div
      className="flex flex-col items-center gap-12"
      exit={{
        opacity: 0,
        scale: 0.98,
        filter: "blur(6px)",
        transition: { duration: 0.35 },
      }}
    >
      {/* The word glides up to make room rather than jump */}
      <motion.div layout="position" transition={{ duration: 0.7, ease: EASE }} className="grid h-28 place-items-center">
        <AnimatePresence mode="wait">
          {intro ? (
            <motion.span
              key="logo"
              aria-hidden
              className="block size-32 bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)]"
              style={{
                mask: `url("${logo}") center / contain no-repeat`,
                WebkitMask: `url("${logo}") center / contain no-repeat`,
              }}
              initial={{ opacity: 0, scale: 0.9, filter: "blur(12px)" }}
              animate={{
                opacity: 1,
                scale: 1,
                filter: "blur(0px)",
                transition: { duration: 0.9, ease: EASE },
              }}
              exit={{
                opacity: 0,
                scale: 1.04,
                filter: "blur(10px)",
                transition: { duration: 0.5, ease: "easeIn" },
              }}
            />
          ) : (
            <motion.h1
              key={settled ? "settled" : i}
              lang={lang}
              className="bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] bg-clip-text px-2 pb-2 text-center text-6xl font-semibold tracking-tight text-transparent sm:text-7xl"
              initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                transition: { duration: 0.55, ease: EASE },
              }}
              exit={{
                opacity: 0,
                y: -14,
                filter: "blur(10px)",
                transition: { duration: 0.35, ease: "easeIn" },
              }}
              onAnimationStart={() => settled && setArrived(true)}
            >
              {word}
            </motion.h1>
          )}
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {arrived && (
          <motion.div
            layout="position"
            className="flex flex-col items-center gap-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { delay: 0.3, duration: 0.6, ease: EASE },
            }}
          >
            <p className="max-w-md text-center text-muted-foreground">{lead}</p>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Screen is one step of the password sequence: a big title, a line, and its controls, centred. */
function Screen({
  title,
  desc,
  top,
  wide,
  children,
}: {
  title: string;
  desc: string;
  top?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className={`flex w-full flex-col items-center gap-8 ${wide ? "max-w-xl" : "max-w-md"}`}
      initial={{ opacity: 0, x: 24, filter: "blur(6px)" }}
      animate={{
        opacity: 1,
        x: 0,
        filter: "blur(0px)",
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
      }}
      exit={{
        opacity: 0,
        x: -24,
        filter: "blur(6px)",
        transition: { duration: 0.25, ease: "easeIn" },
      }}
    >
      {top}
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-sm whitespace-pre-line text-muted-foreground">{desc}</p>
      </div>
      {children}
    </motion.div>
  );
}

function ChoosePassword({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const t = useT();
  const id = useId();
  const longEnough = [...value].length >= MIN_PASSWORD;
  return (
    <Screen title={t("hello.password.title")} desc={t("hello.password.desc")}>
      <form
        className="flex w-full flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (longEnough) onNext();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("wallet.walletPassword")}
        </label>
        <div className="[&_.input]:h-11 [&_.input]:text-base">
          <PasswordInput
            id={id}
            value={value}
            onChange={onChange}
            isNew
            autoFocus
            placeholder={t("wallet.walletPassword")}
          />
        </div>
        <StrengthMeter strength={rate(value)} empty={value.length === 0} />
        <ul className="flex flex-col gap-1.5">
          <Requirement met={longEnough} label={t("wallet.create.req.length", { n: MIN_PASSWORD })} />
        </ul>
        <p className="text-sm text-warn-ink">{t("wallet.setup.noRecovery")}</p>
        <button type="submit" className="btn btn-primary btn-lg mt-2 min-w-64 self-center" disabled={!longEnough}>
          {t("common.continue")}
          <ArrowRight className="size-4" />
        </button>
      </form>
    </Screen>
  );
}

function ConfirmPassword({ password, onDone }: { password: string; onDone: () => void }) {
  const t = useT();
  const id = useId();
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => setAgain(""), []);
  const matches = again.length > 0 && again === password;

  return (
    <Screen title={t("hello.confirm.title")} desc={t("hello.confirm.desc")}>
      <form
        className="flex w-full flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!matches || busy) return;
          setBusy(true);
          setError(null);
          try {
            await api.walletSetupPassword(password);
            setAgain("");
            onDone();
          } catch (err) {
            setError(walletError(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("wallet.password.confirm")}
        </label>
        <div className="[&_.input]:h-11 [&_.input]:text-base">
          <PasswordInput
            id={id}
            value={again}
            onChange={setAgain}
            isNew
            autoFocus
            placeholder={t("wallet.password.confirm")}
          />
        </div>
        <ul className="flex flex-col gap-1.5">
          <Requirement met={matches} label={t("wallet.create.req.match")} />
        </ul>
        {error && <Notice tone="critical">{error}</Notice>}
        <button type="submit" className="btn btn-primary btn-lg mt-2 min-w-64 self-center" disabled={!matches || busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("hello.confirm.cta")}
        </button>
      </form>
    </Screen>
  );
}

/**
 * Offer comes right after the password: a recovery phrase is next, made
 * here with the password just set, or one the user already has, imported.
 */
function Offer({
  password,
  onMade,
  onImport,
}: {
  password: string;
  onMade: (phrase: { seedId: string; words: string[] }) => void;
  onImport: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title={t("hello.offer.title")} desc={t("hello.offer.desc")} top={<DrawnCheck />}>
      {error && <Notice tone="critical">{error}</Notice>}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          className="btn btn-primary btn-lg min-w-64"
          disabled={busy}
          autoFocus
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const made = await api.walletCreateSeed("", password, "");
              onMade({ seedId: made.seedId, words: made.words });
            } catch (e) {
              setError(walletError(e, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("wallet.offer.cta")}
          {!busy && <ArrowRight className="size-4" />}
        </button>
        <button type="button" className="btn btn-secondary btn-lg min-w-64" onClick={onImport} disabled={busy}>
          {t("hello.offer.import")}
        </button>
      </div>
    </Screen>
  );
}

/** ImportPhrase takes the words of a phrase the user has, and its passphrase if it has one, then finds its accounts. */
function ImportPhrase({
  words,
  onWords,
  passphrase,
  onPassphrase,
  onFound,
}: {
  words: string;
  onWords: (v: string) => void;
  passphrase: string;
  onPassphrase: (v: string) => void;
  onFound: (standard: SeedCandidate[]) => void;
}) {
  const t = useT();
  const id = useId();
  const [advanced, setAdvanced] = useState(passphrase !== "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = words.trim() ? words.trim().split(/\s+/).length : 0;
  const ready = PHRASE_LENGTHS.includes(count) && (!advanced || passphrase !== "");
  return (
    <Screen title={t("hello.offer.import")} desc={t("wallet.import.phraseLead")} wide>
      <form
        className="flex w-full flex-col items-center gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready || busy) return;
          setBusy(true);
          setError(null);
          try {
            onFound(await api.walletScanSeed(words, advanced ? passphrase : "", "standard", 0, SCAN_BATCH));
          } catch (err) {
            setError(walletError(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex w-full flex-col gap-4 text-left">
          <label htmlFor={id} className="sr-only">
            {t("wallet.import.phraseLabel")}
          </label>
          <PhraseInput id={id} value={words} onChange={onWords} />
          <Checkbox
            checked={advanced}
            onChange={(on) => {
              setAdvanced(on);
              if (!on) onPassphrase("");
            }}
          >
            <span className="font-medium">{t("wallet.passphrase.importToggle")}</span>
            <span className="block text-sm text-muted-foreground">{t("wallet.passphrase.importToggleDesc")}</span>
          </Checkbox>
          {advanced && (
            <Field label={t("wallet.passphrase.label")} hint={t("wallet.passphrase.importHint")}>
              {(fid) => <PasswordInput id={fid} value={passphrase} onChange={onPassphrase} />}
            </Field>
          )}
          {error && <Notice tone="critical">{error}</Notice>}
        </div>
        <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!ready || busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("common.continue")}
          {!busy && <ArrowRight className="size-4" />}
        </button>
      </form>
    </Screen>
  );
}

/** ImportAccounts picks which of the phrase's accounts to bring in, then imports them under the wallet password. */
function ImportAccounts({
  words,
  passphrase,
  password,
  found,
  setFound,
  picked,
  setPicked,
  onImported,
}: {
  words: string;
  passphrase: string;
  password: string;
  found: Found;
  setFound: React.Dispatch<React.SetStateAction<Found>>;
  picked: Set<string>;
  setPicked: React.Dispatch<React.SetStateAction<Set<string>>>;
  onImported: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picks = picksOf(found, picked);
  return (
    <Screen title={t("wallet.import.chooseTitle")} desc={t("wallet.import.chooseDesc")} wide>
      <div className="glass max-h-[46vh] w-full overflow-y-auto text-left">
        <AccountPicker
          found={found}
          picked={picked}
          onToggle={(c) =>
            setPicked((p) => {
              const next = new Set(p);
              if (next.has(pickKey(c))) next.delete(pickKey(c));
              else next.add(pickKey(c));
              return next;
            })
          }
          onScan={async (scheme, from) => {
            setError(null);
            try {
              const batch = await api.walletScanSeed(words, passphrase, scheme, from, SCAN_BATCH);
              setFound((f) => ({ ...f, [scheme]: [...f[scheme].filter((c) => c.index < from), ...batch] }));
              setPicked((p) => {
                const next = new Set(p);
                for (const c of batch) if (c.used && !c.inWallet) next.add(pickKey(c));
                return next;
              });
            } catch (e) {
              setError(walletError(e, t));
            }
          }}
          error={null}
        />
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          className="btn btn-primary btn-lg min-w-64"
          disabled={busy || picks.length === 0}
          autoFocus
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.walletImportSeed("", words, passphrase, password, picks);
              onImported();
            } catch (e) {
              setError(walletError(e, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? t("wallet.import.busy") : t("wallet.import.cta")}
        </button>
        <span className="text-sm text-muted-foreground">{t("wallet.import.picked", { n: picks.length })}</span>
      </div>
    </Screen>
  );
}

/** Quiz asks for three of the phrase's words, then marks it confirmed. */
function Quiz({ phrase, onConfirmed }: { phrase: { seedId: string; words: string[] }; onConfirmed: () => void }) {
  const t = useT();
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title={t("wallet.phrase.quizTitle")} desc={t("wallet.phrase.quizDesc")} wide>
      <form
        className="flex w-full flex-col items-center gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          setError(null);
          try {
            await api.walletConfirmSeed(phrase.seedId);
            onConfirmed();
          } catch (err) {
            setError(walletError(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="w-full">
          <PhraseQuiz words={phrase.words} onValid={setValid} />
        </div>
        {error && <Notice tone="critical">{error}</Notice>}
        <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!valid || busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("wallet.phrase.confirm")}
        </button>
      </form>
    </Screen>
  );
}

/** Language picks the app's language: it applies at once, the greeting's word included. */
function Language({ onNext }: { onNext: () => void }) {
  const t = useT();
  const { lang, setLang } = useLang();
  return (
    <Screen title={t("onboarding.language.title")} desc={t("onboarding.language.desc")}>
      <div role="radiogroup" aria-label={t("onboarding.language.title")} className="flex w-full flex-col gap-2">
        {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
          <Choice key={l} selected={lang === l} onClick={() => setLang(l)} title={LANG_NAMES[l]} />
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={onNext} autoFocus>
        {t("common.continue")}
        <ArrowRight className="size-4" />
      </button>
    </Screen>
  );
}

/**
 * Mode asks what this computer is for: a wallet with its own node, or an
 * offline signer that never goes online and signs what a watch-only
 * wallet elsewhere asks it to.
 */
function Mode({ onOnline, onOffline }: { onOnline: () => void; onOffline: () => Promise<void> }) {
  const t = useT();
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title={t("onboarding.mode.title")} desc={t("onboarding.mode.desc")} wide>
      <div role="radiogroup" aria-label={t("onboarding.mode.title")} className="flex w-full flex-col gap-2">
        <Choice
          selected={mode === "online"}
          onClick={() => setMode("online")}
          icon={<Server className="size-5 shrink-0 text-muted-foreground" />}
          title={t("onboarding.mode.online")}
          desc={t("onboarding.mode.onlineDesc")}
        />
        <Choice
          selected={mode === "offline"}
          onClick={() => setMode("offline")}
          icon={<ShieldCheck className="size-5 shrink-0 text-muted-foreground" />}
          title={t("onboarding.mode.offline")}
          desc={t("onboarding.mode.offlineDesc")}
        />
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
      <button
        type="button"
        className="btn btn-primary btn-lg min-w-64"
        disabled={busy}
        onClick={async () => {
          if (mode === "online") return onOnline();
          setBusy(true);
          setError(null);
          try {
            await onOffline();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
        autoFocus
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t("common.continue")}
        <ArrowRight className="size-4" />
      </button>
    </Screen>
  );
}

/** DataDir asks where the node keeps the chain. */
function DataDir({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  const t = useT();
  const id = useId();
  return (
    <Screen title={t("onboarding.datadir.title")} desc={t("onboarding.datadir.desc")}>
      <form
        className="flex w-full flex-col items-center gap-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onNext();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("settings.dataDir")}
        </label>
        <input
          id={id}
          className="input h-11 w-full px-3.5 font-mono text-base"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        <button type="submit" className="btn btn-primary btn-lg min-w-64" disabled={!value.trim()}>
          {t("common.continue")}
          <ArrowRight className="size-4" />
        </button>
      </form>
    </Screen>
  );
}

/**
 * Networking asks whether other peers may dial the node, then saves the
 * setup and starts the node. If the node won't start, the reason shows and
 * the next click goes on regardless: the node can be started again from
 * the sidebar.
 */
function Networking({
  cfg,
  onChange,
  onStarted,
}: {
  cfg: GUIConfig;
  onChange: (cfg: GUIConfig) => void;
  /** Called with whether the node is running: false when it wouldn't start and the user went on regardless. */
  onStarted: (running: boolean) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const start = async () => {
    if (saved) return onStarted(false);
    setBusy(true);
    setError(null);
    try {
      await api.saveBootstrap({ ...cfg, dataDir: cfg.dataDir.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    try {
      await api.startNode();
      onStarted(true);
    } catch (e) {
      setSaved(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t("onboarding.networking.title")} desc={t("onboarding.networking.desc")} wide>
      <div className="glass flex w-full flex-col gap-3 rounded-lg border border-border bg-surface/60 p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="font-medium">{t("onboarding.networking.toggle")}</span>
            <span className="text-sm text-muted-foreground">{t("onboarding.networking.recommended")}</span>
          </span>
          <Toggle
            checked={!cfg.blockInbound}
            onChange={(v) => onChange({ ...cfg, blockInbound: !v })}
            label={t("onboarding.networking.toggle")}
          />
        </div>
        <p className="text-sm text-muted-foreground">{t("onboarding.networking.desc2")}</p>
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
      <button type="button" className="btn btn-primary btn-lg min-w-64" onClick={start} disabled={busy} autoFocus>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? t("onboarding.starting.title") : saved ? t("common.continue") : t("onboarding.rpc.cta")}
        {!busy && <ArrowRight className="size-4" />}
      </button>
    </Screen>
  );
}

/** How often Sync asks the node how far it is, in ms. */
const SYNC_POLL_MS = 1000;

/**
 * synced is whether the node has caught up: running, with peers, past
 * genesis and at the head the peers report. The block guard keeps a node
 * that has peers but hasn't started downloading from looking caught up.
 */
function synced(node: NodeStatus | null): boolean {
  if (!node?.running || node.syncing) return false;
  // The development chain is its own head, from genesis on, with no peers
  return node.devChain || (node.peers > 0 && node.currentBlock > 0);
}

/**
 * Sync follows the node's first sync, from looking for peers to the
 * network's head, then offers the way on. Until then the user can go on
 * regardless, the sync carrying on behind. If the node stops meanwhile it
 * can be started again from here.
 */
function Sync({ onNext }: { onNext: () => void }) {
  const t = useT();
  const [node, setNode] = useState<NodeStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .nodeStatus()
        .then((ns) => alive && setNode(ns))
        .catch(() => {});
    poll();
    const id = setInterval(poll, SYNC_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const done = synced(node);
  const stopped = !!node && !node.running;
  const searching = !node || (node.peers === 0 && !node.devChain);
  const progress = done ? 1 : syncProgress(node);
  const left = node ? Math.max(0, node.highestBlock - node.currentBlock) : 0;

  const restart = async () => {
    setStarting(true);
    setError(null);
    try {
      await api.startNode();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen
      title={done ? t("hello.sync.doneTitle") : t("hello.sync.title")}
      desc={
        done
          ? t("hello.sync.doneDesc")
          : stopped
            ? t("overview.stopped.title")
            : searching
              ? t("overview.sync.searchingDesc")
              : t("overview.sync.desc")
      }
      top={done ? <DrawnCheck /> : undefined}
      wide
    >
      <div className="glass flex w-full flex-col gap-4 p-5">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              {!done && !stopped && <Loader2 className="size-3.5 animate-spin" />}
              {done
                ? t("node.state.synced")
                : stopped
                  ? t("node.state.stopped")
                  : searching
                    ? t("overview.sync.searching")
                    : t("node.state.syncing")}
            </span>
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              <Counter value={progress * 100} format={(v) => `${v.toFixed(1)}%`} />
            </span>
          </div>
          <div className="flex flex-col items-end gap-1 text-sm text-muted-foreground tabular-nums">
            <span>
              <span className="text-foreground">{formatInt(node?.currentBlock ?? 0)}</span> /{" "}
              {node && node.highestBlock > 0 ? formatInt(node.highestBlock) : "—"}
            </span>
            {!done && !searching && left > 0 && <span>{t("overview.sync.left", { n: formatInt(left) })}</span>}
          </div>
        </div>
        <Meter value={searching && !done ? undefined : progress} live={!done} thick label={t("node.state.syncing")} />
      </div>
      {error && <Notice tone="critical">{error}</Notice>}
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.button
            key="next"
            type="button"
            className="btn btn-primary btn-lg min-w-64"
            onClick={onNext}
            autoFocus
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } }}
          >
            {t("common.continue")}
            <ArrowRight className="size-4" />
          </motion.button>
        ) : stopped ? (
          <motion.button
            key="start"
            type="button"
            className="btn btn-primary btn-lg min-w-64"
            onClick={restart}
            disabled={starting}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {starting && <Loader2 className="size-4 animate-spin" />}
            {t("onboarding.rpc.cta")}
          </motion.button>
        ) : (
          <motion.button
            key="background"
            type="button"
            className="btn btn-ghost"
            onClick={onNext}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {t("hello.sync.background")}
          </motion.button>
        )}
      </AnimatePresence>
    </Screen>
  );
}
