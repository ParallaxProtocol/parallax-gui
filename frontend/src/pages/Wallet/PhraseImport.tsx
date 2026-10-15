import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { api, SeedCandidate, SeedPick, SeedScheme, walletError } from "../../lib/api";
import { formatLax, shortHex } from "../../lib/format";
import { useNode } from "../../lib/live";
import { STAGGER, useStagger } from "../../lib/motion";
import { useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { Notice } from "../../components/ui/bits";
import { Segmented } from "../../components/ui/Segmented";
import { Checkbox, Field, PasswordInput } from "./common";
import { NameField } from "./AccountForms";
import { useBusy } from "./accountActions";
import { FlowPage, Part, StepFooter, StepPanel } from "./flow";
import { PhraseInput } from "./Phrase";
import { Pill } from "../../components/ui/Pill";

/** How many accounts a scan shows at a time. */
const BATCH = 5;
const SCHEMES: SeedScheme[] = ["standard", "ledgerlive", "legacy"];

type Stage = "phrase" | "accounts" | "password";
export type Found = Record<SeedScheme, SeedCandidate[]>;
/** The word counts a recovery phrase can have. */
export const PHRASE_LENGTHS = [12, 15, 18, 21, 24];

// Picks follow the address: Ledger Live's first account is the standard
// first account, and must read as one choice in both lists
export const pickKey = (c: { address: string }) => c.address;

/** picksOf lists the picked accounts in a stable order (by scheme, then index), each address once. */
export function picksOf(found: Found, picked: Set<string>): SeedPick[] {
  const seen = new Set<string>();
  return SCHEMES.flatMap((scheme) =>
    found[scheme]
      .filter((c) => picked.has(pickKey(c)) && !seen.has(c.address) && seen.add(c.address))
      .map((c) => ({ scheme, index: c.index })),
  );
}

/**
 * PhraseImport restores the wallet from a recovery phrase, as a hardware
 * wallet's companion app does: the words, then the accounts the phrase
 * holds, found along the paths wallets use (MetaMask's standard one,
 * Ledger Live's, the legacy one) with what each holds on chain, for the
 * user to pick, then the password that will protect them. Nothing is
 * stored until the last step.
 */
export function PhraseImport({ onBack }: { onBack: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [stage, setStage] = useState<Stage>("phrase");
  const [words, setWords] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [found, setFound] = useState<Found>({ standard: [], ledgerlive: [], legacy: [] });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, setError, run } = useBusy();

  // Nothing typed here outlives the page
  useEffect(
    () => () => {
      setWords("");
      setPassphrase("");
      setPassword("");
    },
    [],
  );

  const steps = [
    t("wallet.import.step.source"),
    t("wallet.create.step.phrase"),
    t("wallet.import.step.accounts"),
    t("wallet.create.step.details"),
  ];
  const pass = advanced ? passphrase : "";
  const count = words.trim() ? words.trim().split(/\s+/).length : 0;

  /** scan reads the next batch of a scheme, and picks the used accounts in it. */
  const scan = async (scheme: SeedScheme, from: number) => {
    const batch = await api.walletScanSeed(words, pass, scheme, from, BATCH);
    setFound((f) => ({ ...f, [scheme]: [...f[scheme].filter((c) => c.index < from), ...batch] }));
    setPicked((p) => {
      const next = new Set(p);
      for (const c of batch) if (c.used && !c.inWallet) next.add(pickKey(c));
      return next;
    });
    return batch;
  };

  if (stage === "phrase") {
    return (
      <FlowPage title={t("wallet.import.phrase")} steps={steps} current={1}>
        <StepPanel
          onSubmit={async () => {
            if (busy || !PHRASE_LENGTHS.includes(count) || (advanced && !passphrase)) return;
            const batch = await run(async () => {
              setFound({ standard: [], ledgerlive: [], legacy: [] });
              setPicked(new Set());
              return scan("standard", 0);
            });
            if (!batch) return;
            // The first standard account is always offered, used or not
            if (!batch[0].inWallet) setPicked((p) => new Set(p).add(pickKey(batch[0])));
            setStage("accounts");
          }}
        >
          <Part className="gap-4">
            <p className="text-sm text-muted-foreground">{t("wallet.import.phraseLead")}</p>
            <Field label={t("wallet.import.phraseLabel")}>
              {(id) => <PhraseInput id={id} value={words} onChange={setWords} />}
            </Field>
          </Part>
          <Part className="gap-3">
            <Checkbox checked={advanced} onChange={setAdvanced}>
              <span className="font-medium">{t("wallet.passphrase.importToggle")}</span>
              <span className="block text-sm text-muted-foreground">{t("wallet.passphrase.importToggleDesc")}</span>
            </Checkbox>
            {advanced && (
              <Field label={t("wallet.passphrase.label")} hint={t("wallet.passphrase.importHint")}>
                {(id) => <PasswordInput id={id} value={passphrase} onChange={setPassphrase} />}
              </Field>
            )}
            {error && <Notice tone="critical">{error}</Notice>}
          </Part>
          <StepFooter onBack={onBack}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !PHRASE_LENGTHS.includes(count) || (advanced && !passphrase)}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t("common.continue")}
              {!busy && <ArrowRight className="size-3.5" />}
            </button>
          </StepFooter>
        </StepPanel>
      </FlowPage>
    );
  }

  if (stage === "accounts") {
    return (
      <FlowPage title={t("wallet.import.chooseTitle")} steps={steps} current={2}>
        <ChooseAccounts
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
              await scan(scheme, from);
            } catch (e) {
              setError(walletError(e, t));
            }
          }}
          error={error}
          onBack={() => setStage("phrase")}
          onContinue={() => setStage("password")}
        />
      </FlowPage>
    );
  }

  const picks = picksOf(found, picked);

  return (
    <FlowPage title={t("wallet.create.detailsTitle")} steps={steps} current={3}>
      <StepPanel
        onSubmit={async () => {
          if (busy || !password || picks.length === 0) return;
          const acc = await run(() => api.walletImportSeed(name, words, pass, password, picks));
          if (acc) {
            setWords("");
            await wallet.refresh();
            navigate("/", { replace: true });
          }
        }}
      >
        <Part>
          <p className="text-muted-foreground">{t("wallet.import.passwordLead", { n: picks.length })}</p>
        </Part>
        <Part className="gap-4">
          <NameField value={name} onChange={setName} />
          <Field label={t("wallet.walletPassword")}>
            {(id) => <PasswordInput id={id} value={password} onChange={setPassword} />}
          </Field>
          {error && <Notice tone="critical">{error}</Notice>}
        </Part>
        <StepFooter onBack={() => setStage("accounts")}>
          <button type="submit" className="btn btn-primary" disabled={busy || !password}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? t("wallet.import.busy") : t("wallet.import.cta")}
          </button>
        </StepFooter>
      </StepPanel>
    </FlowPage>
  );
}

/** ChooseAccounts is the accounts step of the import page: the picker, with the step's footer. */
function ChooseAccounts({
  found,
  picked,
  onToggle,
  onScan,
  error,
  onBack,
  onContinue,
}: {
  found: Found;
  picked: Set<string>;
  onToggle: (c: SeedCandidate) => void;
  onScan: (scheme: SeedScheme, from: number) => Promise<void>;
  error: string | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  const total = picked.size;
  return (
    <StepPanel>
      <Part className="gap-3">
        <p className="text-muted-foreground">{t("wallet.import.chooseDesc")}</p>
      </Part>
      <AccountPicker found={found} picked={picked} onToggle={onToggle} onScan={onScan} error={error} />
      <StepFooter onBack={onBack} hint={t("wallet.import.picked", { n: total })}>
        <button type="button" className="btn btn-primary" disabled={total === 0} onClick={onContinue}>
          {t("common.continue")}
          <ArrowRight className="size-3.5" />
        </button>
      </StepFooter>
    </StepPanel>
  );
}

/**
 * AccountPicker lists the accounts a phrase holds under one path scheme at
 * a time, with their balances, to pick from; more load on demand.
 */
export function AccountPicker({
  found,
  picked,
  onToggle,
  onScan,
  error,
}: {
  found: Found;
  picked: Set<string>;
  onToggle: (c: SeedCandidate) => void;
  onScan: (scheme: SeedScheme, from: number) => Promise<void>;
  error: string | null;
}) {
  const t = useT();
  const node = useNode();
  const stagger = useStagger();
  const [scheme, setScheme] = useState<SeedScheme>("standard");
  const [loading, setLoading] = useState(false);
  const list = found[scheme];
  const readable = list.some((c) => c.balanceWei !== "");

  const load = async (s: SeedScheme, from: number) => {
    setLoading(true);
    await onScan(s, from);
    setLoading(false);
  };

  // A scheme's first batch loads when it is first shown
  useEffect(() => {
    if (found[scheme].length === 0) load(scheme, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme]);

  return (
    <>
      <Part className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<SeedScheme>
            options={[
              { value: "standard", label: t("wallet.import.scheme.standard") },
              { value: "ledgerlive", label: t("wallet.import.scheme.ledgerlive") },
              { value: "legacy", label: t("wallet.import.scheme.legacy") },
            ]}
            value={scheme}
            onChange={setScheme}
          />
          <span className="font-mono text-xs text-muted-foreground">{t(`wallet.import.schemePath.${scheme}`)}</span>
        </div>
        {(node && !node.running) || (list.length > 0 && !readable) ? (
          <Notice tone="info">{t("wallet.import.noBalances")}</Notice>
        ) : null}
      </Part>

      <motion.ul key={scheme} {...stagger} className="flex flex-col divide-y divide-border">
        {list.map((c) => (
          <motion.li key={`${c.scheme}/${c.index}`} variants={STAGGER.item}>
            <Candidate c={c} picked={picked.has(pickKey(c))} onToggle={() => onToggle(c)} />
          </motion.li>
        ))}
        {list.length === 0 && loading && (
          <li className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </li>
        )}
      </motion.ul>

      <Part className="items-center py-2.5">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={loading || list.length === 0}
          onClick={() => load(scheme, list.length)}
        >
          {loading && list.length > 0 && <Loader2 className="size-3 animate-spin" />}
          {t("wallet.import.more")}
        </button>
        {error && <Notice tone="critical">{error}</Notice>}
      </Part>
    </>
  );
}

/** Candidate is one account of the phrase: whether it's picked, where it is, what it holds. */
function Candidate({ c, picked, onToggle }: { c: SeedCandidate; picked: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <label
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
        c.inWallet ? "opacity-50" : "cursor-pointer hover:bg-hover"
      } ${picked ? "bg-brand-muted/40" : ""}`}
    >
      <input
        type="checkbox"
        className="size-3.5 cursor-pointer accent-[var(--brand-fill)]"
        checked={picked || c.inWallet}
        disabled={c.inWallet}
        onChange={onToggle}
      />
      <AddressAvatar address={c.address} size={28} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm">{shortHex(c.address, 10, 8)}</span>
          {c.used && <Pill tone="brand">{t("wallet.import.used")}</Pill>}
          {c.inWallet && <span className="text-xs text-muted-foreground">{t("wallet.import.inWallet")}</span>}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{c.path}</span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {c.balanceWei !== "" ? (
          <>
            {formatLax(c.balanceWei, 6)} <span className="text-muted-foreground">LAX</span>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
    </label>
  );
}
