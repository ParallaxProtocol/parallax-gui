import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, FileKey2, HardDrive, KeyRound, Loader2, Lock, ScrollText, TriangleAlert } from "lucide-react";
import { api, WalletAccount } from "../../../lib/api";
import { SPRING, STAGGER, useStagger } from "../../../lib/motion";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { Notice } from "../../../components/ui/bits";
import { Panel, Row, Rows } from "../../../components/ui/Panel";
import { GroupedAddress } from "../../../components/ui/AccountParts";
import { DrawnCheck, PasswordInput } from "../../Wallet/common";
import { backUp, useBusy, useDefaultName } from "../../Wallet/accountActions";
import { PhraseGrid, PhraseQuiz, PhraseWarning } from "../../Wallet/Phrase";
import { Group } from "../fields";
import { FieldRow, SettingsFlow, Step, StepFooter, ToggleRow } from "./flow";

/**
 * Making accounts from Settings' Accounts section, chosen on its Create
 * accounts page: a new recovery phrase, or a single key, each step laid
 * out as a Settings section. The account takes the next Account N (renamed
 * in the list), encrypted with the unlocked wallet's password. Each ends
 * back in the list with the new account selected. Words and passphrases
 * stay in the page's own state and are gone once it is left.
 */

type PhraseStage = "intro" | "phrase" | "confirm" | "passphrase";

/**
 * CreateWallet makes a new recovery phrase and its first account: what will
 * happen, the words to write down, three of them typed back to prove it,
 * then an optional passphrase on top of them, the phrase understood by
 * then. Leaving the words for later skips the typing back, not the
 * passphrase: the phrase is then stored as not yet confirmed. Nothing is
 * stored until the last step; leaving before leaves nothing behind.
 */
export function CreateWallet({ lead, onBack, onDone }: { lead: string; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const defaultName = useDefaultName();
  const [stage, setStage] = useState<PhraseStage>("intro");
  const [words, setWords] = useState<string[]>([]);
  const [valid, setValid] = useState(false);
  // 24 words unless the shorter phrase is asked for
  const [short, setShort] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  // Whether the words were typed back, or left for later (the quiz skipped)
  const [confirmed, setConfirmed] = useState(false);
  const { busy, error, run } = useBusy();

  // The words live here only while the page shows
  useEffect(
    () => () => {
      setWords([]);
      setPassphrase("");
    },
    [],
  );

  const steps = [
    lead,
    t("wallet.create.step.intro"),
    t("wallet.create.step.phrase"),
    t("wallet.create.step.confirm"),
    t("wallet.passphrase.label"),
  ];
  const pass = advanced ? passphrase : "";
  const create = async () => {
    if (busy || (advanced && !passphrase)) return;
    const acc = await run(() => api.walletCreateSeedWords(defaultName, words.join(" "), pass, confirmed));
    if (acc) {
      setWords([]);
      await wallet.refresh();
      onDone();
    }
  };

  if (stage === "intro") {
    return (
      <SettingsFlow title={t("wallet.create.step.intro")} steps={steps} current={1}>
        <CreateIntro
          kind="phrase"
          words={short ? 12 : 24}
          extra={
            <Rows>
              <ToggleRow
                title={t("wallet.create.words12")}
                desc={t("wallet.create.words12Desc")}
                checked={short}
                onChange={setShort}
              />
            </Rows>
          }
          busy={busy}
          onBack={onBack}
          onContinue={async () => {
            const made = await run(() => api.walletNewSeedWords(short ? 12 : 24));
            if (made) {
              setWords(made);
              setStage("phrase");
            }
          }}
        />
        {error && <Notice tone="critical">{error}</Notice>}
      </SettingsFlow>
    );
  }

  if (stage === "phrase") {
    return (
      <SettingsFlow title={t("wallet.phrase.yours")} steps={steps} current={2}>
        <Step>
          <Group title={t("wallet.phrase.yours")} desc={t("wallet.phrase.writeDown")}>
            <Panel className="flex flex-col gap-4 p-4">
              <PhraseGrid words={words} />
              <PhraseWarning />
            </Panel>
          </Group>
          <StepFooter
            onBack={() => setStage("intro")}
            hint={<span className="text-warn-ink">{t("wallet.phrase.laterWarn")}</span>}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setConfirmed(false);
                setStage("passphrase");
              }}
            >
              {t("wallet.created.later")}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStage("confirm")}>
              {t("wallet.phrase.written")}
            </button>
          </StepFooter>
        </Step>
      </SettingsFlow>
    );
  }

  if (stage === "confirm") {
    return (
      <SettingsFlow title={t("wallet.phrase.quizTitle")} steps={steps} current={3}>
        <Step
          onSubmit={() => {
            if (!valid) return;
            setConfirmed(true);
            setStage("passphrase");
          }}
        >
          <Group title={t("wallet.phrase.quizTitle")} desc={t("wallet.phrase.quizDesc")}>
            <PhraseQuiz words={words} onValid={setValid} />
          </Group>
          <StepFooter onBack={() => setStage("phrase")}>
            <button type="submit" className="btn btn-primary" disabled={!valid}>
              {t("wallet.phrase.confirm")}
            </button>
          </StepFooter>
        </Step>
      </SettingsFlow>
    );
  }

  return (
    <SettingsFlow title={t("wallet.passphrase.label")} steps={steps} current={4} skipped={confirmed ? undefined : [3]}>
      <Step onSubmit={create}>
        <Group title={t("wallet.passphrase.label")}>
          <Rows>
            <ToggleRow
              title={t("wallet.passphrase.toggle")}
              desc={t("wallet.passphrase.toggleDesc")}
              checked={advanced}
              onChange={setAdvanced}
            />
            <AnimatePresence initial={false}>
              {advanced && (
                <motion.div
                  className="overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={SPRING}
                >
                  <PassphraseRows onChange={setPassphrase} />
                </motion.div>
              )}
            </AnimatePresence>
          </Rows>
          {advanced && passphrase && <Notice tone="info">{t("wallet.passphrase.remember")}</Notice>}
          {error && <Notice tone="critical">{error}</Notice>}
        </Group>
        {/* Back to where it came from: the quiz, or the words it skipped */}
        <StepFooter onBack={() => setStage(confirmed ? "confirm" : "phrase")}>
          <button type="submit" className="btn btn-primary" disabled={busy || (advanced && !passphrase)}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("wallet.create.cta")}
          </button>
        </StepFooter>
      </Step>
    </SettingsFlow>
  );
}

/**
 * CreateKey makes a single account with a key of its own: what will happen,
 * then the account, and its backup, its keystore file.
 */
export function CreateKey({ lead, onBack, onDone }: { lead: string; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const defaultName = useDefaultName();
  const [created, setCreated] = useState<WalletAccount | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useBusy();

  const steps = [lead, t("wallet.create.step.intro"), t("wallet.create.step.backup")];
  const done = onDone;

  if (!created) {
    return (
      <SettingsFlow title={t("wallet.create.step.intro")} steps={steps} current={1}>
        <CreateIntro
          kind="key"
          busy={busy}
          onBack={onBack}
          onContinue={async () => {
            const acc = await run(() => api.walletCreate(defaultName));
            if (acc) {
              setCreated(acc);
              await wallet.refresh();
            }
          }}
        />
        {error && <Notice tone="critical">{error}</Notice>}
      </SettingsFlow>
    );
  }

  return (
    <SettingsFlow title={t("wallet.backup.title")} steps={steps} current={saved ? 3 : 2}>
      <Step>
        <Group title={t("wallet.create.done")}>
          <Rows>
            <div className="flex items-center gap-3.5 px-4 py-3">
              <DrawnCheck />
              <div className="@container min-w-0 flex-1 text-sm text-muted-foreground">
                <span className="hidden @md:inline">
                  <GroupedAddress address={created.address} />
                </span>
                <span className="truncate font-mono @md:hidden">{created.address}</span>
              </div>
            </div>
          </Rows>
        </Group>
        <Group title={t("wallet.backup.title")} desc={t("wallet.create.keyBackupWhy")}>
          <Rows>
            <Row
              title={saved ? t("wallet.backup.saved") : t("wallet.import.keyfile")}
              desc={saved ? t("wallet.created.savedDesc") : t("wallet.backup.what")}
            >
              {saved ? (
                <Check className="size-4 text-good-ink" />
              ) : (
                <button
                  type="button"
                  className="btn btn-tinted btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await run(() => backUp(created.address));
                    if (ok) {
                      setSaved(true);
                      await wallet.refresh();
                    }
                  }}
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileKey2 className="size-3.5" />}
                  {t("wallet.backup.cta")}
                </button>
              )}
            </Row>
          </Rows>
          {error && <Notice tone="critical">{error}</Notice>}
        </Group>
        <StepFooter hint={saved ? undefined : <span className="text-warn-ink">{t("wallet.backup.missingTitle")}</span>}>
          {saved ? (
            <button type="button" className="btn btn-primary" onClick={done} autoFocus>
              {t("common.done")}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={done} disabled={busy}>
              {t("wallet.created.later")}
            </button>
          )}
        </StepFooter>
      </Step>
    </SettingsFlow>
  );
}

/**
 * CreateIntro opens the making of an account: what is about to happen (a
 * key made here, locked with a password, kept on this computer), as a
 * few lines of text in one panel, before anything is asked for.
 */
function CreateIntro({
  kind,
  words = 12,
  extra,
  busy,
  onBack,
  onContinue,
}: {
  kind: "phrase" | "key";
  /** How many words the phrase will have. */
  words?: number;
  /** A choice about what will be made, under what will happen. */
  extra?: ReactNode;
  busy?: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  const stagger = useStagger();
  return (
    <Step>
      <Group title={t("wallet.create.step.intro")} desc={t("wallet.create.lead")}>
        <Panel className="px-5 py-6">
          <motion.ol {...stagger} className="flex flex-col gap-6">
            {kind === "phrase" ? (
              <Fact
                icon={ScrollText}
                title={t("wallet.create.fact1")}
                desc={t("wallet.create.fact1DescN", { n: words })}
              />
            ) : (
              <Fact icon={KeyRound} title={t("wallet.create.keyFact1")} desc={t("wallet.create.keyFact1Desc")} />
            )}
            <Fact
              icon={Lock}
              title={t("wallet.create.fact2")}
              desc={kind === "phrase" ? t("wallet.create.fact2Desc") : t("wallet.create.keyFact2Desc")}
            />
            <Fact icon={HardDrive} title={t("wallet.create.fact3")} desc={t("wallet.create.fact3Desc")} />
          </motion.ol>
        </Panel>
        {extra}
      </Group>
      <StepFooter onBack={onBack} hint={kind === "phrase" ? t("wallet.create.next") : t("wallet.create.keyNext")}>
        <button type="button" className="btn btn-primary" onClick={onContinue} disabled={busy} autoFocus>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {t("common.continue")}
        </button>
      </StepFooter>
    </Step>
  );
}

/** Fact is one point of CreateIntro: what happens, and what it means, read rather than chosen. */
function Fact({ icon: Icon, title, desc }: { icon: typeof Lock; title: string; desc: string }) {
  return (
    <motion.li variants={STAGGER.item} className="flex items-start gap-3.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
      <div className="flex min-w-0 flex-col gap-1">
        <span>{title}</span>
        <span className="text-sm leading-relaxed text-muted-foreground">{desc}</span>
      </div>
    </motion.li>
  );
}

/**
 * PassphraseRows takes a new BIP-39 passphrase as Settings rows, typed
 * twice: it changes every account the phrase gives, and nothing can tell a
 * mistyped one, so it is worth typing twice. It reports it once both
 * agree, else "".
 */
function PassphraseRows({ onChange }: { onChange: (passphrase: string) => void }) {
  const t = useT();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const mismatch = b.length > 0 && a !== b;
  return (
    <div className="flex flex-col divide-y divide-border">
      <div className="flex items-start gap-2 px-4 py-3 text-sm text-warn-ink">
        <TriangleAlert className="size-4 shrink-0" />
        <span>{t("wallet.passphrase.warning")}</span>
      </div>
      <FieldRow label={t("wallet.passphrase.label")}>
        {(id) => (
          <PasswordInput
            id={id}
            value={a}
            onChange={(v) => {
              setA(v);
              onChange(v && v === b ? v : "");
            }}
            isNew
            autoFocus
          />
        )}
      </FieldRow>
      <FieldRow label={t("wallet.passphrase.confirm")} error={mismatch ? t("wallet.passphrase.mismatch") : null}>
        {(id) => (
          <PasswordInput
            id={id}
            value={b}
            onChange={(v) => {
              setB(v);
              onChange(a && a === v ? a : "");
            }}
            isNew
          />
        )}
      </FieldRow>
    </div>
  );
}
