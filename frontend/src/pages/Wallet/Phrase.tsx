import { useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Eye, EyeOff, Loader2, ScrollText, ShieldCheck } from "lucide-react";
import { api, walletError } from "../../lib/api";
import { GLIDE, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { useWallet } from "../../lib/wallet";
import { useHiddenFromCapture } from "../../lib/desktop";
import { useT } from "../../i18n";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/bits";
import { Field, PasswordInput } from "./common";

/**
 * The recovery phrase on screen: its words, a check that they were written
 * down, the box to type one in, and the dialog that shows it again. The
 * words are kept out of the clipboard on purpose (no copy button, not
 * selectable): clipboard history and syncing are a common way phrases
 * leak. They live in component state only while shown.
 */

/**
 * PhraseGrid shows the words numbered, in reading order, veiled until the
 * user chooses to reveal them, so a glance over the shoulder or a screen
 * share doesn't catch them by accident.
 */
export function PhraseGrid({ words }: { words: string[] }) {
  const t = useT();
  const stagger = useStagger();
  const [shown, setShown] = useState(false);
  useHiddenFromCapture();
  return (
    <div className="relative">
      <motion.ol
        {...stagger}
        className={`grid grid-cols-3 gap-2 transition-[filter] duration-300 select-none ${shown ? "" : "blur-md"}`}
        aria-hidden={!shown}
      >
        {words.map((w, i) => (
          <motion.li
            key={i}
            variants={STAGGER.item}
            className="glass flex items-baseline gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2"
          >
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="font-mono font-medium">{w}</span>
          </motion.li>
        ))}
      </motion.ol>
      <AnimatePresence>
        {!shown && (
          <motion.button
            type="button"
            onClick={() => setShown(true)}
            className="absolute inset-0 grid place-items-center rounded-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={GLIDE}
          >
            <span className="btn btn-secondary">
              <Eye className="size-3.5" />
              {t("wallet.phrase.reveal")}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/** pickPositions chooses n distinct word positions at random, in order. */
function pickPositions(count: number, n: number): number[] {
  const picked = new Set<number>();
  const buf = new Uint32Array(1);
  while (picked.size < Math.min(n, count)) {
    crypto.getRandomValues(buf);
    picked.add(buf[0] % count);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * PhraseQuiz asks for three of the words, chosen at random, to check that
 * the phrase was written down, and in order. It reports when all three
 * match.
 */
export function PhraseQuiz({ words, onValid }: { words: string[]; onValid: (ok: boolean) => void }) {
  const t = useT();
  const positions = useMemo(() => pickPositions(words.length, 3), [words]);
  const [answers, setAnswers] = useState<string[]>(() => positions.map(() => ""));
  useHiddenFromCapture();
  const right = positions.map((p, i) => answers[i].trim().toLowerCase() === words[p]);

  useEffect(() => {
    onValid(right.every(Boolean));
  }, [right.join(), onValid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {positions.map((p, i) => (
        <QuizWord
          key={p}
          n={p + 1}
          value={answers[i]}
          right={right[i]}
          autoFocus={i === 0}
          onChange={(v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}
          label={t("wallet.phrase.word", { n: p + 1 })}
        />
      ))}
    </div>
  );
}

function QuizWord({
  n,
  value,
  right,
  autoFocus,
  onChange,
  label,
}: {
  n: number;
  value: string;
  right: boolean;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground tabular-nums">
          {n}
        </span>
        <input
          id={id}
          className={`input pl-8 font-mono transition-colors ${right ? "border-brand-mark" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <AnimatePresence>
          {right && (
            <motion.span
              className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center rounded-full bg-brand-fill text-brand-foreground"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={GLIDE}
              aria-hidden
            >
              <svg viewBox="0 0 24 24" className="size-2.5" fill="none">
                <path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * PhraseInput is the box a recovery phrase is typed or pasted into, masked
 * like a password until shown, with the count of words so far.
 */
export function PhraseInput({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  useHiddenFromCapture(shown);
  const count = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <textarea
          id={id}
          className={`input h-auto min-h-24 resize-none py-2 pr-9 font-mono leading-relaxed ${shown ? "" : "[-webkit-text-security:disc]"}`}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={t("wallet.phrase.placeholder")}
        />
        <button
          type="button"
          tabIndex={-1}
          className="btn btn-ghost btn-sm btn-icon absolute top-1.5 right-1.5"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? t("wallet.phrase.hide") : t("wallet.phrase.show")}
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
      <span className="text-sm text-muted-foreground tabular-nums">{t("wallet.phrase.count", { n: count })}</span>
    </div>
  );
}

/** PhraseWarning is what a phrase is worth, said where it shows. */
export function PhraseWarning() {
  const t = useT();
  return (
    <div className="flex items-start gap-2 text-sm text-warn-ink">
      <ShieldCheck className="mt-px size-4 shrink-0" />
      <span>{t("wallet.phrase.warning")}</span>
    </div>
  );
}

/**
 * RevealPhraseModal shows the recovery phrase once its password opens it,
 * and, if it was never confirmed, asks for three of its words to confirm it.
 */
export function RevealPhraseModal({
  open,
  onClose,
  seedId,
}: {
  open: boolean;
  onClose: () => void;
  seedId: string | null;
}) {
  const t = useT();
  const wallet = useWallet();
  const seed = wallet.info?.seeds.find((s) => s.id === seedId);
  return (
    <Modal
      open={open && !!seed}
      onClose={onClose}
      title={t("wallet.phrase.title")}
      subtitle={seed?.name}
      icon={<ScrollText className="size-4" />}
    >
      {seed && <Reveal seedId={seed.id} confirmed={seed.confirmed} onClose={onClose} />}
    </Modal>
  );
}

type RevealStep = "password" | "words" | "quiz" | "done";

function Reveal({ seedId, confirmed, onClose }: { seedId: string; confirmed: boolean; onClose: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [step, setStep] = useState<RevealStep>("password");
  const [password, setPassword] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [passphrase, setPassphrase] = useState("");
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing of the phrase outlives the dialog
  useEffect(
    () => () => {
      setPassword("");
      setWords([]);
      setPassphrase("");
    },
    [],
  );

  const submit = async () => {
    setError(null);
    if (step === "password") {
      if (!password || busy) return;
      setBusy(true);
      try {
        const shown = await api.walletRevealSeed(seedId, password);
        setWords(shown.words);
        setPassphrase(shown.passphrase);
        setPassword("");
        setStep("words");
      } catch (e) {
        setError(walletError(e, t));
      } finally {
        setBusy(false);
      }
    } else if (step === "words") {
      if (confirmed) onClose();
      else setStep("quiz");
    } else if (step === "quiz") {
      if (!valid || busy) return;
      setBusy(true);
      try {
        await api.walletConfirmSeed(seedId);
        await wallet.refresh();
        setWords([]);
        setStep("done");
      } catch (e) {
        setError(walletError(e, t));
      } finally {
        setBusy(false);
      }
    } else {
      onClose();
    }
  };

  const primary =
    step === "password"
      ? t("wallet.phrase.open")
      : step === "words"
        ? confirmed
          ? t("common.done")
          : t("wallet.phrase.written")
        : step === "quiz"
          ? t("wallet.phrase.confirm")
          : t("common.done");

  return (
    <ModalForm
      onSubmit={submit}
      footer={
        <>
          {step !== "done" && (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || (step === "password" && !password) || (step === "quiz" && !valid)}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {primary}
          </button>
        </>
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className="flex flex-col gap-4"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={SPRING}
        >
          {step === "password" && (
            <>
              <p>{t("wallet.phrase.openDesc")}</p>
              <Field label={t("wallet.walletPassword")}>
                {(id) => <PasswordInput id={id} value={password} onChange={setPassword} />}
              </Field>
            </>
          )}
          {step === "words" && (
            <>
              <p>{t("wallet.phrase.writeDown")}</p>
              <PhraseGrid words={words} />
              {passphrase && <ShownPassphrase value={passphrase} />}
              <PhraseWarning />
            </>
          )}
          {step === "quiz" && (
            <>
              <p>{t("wallet.phrase.quizDesc")}</p>
              <PhraseQuiz words={words} onValid={setValid} />
            </>
          )}
          {step === "done" && (
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <span className="text-[15px] font-semibold text-good-ink">{t("wallet.phrase.confirmed")}</span>
              <span className="max-w-xs text-muted-foreground">{t("wallet.phrase.confirmedDesc")}</span>
            </div>
          )}
          {error && <Notice tone="critical">{error}</Notice>}
        </motion.div>
      </AnimatePresence>
    </ModalForm>
  );
}

/** ShownPassphrase is a phrase's passphrase under its words, veiled until asked for. */
function ShownPassphrase({ value }: { value: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  useHiddenFromCapture();
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background/60 px-3 py-2">
      <span className="text-sm text-muted-foreground">{t("wallet.passphrase.label")}</span>
      <span className={`min-w-0 flex-1 truncate font-mono select-none ${shown ? "" : "blur-sm"}`}>{value}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t("wallet.phrase.hide") : t("wallet.passphrase.show")}
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}
