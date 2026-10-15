import { useState } from "react";
import { api, saveBackup, walletError } from "../../lib/api";
import { useT } from "../../i18n";

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
 * backUp saves an account's keystore file where the user picks, once the
 * password opens it, and records it as backed up. False if they cancelled.
 */
export async function backUp(address: string, password: string): Promise<boolean> {
  const b = await api.walletBackup(address, password);
  const saved = await saveBackup(b.fileName, b.keyfile);
  if (saved) await api.walletMarkBackedUp(address);
  return saved;
}
