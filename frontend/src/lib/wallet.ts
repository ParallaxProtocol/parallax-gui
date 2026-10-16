import { createContext, useContext, useEffect, useState } from "react";
import {
  api,
  type HardwareKind,
  type HardwareWalletInfo,
  type SeedInfo,
  type SeedScheme,
  type WalletAccount,
  type WalletInfo,
} from "./api";
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
 * each hardware wallet, and watch-only accounts, whose keys are on an
 * offline signer. A hardware wallet's accounts whose wallet no device has
 * told yet are a group of their kind of device, with no wallet.
 */
export type AccountGroup =
  | { kind: "phrase"; seed: SeedInfo; accounts: WalletAccount[] }
  | { kind: "hardware"; device: HardwareKind; wallet: HardwareWalletInfo | null; accounts: WalletAccount[] }
  | { kind: "keys" | "watch"; accounts: WalletAccount[] };

/** groupKey tells groups apart, for lists of them. */
export const groupKey = (g: AccountGroup) =>
  g.kind === "phrase" ? g.seed.id : g.kind === "hardware" ? `hardware:${g.wallet?.id ?? g.device}` : g.kind;

/**
 * groupAccounts gathers the accounts as Settings and the account switcher
 * show them: the phrases in the order they were added, then single keys,
 * the hardware wallets in the order they were first seen (those of no
 * known wallet after), then watch-only accounts, each in the wallet's
 * order. An account whose
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
    { kind: "keys" as const, accounts: info.accounts.filter((a) => !a.watchOnly && !a.hardware && !ofPhrase(a)) },
    ...(info.hardwareWallets ?? []).map((wallet) => ({
      kind: "hardware" as const,
      device: wallet.kind,
      wallet,
      accounts: info.accounts.filter((a) => a.hardware && a.hardwareWallet === wallet.id),
    })),
    ...(["ledger", "trezor"] as const).map((device) => ({
      kind: "hardware" as const,
      device,
      wallet: null,
      accounts: info.accounts.filter(
        (a) => a.hardware === device && !(info.hardwareWallets ?? []).some((w) => w.id === a.hardwareWallet),
      ),
    })),
    { kind: "watch" as const, accounts: info.accounts.filter((a) => a.watchOnly) },
  ];
}

/**
 * hardwarePlace reads where along its device's paths a hardware wallet
 * account is: Ledger Live's m/44'/60'/n'/0/0, the standard m/44'/60'/0'/0/n
 * or the legacy m/44'/60'/0'/n, and n. The first account, on both the
 * standard path and Ledger Live's, counts as the device's default's (Ledger
 * Live on a Ledger). Null for a path that is none of them.
 */
export function hardwarePlace(a: WalletAccount): { scheme: SeedScheme; index: number } | null {
  const parts = a.hardwarePath.split("/");
  if (parts[0] !== "m" || parts[1] !== "44'" || parts[2] !== "60'") return null;
  const num = (p: string | undefined, hardened: boolean) => {
    const m = p?.match(hardened ? /^(\d+)'$/ : /^(\d+)$/);
    return m ? Number(m[1]) : null;
  };
  const account = num(parts[3], true);
  if (account === null) return null;
  if (parts.length === 5) {
    const index = num(parts[4], false);
    return account === 0 && index !== null ? { scheme: "legacy", index } : null;
  }
  if (parts.length !== 6 || num(parts[4], false) !== 0) return null;
  const index = num(parts[5], false);
  if (index === null) return null;
  if (account === 0 && index === 0) return { scheme: a.hardware === "ledger" ? "ledgerlive" : "standard", index: 0 };
  if (index === 0) return { scheme: "ledgerlive", index: account };
  return account === 0 ? { scheme: "standard", index } : null;
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
