import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { api, WalletInfo } from "./api";
import { WalletContext, type WalletState } from "./wallet";

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
      setInfo(
        (prev) =>
          prev ?? { accounts: [], selected: "", keystoreDir: "", hasPassword: false, needsSetup: false, seeds: [] },
      );
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
