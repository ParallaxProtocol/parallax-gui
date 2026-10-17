// Fetches the Tor the app ships (backend/tor.go runs it) into the
// backend's folder: the Tor Project's expert bundle for the platform,
// checked against the hash pinned here, of which only tor itself, the
// libraries it loads and its licence are kept (not the pluggable
// transports or the GeoIP files, which the app doesn't use).
//
//   node desktop/scripts/fetch-tor.mjs <goos> <goarch> <dest>
//
// The hashes are the release's sha256sums-signed-build.txt, its signature
// by the Tor Browser signing key (EF6E 286D DA85 EA2A 4BA7 DE68 4E2C 6E87
// 9329 8290) checked when the version was pinned. To move to a newer one,
// check that file's signature and copy its expert bundles' lines here.
//
// The Tor Project builds no bundle for Linux on arm64: that build has no
// Tor of its own and uses the one running on the computer.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = "15.0.25"; // Tor 0.4.9.14
const BUNDLES = {
  "linux-amd64": ["linux-x86_64", "19cf18726eecb362e0f21d27afa9ea9efe5da928bfdfbb1ceb5fe54519e87f4a"],
  "darwin-amd64": ["macos-x86_64", "e1ae4d4a734d28bb590839188511deb3cebc26fcbce9df66d01b2c452060fe95"],
  "darwin-arm64": ["macos-aarch64", "a3febb6179152b0b4f56a0f5cc57bf5cc8ecef7db35e7c3e9d5a044c8158c26c"],
  "windows-amd64": ["windows-x86_64", "c1988c701de2f24f7d098d1d6d7f507b58f27740d097f29c246e0524d639b252"],
};
// What is kept of the bundle's tor/ folder: the executable and its libraries
const KEEP = /^(tor|tor\.exe|lib.*\.(so[.0-9]*|dylib))$/;

const [goos, goarch, dest] = process.argv.slice(2);
if (!goos || !goarch || !dest) {
  console.error("usage: fetch-tor.mjs <goos> <goarch> <dest>");
  process.exit(2);
}
const bundle = BUNDLES[`${goos}-${goarch}`];
if (!bundle) {
  console.log(`No Tor bundle for ${goos}/${goarch}: the app will use the Tor running on the computer`);
  fs.rmSync(dest, { recursive: true, force: true });
  process.exit(0);
}
const [platform, sha256] = bundle;
const name = `tor-expert-bundle-${platform}-${RELEASE}.tar.gz`;

// Done already for this release
const stamp = path.join(dest, "RELEASE");
if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === `${RELEASE} ${platform}`) process.exit(0);

// Downloaded once into the build folder, kept for later builds
const cache = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "build", "tor");
fs.mkdirSync(cache, { recursive: true });
const archive = path.join(cache, name);
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (!fs.existsSync(archive) || hash(archive) !== sha256) {
  const url = `https://dist.torproject.org/torbrowser/${RELEASE}/${name}`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`${url}: HTTP ${res.status}`);
    process.exit(1);
  }
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
}
const got = hash(archive);
if (got !== sha256) {
  fs.rmSync(archive, { force: true });
  console.error(`${name}: SHA-256 ${got}, expected ${sha256}`);
  process.exit(1);
}

// Unpacked beside the archive, by name: GNU tar (Git Bash's, on Windows)
// would read a drive letter as a remote host
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parallax-tor-"));
try {
  fs.copyFileSync(archive, path.join(tmp, name));
  const tar = spawnSync("tar", ["-xzf", name, "tor", "docs/tor.txt"], { cwd: tmp, stdio: "inherit" });
  if (tar.status !== 0) process.exit(tar.status ?? 1);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(tmp, "tor"))) {
    if (KEEP.test(f)) fs.copyFileSync(path.join(tmp, "tor", f), path.join(dest, f));
  }
  fs.copyFileSync(path.join(tmp, "docs", "tor.txt"), path.join(dest, "LICENSE.txt"));
  for (const f of fs.readdirSync(dest)) {
    fs.chmodSync(path.join(dest, f), f === "LICENSE.txt" ? 0o644 : 0o755);
  }
  fs.writeFileSync(stamp, `${RELEASE} ${platform}\n`);
  console.log(`Tor ${RELEASE} (${platform}) in ${dest}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
