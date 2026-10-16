import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, HardDrive, KeyRound, Loader2, Lock, ScrollText, TriangleAlert } from "lucide-react";
import { GLIDE, SPRING, STAGGER } from "../../lib/motion";
import { useT } from "../../i18n";
import { Notice } from "../../components/ui/bits";
import { api, walletError } from "../../lib/api";
import { Checkbox, MIN_PASSWORD, PasswordInput } from "./common";
import { Part, StepFooter, StepPanel } from "./flow";
import { IconBadge } from "../../components/ui/IconBadge";
import { rate, useDefaultName, type Strength } from "./accountActions";

/**
 * CreateIntro opens the making of an account: what is about to happen, on
 * a vertical timeline (a key made here, locked with a password, kept on
 * this computer), before anything is asked for.
 */
export function CreateIntro({
  kind,
  onBack,
  onContinue,
}: {
  kind: "phrase" | "key";
  onBack: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  return (
    <StepPanel>
      <Part className="gap-5">
        <p className="text-muted-foreground">{t("wallet.create.lead")}</p>
        <motion.ol variants={STAGGER.container} className="flex flex-col">
          {kind === "phrase" ? (
            <Fact icon={ScrollText} title={t("wallet.create.fact1")} desc={t("wallet.create.fact1Desc")} />
          ) : (
            <Fact icon={KeyRound} title={t("wallet.create.keyFact1")} desc={t("wallet.create.keyFact1Desc")} />
          )}
          <Fact
            icon={Lock}
            title={t("wallet.create.fact2")}
            desc={kind === "phrase" ? t("wallet.create.fact2Desc") : t("wallet.create.keyFact2Desc")}
          />
          <Fact icon={HardDrive} title={t("wallet.create.fact3")} desc={t("wallet.create.fact3Desc")} last />
        </motion.ol>
      </Part>
      <StepFooter onBack={onBack} hint={t("wallet.create.introNext")}>
        <button type="button" className="btn btn-primary" onClick={onContinue} autoFocus>
          {t("common.continue")}
          <ArrowRight className="size-3.5" />
        </button>
      </StepFooter>
    </StepPanel>
  );
}

/**
 * SetupPasswordStep sets the wallet password, the first step before any
 * account is made or imported: typed twice, its strength shown and its
 * requirements ticking off as they are met. With keys already in the
 * wallet (from an earlier build) it must be the password they are under.
 * Once the wallet takes it, the wallet is unlocked with it.
 */
export function SetupPasswordStep({
  existing,
  onBack,
  onSet,
}: {
  /** Keys are already in the wallet: the password must open them. */
  existing: boolean;
  onBack: () => void;
  onSet: () => void;
}) {
  const t = useT();
  const passId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longEnough = [...password].length >= MIN_PASSWORD;
  const matches = confirm.length > 0 && confirm === password;
  const ready = longEnough && matches && !busy;
  const strength = rate(password);

  return (
    <StepPanel
      onSubmit={async () => {
        if (!ready) return;
        setBusy(true);
        setError(null);
        try {
          await api.walletSetupPassword(password);
          onSet();
        } catch (e) {
          setError(walletError(e, t));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Part>
        <p className="text-muted-foreground">{existing ? t("wallet.setup.existingDesc") : t("wallet.setup.desc")}</p>
      </Part>
      <Part className="gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={passId} className="text-sm font-medium">
            {t("wallet.walletPassword")}
          </label>
          <PasswordInput id={passId} value={password} onChange={setPassword} isNew autoFocus />
          <StrengthMeter strength={strength} empty={password.length === 0} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={confirmId} className="text-sm font-medium">
            {t("wallet.password.confirm")}
          </label>
          <PasswordInput id={confirmId} value={confirm} onChange={setConfirm} isNew />
        </div>
        <ul className="flex flex-col gap-1.5">
          <Requirement met={longEnough} label={t("wallet.create.req.length", { n: MIN_PASSWORD })} />
          <Requirement met={matches} label={t("wallet.create.req.match")} />
        </ul>
        <div className="flex items-start gap-2 text-sm text-warn-ink">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          <span>{t("wallet.setup.noRecovery")}</span>
        </div>
        {error && <Notice tone="critical">{error}</Notice>}
      </Part>
      <StepFooter onBack={onBack}>
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {t("wallet.setup.cta")}
          {!busy && <ArrowRight className="size-3.5" />}
        </button>
      </StepFooter>
    </StepPanel>
  );
}

/**
 * DetailsStep asks for what making an account needs: an optional name,
 * and, for a new recovery phrase, an optional BIP-39 passphrase behind
 * Advanced. It reports them; the unlocked wallet's password encrypts it.
 */
export function DetailsStep({
  busy,
  error,
  next,
  allowPassphrase,
  cta,
  onBack,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  /** What comes after, in the footer. */
  next?: string;
  allowPassphrase?: boolean;
  cta?: string;
  onBack: () => void;
  onSubmit: (name: string, passphrase: string) => void;
}) {
  const t = useT();
  const defaultName = useDefaultName();
  const nameId = useId();
  const [name, setName] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [passphrase, setPassphrase] = useState("");

  const ready = !busy && (!advanced || !!passphrase);

  return (
    <StepPanel onSubmit={() => ready && onSubmit(name, advanced ? passphrase : "")}>
      <Part className="gap-1.5">
        <label htmlFor={nameId} className="flex items-center gap-2 font-medium">
          {t("wallet.name")}
          <span className="text-sm font-normal text-muted-foreground">{t("wallet.create.optional")}</span>
        </label>
        <input
          id={nameId}
          className="input"
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName}
          spellCheck={false}
          autoFocus
        />
        <span className="text-sm text-muted-foreground">{t("wallet.name.hint")}</span>
      </Part>

      {allowPassphrase && (
        <Part className="gap-3">
          <Checkbox checked={advanced} onChange={setAdvanced}>
            <span className="font-medium">{t("wallet.passphrase.toggle")}</span>
            <span className="block text-sm text-muted-foreground">{t("wallet.passphrase.toggleDesc")}</span>
          </Checkbox>
          <AnimatePresence initial={false}>
            {advanced && (
              <motion.div
                className="flex flex-col gap-3 overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SPRING}
              >
                <PassphraseFields onChange={setPassphrase} />
              </motion.div>
            )}
          </AnimatePresence>
        </Part>
      )}

      {error && (
        <Part>
          <Notice tone="critical">{error}</Notice>
        </Part>
      )}

      <StepFooter onBack={onBack} hint={next}>
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? t("wallet.create.busy") : (cta ?? t("wallet.create.cta"))}
          {!busy && <ArrowRight className="size-3.5" />}
        </button>
      </StepFooter>
    </StepPanel>
  );
}

/**
 * PassphraseFields takes a new BIP-39 passphrase, typed twice: it changes
 * every account the phrase gives, and nothing can tell a mistyped one, so
 * it is worth typing twice. It reports it once both agree, else "".
 */
export function PassphraseFields({ onChange }: { onChange: (passphrase: string) => void }) {
  const t = useT();
  const aId = useId();
  const bId = useId();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const mismatch = b.length > 0 && a !== b;
  return (
    <>
      <div className="flex items-start gap-2 text-sm text-warn-ink">
        <TriangleAlert className="mt-px size-4 shrink-0" />
        <span>{t("wallet.passphrase.warning")}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={aId} className="text-sm font-medium">
          {t("wallet.passphrase.label")}
        </label>
        <PasswordInput
          id={aId}
          value={a}
          onChange={(v) => {
            setA(v);
            onChange(v && v === b ? v : "");
          }}
          isNew
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={bId} className="text-sm font-medium">
          {t("wallet.passphrase.confirm")}
        </label>
        <PasswordInput
          id={bId}
          value={b}
          onChange={(v) => {
            setB(v);
            onChange(a && a === v ? a : "");
          }}
          isNew
        />
        {mismatch && <span className="text-sm text-critical-ink">{t("wallet.passphrase.mismatch")}</span>}
      </div>
    </>
  );
}

/**
 * Fact is one of the things that happen when the account is made, on a
 * vertical timeline: its mark, joined to the next by a line, and beside it
 * what happens.
 */
function Fact({ icon: Icon, title, desc, last }: { icon: typeof Lock; title: string; desc: string; last?: boolean }) {
  return (
    <motion.li variants={STAGGER.item} className="flex gap-3">
      <div className="flex flex-col items-center">
        <IconBadge icon={Icon} tone="brand" className="ring-1 ring-brand/25" />
        {!last && (
          <motion.span
            className="my-1 w-px flex-1 bg-border-strong"
            style={{ originY: 0 }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ ...SPRING, delay: 0.15 }}
          />
        )}
      </div>
      <div className={`flex min-w-0 flex-col gap-1 pt-1.5 ${last ? "" : "pb-6"}`}>
        <span className="text-[15px] leading-tight font-medium">{title}</span>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </motion.li>
  );
}

/** Requirement is one condition the password must meet, its mark filling in once met. */
export function Requirement({ met, label }: { met: boolean; label: string }) {
  return (
    <li
      className={`flex items-center gap-2 text-sm transition-colors duration-200 ${met ? "text-foreground" : "text-muted-foreground"}`}
    >
      <span className="relative grid size-4 shrink-0 place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full border"
          initial={false}
          animate={{ borderColor: met ? "var(--brand-mark)" : "var(--border-strong)" }}
          transition={GLIDE}
        />
        <AnimatePresence initial={false}>
          {met && (
            <motion.span
              key="met"
              className="absolute inset-0 grid place-items-center rounded-full bg-brand-fill text-brand-foreground"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={GLIDE}
            >
              <Check className="size-2.5" strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {label}
    </li>
  );
}

const STRENGTH: Record<Strength, { key: string; color: string }> = {
  0: { key: "wallet.create.strength.short", color: "var(--critical)" },
  1: { key: "wallet.create.strength.fair", color: "var(--warn)" },
  2: { key: "wallet.create.strength.good", color: "var(--brand-mark)" },
  3: { key: "wallet.create.strength.strong", color: "var(--brand-mark)" },
  4: { key: "wallet.create.strength.strong", color: "var(--brand-mark)" },
};

/** StrengthMeter is four segments filling in with the password's strength, and its word. */
export function StrengthMeter({ strength, empty }: { strength: Strength; empty: boolean }) {
  const t = useT();
  const s = STRENGTH[strength];
  const lit = empty ? 0 : Math.max(1, strength);
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.span
              className="block h-full rounded-full"
              initial={false}
              animate={{ scaleX: i <= lit ? 1 : 0, backgroundColor: s.color }}
              style={{ originX: 0 }}
              transition={SPRING}
            />
          </span>
        ))}
      </div>
      {/* As tall when empty as with its word, so nothing shifts as the first key is typed */}
      <span className="h-5 w-16 text-right text-sm text-muted-foreground">{empty ? "" : t(s.key)}</span>
    </div>
  );
}
