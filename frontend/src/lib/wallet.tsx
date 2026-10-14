import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, WalletAccount, WalletInfo } from "./api";

type WalletState = {
  /** Null until the backend first answers. */
  info: WalletInfo | null;
  /** The account the wallet pages show; null when there are none. */
  account: WalletAccount | null;
  /** Reads the accounts again, after an action changed them. */
  refresh: () => Promise<void>;
  select: (address: string) => Promise<void>;
};

const WalletContext = createContext<WalletState>({
  info: null,
  account: null,
  refresh: async () => {},
  select: async () => {},
});

/**
 * WalletProvider holds the wallet's accounts and the selected one for the
 * whole app: the sidebar's account switcher and the wallet pages read the
 * same list. It holds no secrets: keys and passwords stay in the backend.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<WalletInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await api.walletInfo());
    } catch {
      setInfo((prev) => prev ?? { accounts: [], selected: "", keystoreDir: "", hasPassword: false, needsSetup: false, seeds: [] });
    }
  }, []);

  useEffect(() => {
    refresh();
    // Another tool (parallax-wallet, a file manager) may change the
    // keystore while the app runs: look again now and then
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const select = useCallback(
    async (address: string) => {
      setInfo((prev) => (prev ? { ...prev, selected: address } : prev));
      await api.walletSelect(address).catch(() => {});
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<WalletState>(() => {
    const account = info?.accounts.find((a) => a.address === info.selected) ?? info?.accounts[0] ?? null;
    return { info, account, refresh, select };
  }, [info, refresh, select]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = () => useContext(WalletContext);

/** accountLabel names an account: its label, or "Account N" by its place in the wallet. */
export function accountLabel(a: WalletAccount, accounts: WalletAccount[], t: (k: string, v?: Record<string, string | number>) => string): string {
  if (a.name) return a.name;
  const i = accounts.findIndex((x) => x.address === a.address);
  return t("wallet.account.default", { n: i + 1 });
}
