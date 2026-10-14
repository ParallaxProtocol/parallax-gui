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
- A sidebar shell with the node's heartbeat pinned at the bottom (state,
  block height, peers, uptime, sync progress and a power switch), and
  a live chip in the sidebar while a wallet is connected.
- **Overview**: the block clock (best block and the wait since, against
  the 10 minute target), sync progress while catching up, node figures,
  the latest blocks and a slide-over list of connected peers.
- **Wallet**: a step-by-step MetaMask connection (node, local RPC,
  one-click *Add network*, live connection) with manual values for any
  EVM wallet, and a watched address: balance and transactions over the
  last week, all read from the local node.
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
│   ├── address.go     Watched-address balance and activity.
│   ├── updater.go     Release checks, verified downloads, installs.
│   ├── logs.go        LogTail: GlogHandler tee'd to stderr + ring buffer
│   │                  + batched live frontend emitter.
│   ├── metamask.go    Tiny localhost helper HTTP server that serves a
│   │                  Parallax-themed page calling wallet_addEthereumChain
│   │                  in the user's default browser.
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
        ├── lib/live.tsx      One poller for node and wallet status and the
        │                     latest blocks.
        ├── lib/format.ts     wei↔LAX, byte / duration / hash helpers.
        ├── components/
        │   ├── shell/        Sidebar (with the node dock) and TopBar.
        │   └── ui/           Plate, Tile, Rolling digits, Indicator,
        │                     Drawer, Segmented, Toggle.
        ├── pages/
        │   ├── Overview/     Block clock, node tiles, latest blocks,
        │   │                 peers drawer.
        │   ├── Wallet/       MetaMask connection steps, watched address.
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

## Connecting MetaMask

The Wallet page walks through connecting MetaMask; its **Add network** button
opens a localhost helper page in the user's default browser
which fires `wallet_addEthereumChain` (or `wallet_switchEthereumChain` if
the network is already added). The helper auto-detects whether MetaMask
is already on Parallax and shows a connected confirmation instead of the
add button.

For non-MetaMask wallets, the same Wallet page also shows the manual
network values:

| Field           | Value                          |
| --------------- | ------------------------------ |
| Network name    | Parallax                       |
| RPC URL         | `http://127.0.0.1:8545`        |
| Chain ID        | `2110`                         |
| Currency symbol | `LAX`                          |

Any EVM-compatible wallet that supports custom networks can use these
values directly.
