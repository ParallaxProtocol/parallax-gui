import { useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Eye, EyeOff, Loader2, ScrollText, ShieldCheck } from "lucide-react";
import { api, walletError } from "../../lib/api";
import { GLIDE, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { useWallet } from "../../lib/wallet";
import { useHiddenFromCapture } from "../../lib/desktop";
import { useAnimationsOff } from "../../lib/prefs";
import { useT } from "../../i18n";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/bits";
import { DrawnCheck, FLAT_FIELD, WalletPasswordPrompt } from "./common";

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
 * share doesn't catch them by accident. Plain words in columns, as a
 * recovery key on a Mac: the card around them is the caller's.
 */
export function PhraseGrid({ words }: { words: string[] }) {
  const t = useT();
  const stagger = useStagger();
  const [shown, setShown] = useState(false);
  useHiddenFromCapture();
  return (
    <div className="relative">
      {/* Revealed, the veil's blur lifts as a lens coming into focus */}
      <motion.div
        initial={false}
        animate={shown ? { filter: "blur(0px)", opacity: 1 } : { filter: "blur(8px)", opacity: 0.8 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.ol {...stagger} className="grid grid-cols-3 gap-x-6 gap-y-3 select-none" aria-hidden={!shown}>
          {words.map((w, i) => (
            <motion.li key={i} variants={STAGGER.item} className="flex items-baseline gap-2.5">
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="font-mono font-medium">{w}</span>
            </motion.li>
          ))}
        </motion.ol>
      </motion.div>
      <AnimatePresence>
        {!shown && (
          <motion.button
            type="button"
            onClick={() => setShown(true)}
            className="group absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.06, transition: { duration: 0.25, ease: "easeOut" } }}
            transition={GLIDE}
          >
            <Eye className="size-5 transition-transform group-hover:scale-110" />
            {t("wallet.phrase.reveal")}
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
    // As a Mac's settings group: a row for each word, its place on the left, a check drawn at its end once it's right
    <div className={`glass flex flex-col divide-y divide-border overflow-hidden ${FLAT_FIELD}`}>
      {positions.map((p, i) => (
        <QuizWord
          key={p}
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
  value,
  right,
  autoFocus,
  onChange,
  label,
}: {
  value: string;
  right: boolean;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-4 py-1 pr-3 pl-4">
      <label htmlFor={id} className="w-24 shrink-0 text-sm">
        {label}
      </label>
      <input
        id={id}
        className="input min-w-0 flex-1 font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <span
        aria-hidden
        className={`grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-200 ${
          right ? "bg-brand-fill text-brand-foreground" : ""
        }`}
      >
        <svg viewBox="0 0 24 24" className="size-3" fill="none">
          <AnimatePresence initial={false}>
            {right && (
              <motion.path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="currentColor"
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1, transition: { duration: 0.25, ease: "easeOut" } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              />
            )}
          </AnimatePresence>
        </svg>
      </span>
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
      title={t("wallet.phrase.show")}
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

  // While the password opens the phrase, the dialog holds only a spinner (ModalForm)
  const opening = busy && step === "password";
  const off = useAnimationsOff();

  return (
    <ModalForm
      onSubmit={submit}
      busy={opening}
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
              <WalletPasswordPrompt value={password} onChange={setPassword} autoFocus />
            </>
          )}
          {step === "words" && (
            // As setup's words: one card, the passphrase a row of it, the warning its footnote; each in turn
            <motion.div
              className="flex flex-col gap-4"
              variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
              initial={off ? false : "hidden"}
              animate="visible"
            >
              <motion.p variants={STAGGER.item}>{t("wallet.phrase.writeDown")}</motion.p>
              <motion.div variants={STAGGER.item} className="flex flex-col gap-2">
                <div className="glass flex flex-col divide-y divide-border overflow-hidden">
                  <div className="px-5 py-4">
                    <PhraseGrid words={words} />
                  </div>
                  {passphrase && <ShownPassphrase value={passphrase} />}
                </div>
                <div className="flex flex-col gap-1.5 px-4">
                  {passphrase && <p className="text-sm text-muted-foreground">{t("wallet.passphrase.remember")}</p>}
                  <PhraseWarning />
                </div>
              </motion.div>
            </motion.div>
          )}
          {step === "quiz" && (
            <>
              <p>{t("wallet.phrase.quizDesc")}</p>
              <PhraseQuiz words={words} onValid={setValid} />
            </>
          )}
          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <DrawnCheck />
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-semibold">{t("wallet.phrase.confirmed")}</span>
                <span className="max-w-xs text-sm text-muted-foreground">{t("wallet.phrase.confirmedDesc")}</span>
              </div>
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
    <div className="flex items-center gap-4 py-2 pr-2 pl-5">
      <span className="text-sm text-muted-foreground">{t("wallet.passphrase.label")}</span>
      <motion.span
        className="min-w-0 flex-1 truncate font-mono select-none"
        initial={false}
        animate={{ filter: shown ? "blur(0px)" : "blur(4px)" }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {value}
      </motion.span>
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
