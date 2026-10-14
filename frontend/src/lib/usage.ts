import { useEffect, useRef, useState } from "react";
import { api, Usage } from "./api";

/** How often usage is read, in ms, and how many readings the charts keep. */
const POLL_MS = 1000;
const KEEP = 60;

export type UsageView = {
  /** Speeds now, in bytes per second, and the last minute's, oldest first. */
  down: number;
  up: number;
  read: number;
  write: number;
  downs: number[];
  ups: number[];
  disks: number[];
  /** Totals since the app started. */
  inBytes: number;
  outBytes: number;
  /**
   * The node's CPU now and over the last minute, as Activity Monitor shows
   * a process' (1 is one core kept busy, so it can pass 1), and the
   * machine's load and I/O wait as shares of all its cores. cpu is null
   * where it can't be read.
   */
  cpu: number | null;
  cpus: number[];
  cpuSystem: number;
  cpuWait: number;
};

/**
 * useUsage follows what the node takes of the computer while it is shown:
 * it reads the daemon's metrics every second, working out speeds from one
 * reading to the next. Null until the second reading, or when the daemon
 * isn't counting.
 */
export function useUsage(running: boolean): UsageView | null {
  const [view, setView] = useState<UsageView | null>(null);
  const last = useRef<{ at: number; u: Usage } | null>(null);

  useEffect(() => {
    if (!running) {
      last.current = null;
      setView(null);
      return;
    }
    let alive = true;
    const read = () =>
      api
        .nodeUsage()
        .then((u) => {
          if (!alive || !u.counted) return;
          const now = Date.now();
          const prev = last.current;
          last.current = { at: now, u };
          if (!prev) return;
          const secs = Math.max(0.001, (now - prev.at) / 1000);
          const rate = (a: number, b: number) => Math.max(0, a - b) / secs;
          const down = rate(u.inBytes, prev.u.inBytes);
          const up = rate(u.outBytes, prev.u.outBytes);
          const read = rate(u.diskReadBytes, prev.u.diskReadBytes);
          const write = rate(u.diskWriteBytes, prev.u.diskWriteBytes);
          const cpu = u.cpuCounted && prev.u.cpuCounted ? Math.max(0, u.cpuSeconds - prev.u.cpuSeconds) / secs : null;
          setView((v) => ({
            down,
            up,
            read,
            write,
            downs: [...(v?.downs ?? []), down].slice(-KEEP),
            ups: [...(v?.ups ?? []), up].slice(-KEEP),
            disks: [...(v?.disks ?? []), read + write].slice(-KEEP),
            inBytes: u.inBytes,
            outBytes: u.outBytes,
            cpu,
            cpus: cpu === null ? [] : [...(v?.cpus ?? []), cpu].slice(-KEEP),
            cpuSystem: u.cpuSystem,
            cpuWait: u.cpuWait,
          }));
        })
        .catch(() => {});
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [running]);

  return view;
}
