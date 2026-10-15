import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api, SeedCandidate, SeedInfo, SeedScheme, walletError } from "../../../lib/api";
import { useWallet } from "../../../lib/wallet";
import { useT } from "../../../i18n";
import { useBusy, useNamePicks } from "../../Wallet/accountActions";
import { type Found, pickKey, picksOf } from "../../Wallet/PhraseImport";
import { useDrillBack } from "./flow";
import { BATCH, PhrasePicker } from "./Picker";

/** usedNotInWallet picks the accounts of a batch that hold something and aren't in the wallet yet. */
const usedNotInWallet = (batch: SeedCandidate[]) => batch.filter((c) => c.used && !c.inWallet).map(pickKey);

/**
 * FindAccounts brings in more of the accounts a recovery phrase in the
 * wallet holds, picked from a PhrasePicker (which reads the first ones as
 * it opens) and added from its accounts' header.
 */
export function FindAccounts({ seed, onLeave, onDone }: { seed: SeedInfo; onLeave: () => void; onDone: () => void }) {
  const t = useT();
  const wallet = useWallet();
  const namePicks = useNamePicks();
  const [found, setFound] = useState<Found>({ standard: [], ledgerlive: [], legacy: [] });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy, error, setError, run } = useBusy();
  useDrillBack(onLeave);

  /** scan reads a batch of a scheme, and picks the used accounts in it not yet in the wallet. */
  const scan = async (s: SeedScheme, from: number) => {
    setError(null);
    try {
      const batch = await api.walletScanWalletSeed(seed.id, s, from, BATCH);
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
              const acc = await run(() => api.walletAddSeedAccounts(seed.id, namePicks(picks, "")));
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
