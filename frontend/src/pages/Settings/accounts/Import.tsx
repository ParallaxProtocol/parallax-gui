import { useEffect, useId, useRef, useState } from "react";
import { FileKey2, Loader2, TriangleAlert } from "lucide-react";
import { api, SeedCandidate, SeedScheme, walletError } from "../../../lib/api";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { Notice } from "../../../components/ui/bits";
import { Panel, Row, Rows } from "../../../components/ui/Panel";
import { Segmented } from "../../../components/ui/Segmented";
import { Swapping } from "../../../components/ui/Swapping";
import { PasswordInput } from "../../Wallet/common";
import { useBusy, useDefaultName, useNamePicks } from "../../Wallet/accountActions";
import { PhraseInput } from "../../Wallet/Phrase";
import { type Found, PHRASE_LENGTHS, pickKey, picksOf } from "../../Wallet/PhraseImport";
import { Group } from "../fields";
import { FieldRow, SettingsFlow, Step, StepFooter, ToggleRow } from "./flow";
import { BATCH, PhrasePicker } from "./Picker";

/**
 * Bringing accounts into Settings' Accounts section, chosen on its Import
 * accounts page: a recovery phrase and the accounts it holds, or a single
 * key, each step laid out as a Settings section. What comes in takes the
 * next Account N names (renamed in the list), encrypted with the unlocked
 * wallet's password. Each ends back in the list with what came in
 * selected. Words and keys typed here stay in the page's own state and
 * are gone once it is left.
 */

/**
 * ImportKey brings in a single key, from a keystore file or as hex typed
 * in, encrypted again under the wallet password.
 */
export function ImportKey({ lead, onBack, onDone }: { lead: string; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const defaultName = useDefaultName();
  const wallet = useWallet();
  const [kind, setKind] = useState<"keyfile" | "key">("keyfile");
  const [key, setKey] = useState("");
  const [file, setFile] = useState<{ name: string; json: string } | null>(null);
  const [filePassword, setFilePassword] = useState("");
  const { busy, error, setError, run } = useBusy();
  const fileInput = useRef<HTMLInputElement>(null);

  // Nothing typed here outlives the page
  useEffect(
    () => () => {
      setKey("");
      setFilePassword("");
    },
    [],
  );

  const keyHex = key.trim().replace(/^0x/i, "");
  const keyOk = /^[0-9a-fA-F]{64}$/.test(keyHex);
  const ready = kind === "key" ? keyOk : !!file && !!filePassword;

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
    <SettingsFlow title={t("wallet.add.importKey")} steps={[lead, t("wallet.create.step.details")]} current={1}>
      <Step
        onSubmit={async () => {
          if (!ready || busy) return;
          const acc = await run(() =>
            kind === "key"
              ? api.walletImportPrivateKey(defaultName, keyHex)
              : api.walletImportKeyfile(defaultName, file!.json, filePassword),
          );
          if (acc) {
            await wallet.refresh();
            onDone();
          }
        }}
      >
        <Group
          title={t("wallet.import.step.source")}
          desc={kind === "keyfile" ? t("wallet.import.keyfileDesc") : t("wallet.import.keyDesc")}
        >
          <Rows>
            <Row title={t("wallet.add.importKey")}>
              <Segmented<"keyfile" | "key">
                options={[
                  { value: "keyfile", label: t("wallet.import.keyfile") },
                  { value: "key", label: t("wallet.import.key") },
                ]}
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setError(null);
                }}
              />
            </Row>
            <Swapping swap={kind}>
              {kind === "keyfile" ? (
                <div className="flex flex-col divide-y divide-border">
                  <FieldRow label={t("wallet.import.file")} desc={file ? file.name : t("wallet.import.noFile")}>
                    {(id) => (
                      <div className="flex justify-end">
                        <input
                          id={id}
                          ref={fileInput}
                          type="file"
                          className="sr-only"
                          onChange={(e) => readFile(e.target.files?.[0])}
                        />
                        <button
                          type="button"
                          className="btn btn-tinted btn-sm"
                          onClick={() => fileInput.current?.click()}
                        >
                          <FileKey2 className="size-3.5" />
                          {t("wallet.import.choose")}
                        </button>
                      </div>
                    )}
                  </FieldRow>
                  <FieldRow label={t("wallet.import.filePassword")} desc={t("wallet.import.filePasswordHint")}>
                    {(id) => <PasswordInput id={id} value={filePassword} onChange={setFilePassword} />}
                  </FieldRow>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  <FieldRow
                    label={t("wallet.import.keyLabel")}
                    desc={t("wallet.import.keyHint")}
                    error={key && !keyOk ? t("wallet.err.badKey") : null}
                    wide
                  >
                    {(id) => <PasswordInput id={id} value={key} onChange={setKey} placeholder="0x…" />}
                  </FieldRow>
                  <div className="flex items-start gap-2 px-4 py-3 text-sm text-warn-ink">
                    <TriangleAlert className="size-4 shrink-0" />
                    <span>{t("wallet.import.keyWarn")}</span>
                  </div>
                </div>
              )}
            </Swapping>
          </Rows>
        </Group>

        {error && <Notice tone="critical">{error}</Notice>}

        <StepFooter onBack={onBack}>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? t("wallet.import.busy") : t("wallet.import.cta")}
          </button>
        </StepFooter>
      </Step>
    </SettingsFlow>
  );
}

/**
 * PhraseImport restores accounts from a recovery phrase, as a hardware
 * wallet's companion app does: the words, then the accounts the phrase
 * holds, found along the paths wallets use (MetaMask's standard one,
 * Ledger Live's, the legacy one) with what each holds on chain, for the
 * user to pick, then the password that will protect them. Nothing is
 * stored until the last step.
 */
export function PhraseImport({ lead, onBack, onDone }: { lead: string; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const namePicks = useNamePicks();
  const wallet = useWallet();
  const phraseId = useId();
  const [stage, setStage] = useState<"phrase" | "accounts">("phrase");
  const [words, setWords] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [found, setFound] = useState<Found>({ standard: [], ledgerlive: [], legacy: [] });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy, error, setError, run } = useBusy();

  // Nothing typed here outlives the page
  useEffect(
    () => () => {
      setWords("");
      setPassphrase("");
    },
    [],
  );

  const steps = [lead, t("wallet.create.step.phrase"), t("wallet.import.step.accounts")];
  const pass = advanced ? passphrase : "";
  const count = words.trim() ? words.trim().split(/\s+/).length : 0;
  const wordsOk = PHRASE_LENGTHS.includes(count) && (!advanced || !!passphrase);

  /** scan reads the next batch of a scheme, and picks the used accounts in it. */
  const scan = async (scheme: SeedScheme, from: number) => {
    const batch = await api.walletScanSeed(words, pass, scheme, from, BATCH);
    setFound((f) => ({
      ...f,
      [scheme]: [
        ...f[scheme].filter((c) => c.index < from),
        ...batch,
        ...f[scheme].filter((c) => c.index >= from + batch.length),
      ],
    }));
    setPicked((p) => {
      const next = new Set(p);
      for (const c of batch) if (c.used && !c.inWallet) next.add(pickKey(c));
      return next;
    });
    return batch;
  };

  if (stage === "phrase") {
    return (
      <SettingsFlow title={t("wallet.import.phrase")} steps={steps} current={1}>
        <Step
          onSubmit={async () => {
            if (busy || !wordsOk) return;
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
          <Group title={t("wallet.import.phraseLabel")} desc={t("wallet.import.phraseLead")}>
            <Panel className="p-4">
              <label htmlFor={phraseId} className="sr-only">
                {t("wallet.import.phraseLabel")}
              </label>
              <PhraseInput id={phraseId} value={words} onChange={setWords} />
            </Panel>
          </Group>
          <Group title={t("wallet.passphrase.label")}>
            <Rows>
              <ToggleRow
                title={t("wallet.passphrase.importToggle")}
                desc={t("wallet.passphrase.importToggleDesc")}
                checked={advanced}
                onChange={setAdvanced}
              />
              {advanced && (
                <FieldRow label={t("wallet.passphrase.label")} desc={t("wallet.passphrase.importHint")}>
                  {(id) => <PasswordInput id={id} value={passphrase} onChange={setPassphrase} autoFocus />}
                </FieldRow>
              )}
            </Rows>
          </Group>
          {error && <Notice tone="critical">{error}</Notice>}
          <StepFooter onBack={onBack}>
            <button type="submit" className="btn btn-primary" disabled={busy || !wordsOk}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {t("common.continue")}
            </button>
          </StepFooter>
        </Step>
      </SettingsFlow>
    );
  }

  const picks = picksOf(found, picked);

  return (
    <SettingsFlow title={t("wallet.import.chooseTitle")} steps={steps} current={2}>
      <Step>
        <PhrasePicker
          found={found}
          picked={picked}
          onToggle={(c: SeedCandidate) =>
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
        />
        <StepFooter onBack={() => setStage("phrase")} hint={t("wallet.import.picked", { n: picks.length })}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || picks.length === 0}
            onClick={async () => {
              const acc = await run(() => api.walletImportSeed("", words, pass, namePicks(picks, "")));
              if (acc) {
                setWords("");
                await wallet.refresh();
                onDone();
              }
            }}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? t("wallet.import.busy") : t("wallet.import.cta")}
          </button>
        </StepFooter>
      </Step>
    </SettingsFlow>
  );
}
