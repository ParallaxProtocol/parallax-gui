import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { api, SeedCandidate, SeedInfo, SeedScheme, walletError } from "../../../lib/api";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { useBusy, useNamePicks } from "../../Wallet/accountActions";
import { type Found, pickKey, picksOf } from "../../Wallet/PhraseImport";
import { useDrillBack } from "./flow";
import { UnlockModal } from "./common";
import { BATCH, PhrasePicker } from "./Picker";

/** usedNotInWallet picks the accounts of a batch that hold something and aren't in the wallet yet. */
const usedNotInWallet = (batch: SeedCandidate[]) => batch.filter((c) => c.used && !c.inWallet).map(pickKey);

/**
 * FindAccountsModal asks for the wallet password to open a recovery
 * phrase, and proves it by reading the phrase's first accounts; with
 * them, it goes on to the page that lists them to pick from.
 */
export function FindAccountsModal({
  seed,
  onClose,
  onOpen,
}: {
  seed: SeedInfo | null;
  onClose: () => void;
  onOpen: (seed: SeedInfo, password: string, first: SeedCandidate[]) => void;
}) {
  const t = useT();
  return (
    <UnlockModal
      open={!!seed}
      title={t("wallet.find.cta")}
      subtitle={seed?.name}
      desc={seed ? t("wallet.find.desc", { name: seed.name }) : undefined}
      icon={<Search className="size-4" />}
      cta={t("common.continue")}
      onClose={onClose}
      onUnlock={async (password) => {
        if (!seed) return;
        const first = await api.walletScanWalletSeed(seed.id, password, "standard", 0, BATCH);
        onOpen(seed, password, first);
      }}
    />
  );
}

/**
 * FindAccounts brings in more of the accounts a recovery phrase in the
 * wallet holds, picked from a PhrasePicker and added from its accounts'
 * header. It opens on the first ones
 * FindAccountsModal read, with the password it took, kept for the scans
 * until the page is left.
 */
export function FindAccounts({
  seed,
  password,
  first,
  onLeave,
  onDone,
}: {
  seed: SeedInfo;
  password: string;
  first: SeedCandidate[];
  onLeave: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const wallet = useWallet();
  const namePicks = useNamePicks();
  const [found, setFound] = useState<Found>({ standard: first, ledgerlive: [], legacy: [] });
  const [picked, setPicked] = useState<Set<string>>(() => new Set(usedNotInWallet(first)));
  const { busy, error, setError, run } = useBusy();
  useDrillBack(onLeave);

  /** scan reads a batch of a scheme, and picks the used accounts in it not yet in the wallet. */
  const scan = async (s: SeedScheme, from: number) => {
    setError(null);
    try {
      const batch = await api.walletScanWalletSeed(seed.id, password, s, from, BATCH);
      setFound((f) => ({
        ...f,
        [s]: [...f[s].filter((c) => c.index < from), ...batch, ...f[s].filter((c) => c.index >= from + batch.length)],
      }));
      setPicked((p) => new Set([...p, ...usedNotInWallet(batch)]));
    } catch (e) {
      setError(walletError(e, t));
    }
  };
  const picks = picksOf(found, picked);
  const toggle = (c: SeedCandidate) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(pickKey(c))) next.delete(pickKey(c));
      else next.add(pickKey(c));
      return next;
    });

  return (
    <PhrasePicker
      found={found}
      picked={picked}
      onToggle={toggle}
      onScan={scan}
      error={error}
      aside={
        <>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("wallet.import.picked", { n: picks.length })}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || picks.length === 0}
            onClick={async () => {
              const acc = await run(() => api.walletAddSeedAccounts(seed.id, password, namePicks(picks, "")));
              if (acc) {
                await wallet.refresh();
                onDone();
              }
            }}
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t("wallet.accounts.add")}
          </button>
        </>
      }
    />
  );
}
