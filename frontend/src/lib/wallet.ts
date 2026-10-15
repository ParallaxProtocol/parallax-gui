import { createContext, useContext, useEffect, useState } from "react";
import { api, type WalletAccount, type WalletInfo } from "./api";
import { useNode } from "./live";

// The wallet's accounts, read through these hooks; WalletProvider.tsx
// holds them

export type WalletState = {
  /** Null until the backend first answers. */
  info: WalletInfo | null;
  /** The account the wallet pages show; null when there are none. */
  account: WalletAccount | null;
  /** Reads the accounts again, after an action changed them. */
  refresh: () => Promise<void>;
  select: (address: string) => Promise<void>;
};

export const WalletContext = createContext<WalletState>({
  info: null,
  account: null,
  refresh: async () => {},
  select: async () => {},
});

export const useWallet = () => useContext(WalletContext);

/** accountLabel names an account: its label, or "Account N" by its place in the wallet. */
export function accountLabel(
  a: WalletAccount,
  accounts: WalletAccount[],
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (a.name) return a.name;
  const i = accounts.findIndex((x) => x.address === a.address);
  return t("wallet.account.default", { n: i + 1 });
}

/**
 * useBalances reads every account's balance at the head, again as the head
 * moves (every few hundred blocks while syncing) and as accounts come and
 * go. Empty while the node is stopped or its head state is unavailable.
 */
export function useBalances(): Record<string, string> {
  const node = useNode();
  const { info } = useWallet();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const running = !!node?.running;
  const head = node?.syncing ? Math.floor(node.currentBlock / 500) : (node?.currentBlock ?? 0);
  const accounts = info?.accounts.map((a) => a.address).join() ?? "";

  useEffect(() => {
    if (!running || !accounts) return;
    let alive = true;
    api
      .walletBalances()
      .then((b) => alive && setBalances(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [running, head, accounts]);

  return running ? balances : {};
}
