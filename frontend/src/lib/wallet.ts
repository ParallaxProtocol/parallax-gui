import { createContext, useContext, useEffect, useState } from "react";
import { api, type SeedInfo, type WalletAccount, type WalletInfo } from "./api";
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
 * AccountGroup is the wallet's accounts gathered by what keeps their keys:
 * each recovery phrase (with none yet, if all were removed), single keys,
 * and watch-only accounts, whose keys are on an offline signer.
 */
export type AccountGroup =
  | { kind: "phrase"; seed: SeedInfo; accounts: WalletAccount[] }
  | { kind: "keys" | "watch"; accounts: WalletAccount[] };

/**
 * groupAccounts gathers the accounts as Settings and the account switcher
 * show them: the phrases in the order they were added, then single keys,
 * then watch-only accounts, each in the wallet's order. An account whose
 * phrase is gone from the vault (another tool) counts as a single key, as
 * it is one now.
 */
export function groupAccounts(info: WalletInfo): AccountGroup[] {
  const seedIds = new Set(info.seeds.map((s) => s.id));
  const ofPhrase = (a: WalletAccount) => a.fromSeed && seedIds.has(a.seedId);
  return [
    ...info.seeds.map((seed) => ({
      kind: "phrase" as const,
      seed,
      accounts: info.accounts.filter((a) => a.fromSeed && a.seedId === seed.id),
    })),
    { kind: "keys" as const, accounts: info.accounts.filter((a) => !a.watchOnly && !ofPhrase(a)) },
    { kind: "watch" as const, accounts: info.accounts.filter((a) => a.watchOnly) },
  ];
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
