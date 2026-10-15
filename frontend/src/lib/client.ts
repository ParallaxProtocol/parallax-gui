/**
 * A peer's client string, made readable. Nodes announce themselves as
 * `name[/identity]/version[-meta][-commit]/os-arch/goversion`, e.g.
 * "Prlx/v2.1.0-stable-1a2b3c4d/linux-amd64/go1.24.4".
 */
export type ClientInfo = {
  /** The client's name, as people know it ("Parallax", "Parallax Wallet"). */
  name: string;
  /** The operator's own label, when the node sets one. */
  identity?: string;
  /** "v2.1.0", with any pre-release tag ("v2.2.0-unstable"); the commit is left out. */
  version?: string;
  /** "Linux", "macOS", "Windows"… */
  os?: string;
  /** "x64", "ARM64"… */
  arch?: string;
  /** The Go release it was built with, "1.24.4". */
  go?: string;
};

const NAMES: Record<string, string> = {
  prlx: "Parallax",
  parallax: "Parallax",
  parallaxd: "Parallax",
  parallaxgui: "Parallax Wallet",
};

const OS: Record<string, string> = {
  linux: "Linux",
  darwin: "macOS",
  windows: "Windows",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  netbsd: "NetBSD",
  android: "Android",
  ios: "iOS",
};

const ARCH: Record<string, string> = {
  amd64: "x64",
  "386": "x86",
  arm64: "ARM64",
  arm: "ARM",
  riscv64: "RISC-V",
  ppc64le: "POWER",
  s390x: "s390x",
};

const VERSION = /^v?(\d+\.\d+(?:\.\d+)?)(?:-([A-Za-z][\w.]*))?/;
const PLATFORM = /^([a-z0-9]+)-([a-z0-9]+)$/;

/** parseClient reads a client string; a part it can't place is left out, and an unrecognised string yields just its name. */
export function parseClient(raw: string): ClientInfo {
  const parts = (raw || "").split("/").filter(Boolean);
  if (parts.length === 0) return { name: "" };

  const info: ClientInfo = { name: NAMES[parts[0].toLowerCase()] ?? parts[0] };
  // The version is the first part after the name that reads as one; a
  // part before it is the operator's identity
  const vi = parts.findIndex((p, i) => i > 0 && VERSION.test(p));
  if (vi < 0) return parts.length === 1 ? info : { name: raw };
  if (vi === 2) info.identity = parts[1];

  const [, num, meta] = parts[vi].match(VERSION)!;
  // "stable" is the default and says nothing; any other tag ("unstable",
  // "rc1") is worth seeing. A commit (a run of hex, with or without a tag
  // before it) is left out
  const tag = meta && meta.toLowerCase() !== "stable" && !/^[0-9a-f]{7,}$/i.test(meta) ? meta : "";
  info.version = `v${num}${tag ? `-${tag}` : ""}`;

  for (const p of parts.slice(vi + 1)) {
    const platform = p.match(PLATFORM);
    if (platform && !info.os) {
      info.os = OS[platform[1]] ?? platform[1];
      info.arch = ARCH[platform[2]] ?? platform[2];
    } else if (/^go\d/.test(p)) {
      info.go = p.slice(2);
    }
  }
  return info;
}
