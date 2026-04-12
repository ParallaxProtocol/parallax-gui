import { useEffect, useState } from "react";
import { api } from "./api";
// Polls the backend wallet activity proxy every few seconds and returns
// the latest WalletStatus. Each consumer mounts its own poll loop —
// negligible overhead since the backend method is a single mutex read.
//
// 3s matches the freshness window: walletActiveWindow on the Go side is
// 12s, so polling at 3s means a wallet that just connected becomes
// visible to the UI within one poll, and a wallet that disconnects is
// detected after at most ~15s without lingering.
export function useWalletStatus(intervalMs = 3000) {
    const [status, setStatus] = useState({
        connected: false,
        lastSeenUnixMilli: 0,
    });
    useEffect(() => {
        let alive = true;
        const refresh = async () => {
            try {
                const s = await api.walletStatus();
                if (!alive)
                    return;
                setStatus((prev) => prev.connected === s.connected &&
                    prev.lastSeenUnixMilli === s.lastSeenUnixMilli
                    ? prev
                    : s);
            }
            catch {
                /* swallow — backend not yet ready */
            }
        };
        refresh();
        const id = setInterval(refresh, intervalMs);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [intervalMs]);
    return status;
}
