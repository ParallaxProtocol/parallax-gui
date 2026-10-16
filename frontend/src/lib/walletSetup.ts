/**
 * Whether the first launch's wallet setup was left between its password
 * and its recovery phrase: the password is set as soon as it is chosen,
 * but nothing of the phrase is stored until its last step, so an app
 * closed in between opens to a wallet with a password and no accounts.
 * Unlocked, it then goes back to the setup's phrase (LockGate).
 */
const KEY = "wallet.setupPending";

export function setupPending(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSetupPending(pending: boolean) {
  try {
    if (pending) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: a setup left halfway just won't resume */
  }
}
