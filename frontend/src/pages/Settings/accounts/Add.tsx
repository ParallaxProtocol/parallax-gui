import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Eye, FileKey2, KeyRound, Plus, ScrollText } from "lucide-react";
import { usePageSwap, useStagger } from "../../../lib/motion";
import { useOfflineMode } from "../../../lib/offline";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { Panel } from "../../../components/ui/Panel";
import { Group } from "../fields";
import { CreateKey, CreateWallet } from "./Create";
import { ImportKey, PhraseImport } from "./Import";
import { AddWatchOnly } from "./WatchOnly";
import { SettingsFlow, useDrillBack } from "./flow";
import { ChoiceRow } from "./common";

/**
 * AddAccounts makes new accounts from Settings, their keys made here: a
 * choice of under a new recovery phrase or as a single key, laid out as a
 * Settings group, then the flow that makes them. Another account from a
 * phrase the wallet has is added from that phrase's group; accounts from
 * elsewhere come in by ImportAccounts.
 */
export function AddAccounts({ onLeave, onDone }: { onLeave: () => void; onDone: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const [kind, setKind] = useState<"phrase" | "key" | null>(null);
  const back = () => setKind(null);

  const noPhrase = (wallet.info?.seeds.length ?? 0) === 0;
  const lead = t("wallet.create.step.type");
  // Before a choice, the progress is the recommended one's: a new phrase
  const steps = [
    lead,
    t("wallet.create.step.intro"),
    t("wallet.create.step.details"),
    t("wallet.create.step.phrase"),
    t("wallet.create.step.confirm"),
  ];
  return (
    <Swap kind={kind}>
      {kind === "phrase" ? (
        <CreateWallet lead={lead} onBack={back} onDone={onDone} />
      ) : kind === "key" ? (
        <CreateKey lead={lead} onBack={back} onDone={onDone} />
      ) : (
        <Choices
          title={t("wallet.create.kindTitle")}
          desc={t("wallet.accounts.addDesc")}
          steps={steps}
          onLeave={onLeave}
        >
          <ChoiceRow
            icon={Plus}
            title={t("wallet.create.kind.phrase")}
            desc={t("wallet.create.kind.phraseDescAny")}
            badge={noPhrase ? t("wallet.create.recommended") : undefined}
            onClick={() => setKind("phrase")}
          />
          <ChoiceRow
            icon={KeyRound}
            title={t("wallet.add.newKey")}
            desc={t("wallet.create.kind.keyDesc")}
            onClick={() => setKind("key")}
          />
        </Choices>
      )}
    </Swap>
  );
}

/**
 * ImportAccounts brings in accounts that exist elsewhere: a recovery phrase
 * and the accounts it holds, a single key (from a keystore file or typed
 * in), or the address alone of one whose key stays on an offline signer.
 */
export function ImportAccounts({
  initial = null,
  onLeave,
  onDone,
}: {
  /** The source to open at, rather than the choice of one (Back still comes to the choice). */
  initial?: "phrase" | "key" | "watch" | null;
  onLeave: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const offline = useOfflineMode();
  const [kind, setKind] = useState<"phrase" | "key" | "watch" | null>(initial);
  const back = () => setKind(null);

  const lead = t("wallet.import.step.source");
  // Before a choice, the progress is the most usual one's: a phrase
  const steps = [
    lead,
    t("wallet.create.step.phrase"),
    t("wallet.import.step.accounts"),
    t("wallet.create.step.details"),
  ];
  return (
    <Swap kind={kind}>
      {kind === "phrase" ? (
        <PhraseImport lead={lead} onBack={back} onDone={onDone} />
      ) : kind === "key" ? (
        <ImportKey lead={lead} onBack={back} onDone={onDone} />
      ) : kind === "watch" ? (
        <AddWatchOnly lead={lead} onLeave={back} onDone={onDone} />
      ) : (
        <Choices
          title={t("wallet.import.step.source")}
          desc={t("wallet.import.choose.desc")}
          steps={steps}
          onLeave={onLeave}
        >
          <ChoiceRow
            icon={ScrollText}
            title={t("wallet.add.importPhrase")}
            desc={t("wallet.import.phraseDesc")}
            onClick={() => setKind("phrase")}
          />
          <ChoiceRow
            icon={FileKey2}
            title={t("wallet.add.importKey")}
            desc={t("wallet.add.importKeyDesc")}
            onClick={() => setKind("key")}
          />
          {/* An offline signer holds keys only; following one is for a wallet online */}
          {!offline && (
            <ChoiceRow
              icon={Eye}
              title={t("wallet.add.watch")}
              desc={t("wallet.add.watchDesc")}
              onClick={() => setKind("watch")}
            />
          )}
        </Choices>
      )}
    </Swap>
  );
}

/**
 * Swap moves between a page of choices and the flow chosen as Settings
 * moves between sections: the one coming in arrives, the one going goes
 * at once. The first shown doesn't arrive, as the drill-in already has.
 */
function Swap({ kind, children }: { kind: string | null; children: ReactNode }) {
  const swap = usePageSwap();
  return (
    <motion.div key={kind ?? "choices"} {...swap}>
      {children}
    </motion.div>
  );
}

/** Choices is a page of ways on, as one Settings group, the first step of the flow it leads to; Escape, like ‹ Accounts, goes back. */
function Choices({
  title,
  desc,
  steps,
  onLeave,
  children,
}: {
  title: string;
  desc: string;
  /** The flow's progress, this choice its first step. */
  steps: string[];
  onLeave: () => void;
  children: ReactNode;
}) {
  const stagger = useStagger();
  useDrillBack(onLeave);
  return (
    <SettingsFlow title={title} steps={steps} current={0}>
      <Group title={title} desc={desc}>
        <Panel className="overflow-hidden">
          <motion.ul {...stagger} className="divide-y divide-border">
            {children}
          </motion.ul>
        </Panel>
      </Group>
    </SettingsFlow>
  );
}
