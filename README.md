# Parallax Desktop

A desktop node manager for the Parallax network. A Go backend embeds a
full `prl.Parallax` node in-process; an [Electron](https://www.electronjs.org)
shell starts it, and shows the React frontend in Chromium, which renders
at full frame rate on every platform (the earlier Wails build used
WebKitGTK on Linux, which could not).

## Features

- One binary that runs a Parallax full node — no sidecars.
- First-run wizard for picking a language, data directory, sync mode and
  inbound NAT policy.
- A sidebar shell with the wallet's account switcher at the top and the
  node's heartbeat pinned at the bottom (state, block height, peers,
  uptime, sync progress and a power switch).
- **Overview**: the block clock (best block and the wait since, against
  the 10 minute target), sync progress while catching up, node figures,
  the latest blocks and a slide-over list of connected peers.
- **Wallet**: create or import accounts (keystore file or private key),
  back them up, change their passwords, send LAX with a review of exactly
  what is signed, receive with a QR code, and follow each account's
  balance, pending and recent transactions, all through the local node.
  See [The wallet](#the-wallet).
- **Settings**: grouped sections with a scroll-tracking index, light /
  dark / system theme, a save bar that flags changes needing a node
  restart, cache sizes, the live log tail, and update checks.
- Light and dark themes in the design language of
  [status.parallaxprotocol.org](https://status.parallaxprotocol.org),
  fonts bundled so the app makes no third-party requests to render.
- Local-only crash reports written to the user's config directory.

## Building

You need Go (see `go.mod`) and Node.js 22 or newer. No C toolchain or
system libraries: the backend is pure Go and Electron brings its own
Chromium.

From the repository root:

```sh
make prlx-gui           # unpacked app for this machine, in build/package/
make prlx-gui-package   # release artifacts for this machine, in build/package/
```

`make prlx-gui` leaves a runnable app in `build/package/<os>-unpacked/`
(e.g. `build/package/linux-unpacked/parallax-client`).
`make prlx-gui-package` builds what a release ships: the AppImage on
Linux, the DMG on macOS, and on Windows both the installer and the
portable executable. Pick another platform with `GOOS`/`GOARCH`
(`make prlx-gui-package GOOS=darwin GOARCH=arm64`); the backend
cross-compiles anywhere, though electron-builder can only make a DMG on
macOS.

### Development

```sh
make dev
```

`make dev` builds the backend, starts the Vite dev server for the
frontend and runs Electron against it: frontend edits hot-reload, and
F12 opens the developer tools. Restart it after backend changes.

If you're also making changes to the core
[parallax](https://github.com/ParallaxProtocol/parallax) module, add a
`replace` directive to `go.mod` so the GUI builds against your local
checkout:

```
replace github.com/ParallaxProtocol/parallax => ../parallax
```

Remove it before committing.

## Releases

Tagged releases are produced by `.github/workflows/release.yml`. On
`git push` of a `v*` tag, the workflow builds the GUI on a native runner
per OS with `make prlx-gui-package`:

- `linux/amd64` and `linux/arm64` on Ubuntu: AppImages.
- `darwin/amd64` and `darwin/arm64` on `macos-14` (Apple Silicon): DMGs,
  ad-hoc signed.
- `windows/amd64` on `windows-latest`: an installer and a portable
  executable.

Artifact names stay as the in-app updater expects them
(`Parallax-Client-<version>-<os>-<arch>.<ext>`), so earlier installs,
Wails builds included, find these releases as their next update.

All artifacts are combined into a single `release/` directory with a
unified `SHA256SUMS.txt` and published as a **draft** GitHub Release.

You can also dry-run the workflow against `main` via the Actions tab —
the build jobs run but the release-publishing job is gated on a tag push.

CLI binaries (`parallaxd`, `parallax-cli`, `parallax-wallet`, `clef`) are built and released from
the main [parallax](https://github.com/ParallaxProtocol/parallax)
repository.

## Contributing a localization

Parallax Desktop ships with English, Deutsch, Français, Português
(Brasil), Русский, 中文（新加坡）, and 中文（繁體）. English lives in
[`frontend/src/i18n/translations.ts`](frontend/src/i18n/translations.ts)
and is bundled with the app as the fallback; every other language is its
own file under [`frontend/src/i18n/locales/`](frontend/src/i18n/locales/),
loaded on first use. Keys are flat and dot-notated (e.g. `nav.overview`,
`settings.rpc.enable`).

To add a new language:

1. Add the BCP-47 tag to the `Lang` union and a display name to
   `LANG_NAMES` at the top of `translations.ts`.
2. Copy an existing file in `locales/` to `locales/<tag>.ts` and translate
   each value. Leave `{placeholder}` tokens untouched — they are
   substituted at runtime by `t(key, vars)`.
3. Register it in `LOADERS` in `translations.ts`.
4. Extend the `detectInitial()` matcher and the saved-value guard in
   [`frontend/src/i18n/index.tsx`](frontend/src/i18n/index.tsx) so the
   new tag is recognised by `navigator.language` and persisted in
   `localStorage`.
5. Run `make dev` and switch languages from **Settings → General** (or
   the onboarding picker) to verify the strings render and nothing
   overflows.

Missing keys automatically fall back to English, so partial translations
are fine for a first pass — open a PR and we'll help fill the gaps.

## Architecture

```
.
├── main.go            parallax-backend: starts the App, serves the bridge,
│                      prints the handshake line, stops cleanly when the
│                      shell goes away (stdin closes) or on a signal.
├── bridge.go          Loopback HTTP bridge guarded by a random token:
│                      POST /call runs an exported App method by name,
│                      GET /events streams backend events (SSE).
├── app.go             App: every exported method is callable from the
│                      frontend under its own name.
├── backend/
│   ├── config.go      GUIConfig persistence (~/.config/Parallax/gui.json).
│   ├── node.go        NodeController: in-process node.Node + prl.Parallax
│   │                  lifecycle, status snapshot, bootnode wiring, DNS
│   │                  discovery defaults, RPC endpoint formatting,
│   │                  Peers() and RecentBlocks/Transactions() walkers.
│   ├── wallet.go      The wallet: accounts in an encrypted keystore,
│   │                  backups, quotes and signing/sending transfers.
│   ├── address.go     An account's balance, activity and pool entries.
│   ├── updater.go     Release checks, verified downloads, installs.
│   ├── logs.go        LogTail: GlogHandler tee'd to stderr + ring buffer
│   │                  + batched live frontend emitter.
│   ├── crash.go       Crash report writer; installs a recover() hook.
│   └── types.go       JSON structs shared with the frontend.
├── desktop/           The Electron shell (TypeScript).
│   ├── src/main.ts    Starts the backend, serves the frontend on app://
│   │                  with a Content-Security-Policy, relays calls and
│   │                  events, restarts onto updates, single instance.
│   ├── src/backend.ts The backend child process and its bridge client.
│   ├── src/preload.ts window.parallax for the sandboxed renderer.
│   └── electron-builder.yml  Packaging per platform.
└── frontend/          React + Vite + TypeScript + Tailwind v4 + motion.
    └── src/
        ├── App.tsx           Shell: sidebar, top bar, routes and their
        │                     transitions, splash screen.
        ├── styles.css        Design tokens (dark + light) and primitives.
        ├── lib/api.ts        Typed wrappers around the App methods.
        ├── lib/live.tsx      One poller for node status and the latest blocks.
        ├── lib/wallet.tsx    The wallet's accounts and the selected one.
        ├── lib/format.ts     wei↔LAX, byte / duration / hash helpers.
        ├── components/
        │   ├── shell/        Sidebar (with the node dock) and TopBar.
        │   └── ui/           Plate, Tile, Rolling digits, Indicator,
        │                     Drawer, Segmented, Toggle.
        ├── pages/
        │   ├── Overview/     Block clock, node tiles, latest blocks,
        │   │                 peers drawer.
        │   ├── Wallet/       Overview, send, receive, accounts and their
        │   │                 create / import / backup / password flows.
        │   ├── Settings/     Grouped settings, save bar, live log tail.
        │   └── Onboarding/   First-run wizard.
        └── assets/           Logo mark (the logo gradient).
```

The renderer runs sandboxed with context isolation and no Node access;
it reaches the backend only through `window.parallax`, which the main
process checks comes from the app's own pages. The bridge token never
leaves the main process.

## Security defaults

- **HTTP-RPC** is on by default and bound to `127.0.0.1` only. There is
  no UI option to expose it to `0.0.0.0`. Users can disable the
  endpoint entirely from Settings → Network.
- **Inbound NAT** is on by default — the node opens a UPnP/PMP mapping so
  other peers can dial in, helping the network. Users behind strict
  firewalls or who prefer outbound-only can flip the toggle in
  Settings → Network (or during first-run onboarding).
- **Crash reports** are written to `<userConfigDir>/Parallax/crash-*.log`
  and never sent off the machine.

## The wallet

The wallet is built on the daemon's own key management rather than new
cryptography:

- **Keys** are generated from the OS's secure random source and stored by
  the daemon's `wallet/keystore` package: one Web3 Secret Storage file per
  account (scrypt with the standard cost, AES-128-CTR), the same format
  `parallaxd` and `parallax-wallet` use. Passwords must be at least 8
  characters.
- **Where**: `<userConfigDir>/Parallax/keystore` (e.g.
  `~/.config/Parallax/keystore`), apart from the chain data directory so a
  resync can't take keys with it. Directory `0700`, files `0600`. Labels
  and backup status live beside it in `wallet.json`, which holds nothing
  secret. The keystore is never attached to the node, so nothing that
  connects to its RPC can list or use these accounts.
- **Nothing is left unlocked.** A key is decrypted only for the one action
  its password was typed for (signing a transaction, checking a backup,
  changing the password) and zeroed right after.
- **Sending**: the app asks the node for the fee and gas (a plain
  transfer is exactly 21,000 gas; a contract recipient is estimated),
  shows the full recipient address, amount, fee and total for review, and
  signs an EIP-155 transaction bound to the running chain's ID once the
  password is given. The backend re-checks every field and the signature,
  then submits through the node's own `eth_sendRawTransaction` path, so the
  fee cap and pool rules apply. Mixed-case recipients must pass the EIP-55
  checksum; the zero address is refused.
- **Backups** are the account's keystore file, still encrypted, saved
  where the user picks (only after the password proves to open it). Any
  compatible wallet can restore from the file and its password.

To use these accounts from the command line, point `parallax-wallet` at
the same directory with `--keystore`.

The local HTTP-RPC endpoint is still there for local apps, dapps and
developer tools (Settings → RPC); the wallet doesn't need it.
