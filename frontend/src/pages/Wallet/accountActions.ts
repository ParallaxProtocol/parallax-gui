import { useEffect, useRef, useState } from "react";
import { api, saveBackup, SeedPick, SeedScheme, walletError } from "../../lib/api";
import { useNode } from "../../lib/live";
import type { Found } from "./PhraseImport";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { MIN_PASSWORD } from "./common";

/**
 * What the account forms (AccountForms.tsx) and the add-account pages share
 * that is not itself a component, kept apart from them so their files hold
 * components alone, as Fast Refresh needs to update them in place.
 */

/** useBusy runs one action at a time, keeping its error in the user's language. */
export function useBusy() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(walletError(e, t));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/**
 * useNewNames gives the names new accounts take when none is typed:
 * "Account N" on, N one past the wallet's accounts, skipping the numbers
 * an account goes by already. Saved with the accounts, they stay put as
 * others come and go, as the number of a place in the list wouldn't.
 */
export function useNewNames(): (count: number) => string[] {
  const t = useT();
  const { info } = useWallet();
  return (count) => {
    const accounts = info?.accounts ?? [];
    const taken = new Set(accounts.map((a) => accountLabel(a, accounts, t)));
    const names: string[] = [];
    for (let n = accounts.length + 1; names.length < count; n++) {
      const name = t("wallet.account.default", { n });
      if (!taken.has(name)) names.push(name);
    }
    return names;
  };
}

/** useDefaultName is the name one new account takes when none is typed. */
export function useDefaultName(): string {
  return useNewNames()(1)[0];
}

/**
 * useNamePicks names the accounts picked from a phrase in order: the
 * first the name typed, if any, and the rest (or all) Account N on.
 */
export function useNamePicks(): (picks: SeedPick[], typed: string) => SeedPick[] {
  const newNames = useNewNames();
  return (picks, typed) => {
    const name = typed.trim();
    const names = name ? [name, ...newNames(picks.length - 1)] : newNames(picks.length);
    return picks.map((p, i) => ({ ...p, name: names[i] }));
  };
}

/**
 * backUp saves an account's keystore file where the user picks, once the
 * password opens it, and records it as backed up. False if they cancelled.
 */
export async function backUp(address: string, password: string): Promise<boolean> {
  const b = await api.walletBackup(address, password);
  const saved = await saveBackup(b.fileName, b.keyfile);
  if (saved) await api.walletMarkBackedUp(address);
  return saved;
}

export type Strength = 0 | 1 | 2 | 3 | 4;

/**
 * rate gives a rough strength for a password, 0 (too short) to 4: length
 * counts most, with a step for mixing kinds of character. It only guides;
 * the backend's rule is the minimum length.
 */
export function rate(p: string): Strength {
  const n = [...p].length;
  if (n < MIN_PASSWORD) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  let s = n >= 20 ? 3 : n >= 14 ? 2 : 1;
  if (kinds >= 3 || /\s\S+\s/.test(p)) s += 1;
  return Math.min(4, s) as Strength;
}

/**
 * useRescanUnread scans again the accounts a phrase's scans found while
 * the node couldn't read the chain (stopped, or snap syncing), which show
 * addresses only: as it comes to, those shown are read again for what
 * they hold, a batch at a time, and the used ones picked. It tries again
 * every 500 blocks while it can't, as the wallet's balances do.
 */
export function useRescanUnread(
  found: Found,
  onScan: (scheme: SeedScheme, from: number) => Promise<void>,
  batch: number,
) {
  const node = useNode();
  const head = node?.syncing ? Math.floor(node.currentBlock / 500) : (node?.currentBlock ?? 0);
  const rescanning = useRef(false);
  useEffect(() => {
    if (!node?.running || rescanning.current) return;
    const unread = (Object.keys(found) as SeedScheme[]).filter((s) => found[s].some((c) => c.balanceWei === ""));
    if (unread.length === 0) return;
    rescanning.current = true;
    (async () => {
      for (const s of unread) for (let from = 0; from < found[s].length; from += batch) await onScan(s, from);
      rescanning.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.running, head]);
}
