// Lightweight formatters used by the dashboard.

const WEI_PER_LAX = 10n ** 18n;

/** Format a wei string as LAX with up to `digits` fractional digits. */
export function formatLax(weiStr: string, digits = 4): string {
  let wei: bigint;
  try {
    wei = BigInt(weiStr || "0");
  } catch {
    return "0";
  }
  const negative = wei < 0n;
  if (negative) wei = -wei;
  const whole = wei / WEI_PER_LAX;
  const frac = wei % WEI_PER_LAX;
  let fracStr = frac.toString().padStart(18, "0").slice(0, digits);
  fracStr = fracStr.replace(/0+$/, "");
  const out = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${out}` : out;
}

/**
 * parseUnits reads a decimal amount typed by the user ("1.5", "0.000001",
 * "2") into the integer count of its smallest unit, exactly: 18 decimals
 * for LAX into wei, 9 for gwei into wei. Null for anything else: a sign,
 * an exponent, grouping, more decimals than the unit has.
 */
export function parseUnits(input: string, decimals: number): bigint | null {
  const s = input.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** formatUnits renders an integer amount of the smallest unit exactly, without trailing zeros: the inverse of parseUnits. */
export function formatUnits(v: bigint | string, decimals: number): string {
  let n = typeof v === "bigint" ? v : BigInt(v || "0");
  const negative = n < 0n;
  if (negative) n = -n;
  const base = 10n ** BigInt(decimals);
  const frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = frac ? `${n / base}.${frac}` : (n / base).toString();
  return negative ? `-${out}` : out;
}

export function shortHex(s: string, head = 6, tail = 4): string {
  if (!s || s.length < head + tail + 2) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Render a unix timestamp as a relative "Xs ago" / "Xm ago" / etc. */
export function timeAgo(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}


export function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

/** Format a large number string with SI suffixes (K, M, G, T). */
export function formatDifficulty(raw: string): string {
  if (!raw) return "0";
  let n: bigint;
  try {
    n = BigInt(raw);
  } catch {
    return raw;
  }
  if (n < 1000n) return n.toString();
  const units = ["", "K", "M", "G", "T", "P"];
  let i = 0;
  // Use float for display once we know the magnitude.
  let v = Number(n);
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  // Coarsest unit + one tier of detail; never seconds once minutes are
  // present. This keeps the dashboard's diff-based render skip from
  // firing on every 2s poll.
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

const intFormat = new Intl.NumberFormat("en-US");

/** formatInt groups thousands: 59,707. */
export function formatInt(n: number): string {
  return intFormat.format(Math.round(n));
}

/** formatClock renders an elapsed time to the second: 45 s, 8 min 03 s, 2 h 05 min. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
  return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
}

/** formatPercent renders a 0..1 share: 42%, 7.5%, 0.3%. */
export function formatPercent(share: number): string {
  const pct = share * 100;
  if (pct === 0 || pct >= 10) return `${Math.round(pct)}%`;
  return `${pct.toFixed(1)}%`;
}

/** sameAddress compares two hex addresses, ignoring checksum case. */
export function sameAddress(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** isAddress reports whether s looks like a 20-byte hex address. */
export function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

/** Seconds per block the protocol aims for. */
export const TARGET_BLOCK_SECONDS = 600;

/** formatGwei renders a wei amount in gwei: 1.5 gwei, 0.02 gwei, 120 gwei. */
export function formatGwei(weiStr: string): string {
  let wei: bigint;
  try {
    wei = BigInt(weiStr || "0");
  } catch {
    return "—";
  }
  const gwei = Number(wei) / 1e9;
  const digits = gwei >= 100 ? 0 : gwei >= 1 ? 2 : 4;
  return `${Number(gwei.toFixed(digits))} gwei`;
}
