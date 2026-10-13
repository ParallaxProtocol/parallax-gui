# Parallax Desktop

A desktop node manager for the Parallax network. Built on
[Wails v2](https://wails.io) — a Go backend embeds a full `prl.Parallax`
node in-process and exposes it to a React frontend rendered in the
platform's native webview. One binary, no sidecars.

## Features

- One binary that runs a Parallax full node — no sidecars.
- First-run wizard for picking a language, data directory, sync mode and
  inbound NAT policy.
- A sidebar shell with the node's heartbeat pinned at the bottom (state,
  block height, peers, uptime, sync progress and a power switch), and
  live chips in the top bar while a wallet is connected or the miner runs.
- **Overview**: the block clock (best block and the wait since, against
  the 10 minute target), sync progress while catching up, node figures,
  the latest blocks (blocks your mining address found are marked) and a
  slide-over list of connected peers.
- **Wallet**: a step-by-step MetaMask connection (node, local RPC,
  one-click *Add network*, live connection) with manual values for any
  EVM wallet, and a watched address: balance, blocks mined and
  transactions over the last week, all read from the local node.
- **Mining**: GPU pool, GPU solo and CPU solo modes, hashwarp install
  with Windows Defender recovery, custom pools, device selection, and a
  live view with a hashrate chart, shares and per-GPU stats.
- **Settings**: grouped sections with a scroll-tracking index, light /
  dark / system theme, a save bar that flags changes needing a node
  restart, cache sizes, the live log tail, and update checks.
- Light and dark themes in the design language of
  [status.parallaxprotocol.org](https://status.parallaxprotocol.org),
  fonts bundled so the app makes no third-party requests to render.
- Local-only crash reports written to the user's config directory.

## Building

The first time you build, install the Wails CLI:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

On Linux you also need GTK3 + WebKit2GTK 4.1 + pkg-config:

```sh
# Arch
sudo pacman -S --needed gtk3 webkit2gtk-4.1 pkgconf

# Debian / Ubuntu
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config
```

Then from the repository root:

```sh
make prlx-gui              # build for the host platform
make prlx-gui-cross        # cross-build (best-effort, see notes below)
make prlx-gui-package      # build + zip per GUI_TARGETS into build/package/
```

Output is in `build/bin/`. Run it with:

```sh
./build/bin/Parallax\ Client
```

### Development

```sh
wails dev
```

`wails dev` runs Vite in watch mode and live-reloads both the Go
bindings and the React frontend.

If you're also making changes to the core
[parallax](https://github.com/ParallaxProtocol/parallax) module, add a
`replace` directive to `go.mod` so the GUI builds against your local
checkout:

```
replace github.com/ParallaxProtocol/parallax => ../parallax
```

Remove it before committing.

### Build tags

Two tags are applied to every Parallax Desktop build via the Makefile's
`WAILS_TAGS` variable (default `embedfrontend webkit2_41`):

- **`embedfrontend`** — switches `embed.go` (the real
  `//go:embed all:frontend/dist`) on. Without it, the build falls back
  to the empty `embed_stub.go`. The tag is required for any production
  binary that needs to actually serve the UI; plain `go test ./...`
  from CI deliberately runs without it so the package compiles cleanly
  on a fresh checkout where `frontend/dist/` hasn't been populated yet.
- **`webkit2_41`** — selects the modern WebKit2GTK ABI on Linux. Wails
  2.x defaults to 4.0 but Arch and recent Debian/Ubuntu only ship 4.1.
  Harmless on macOS / Windows.

Override with `make prlx-gui WAILS_TAGS="…"` if you need different tags.

### Cross-compilation notes

Wails GUI cross-compilation is fragile by design — building `darwin/*`
from a non-mac host requires `osxcross`, `windows/*` from a non-windows
host requires `mingw-w64`, etc. `make prlx-gui-package` runs `wails build`
once per `GUI_TARGETS` entry and continues past failures, so you'll get
zips for whatever your local toolchain can produce.

For full multi-platform releases, see the **Releases** section below — the
release workflow uses one native runner per OS, sidestepping the
cross-compile problem entirely.

## Releases

Tagged releases are produced by `.github/workflows/release.yml`. On
`git push` of a `v*` tag, the workflow builds the GUI on a native runner
per OS:

- `linux/amd64` and `linux/arm64` on Ubuntu (apt installs the GTK +
  WebKit deps).
- `darwin/amd64` and `darwin/arm64` on `macos-14` (Apple Silicon).
- `windows/amd64` on `windows-latest`.

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
5. Run `wails dev` and switch languages from **Settings → General** (or
   the onboarding picker) to verify the strings render and nothing
   overflows.

Missing keys automatically fall back to English, so partial translations
are fine for a first pass — open a PR and we'll help fill the gaps.

## Architecture

```
.
├── main.go            Wails bootstrap, window options, asset embedding.
├── app.go             App struct bound to the frontend (every exported
│                      method becomes a JS-callable function).
├── embed.go           Real //go:embed of frontend/dist, gated on the
│                      `embedfrontend` build tag.
├── embed_stub.go      Empty embed.FS fallback for non-tagged builds
│                      (used by `go test ./...` from CI).
├── backend/
│   ├── config.go      GUIConfig persistence (~/.config/Parallax/gui.json).
│   ├── node.go        NodeController: in-process node.Node + prl.Parallax
│   │                  lifecycle, status snapshot, bootnode wiring, DNS
│   │                  discovery defaults, RPC endpoint formatting,
│   │                  Peers() and RecentBlocks/Transactions() walkers.
│   ├── miner.go       MinerController: GPU pool mining (hashwarp) and
│   │                  CPU solo mining, device detection, live stats.
│   ├── logs.go        LogTail: GlogHandler tee'd to stderr + ring buffer
│   │                  + live frontend emitter. Verbosity defaults to Info.
│   ├── metamask.go    Tiny localhost helper HTTP server that serves a
│   │                  Parallax-themed page calling wallet_addEthereumChain
│   │                  in the user's default browser.
│   ├── crash.go       Crash report writer; installs a recover() hook.
│   └── types.go       Wails-serialisable structs shared with the frontend.
└── frontend/          React + Vite + TypeScript + Tailwind v4 + motion.
    └── src/
        ├── App.tsx           Shell: sidebar, top bar, routes and their
        │                     transitions, splash screen.
        ├── styles.css        Design tokens (dark + light) and primitives.
        ├── lib/api.ts        Typed wrappers around the bound App methods.
        ├── lib/live.tsx      One poller for node, miner and wallet status,
        │                     latest blocks and chart histories.
        ├── lib/format.ts     wei↔LAX, byte / duration / hash helpers.
        ├── components/
        │   ├── shell/        Sidebar (with the node dock) and TopBar.
        │   └── ui/           Plate, Tile, Rolling digits, Indicator,
        │                     charts, Drawer, Segmented, Toggle.
        ├── pages/
        │   ├── Overview/     Block clock, node tiles, latest blocks,
        │   │                 peers drawer.
        │   ├── Wallet/       MetaMask connection steps, watched address.
        │   ├── Mining/       Mode, setup, hashwarp install, live stats.
        │   ├── Settings/     Grouped settings, save bar, live log tail.
        │   └── Onboarding/   First-run wizard.
        └── assets/           Logo mark (the logo gradient).
```

## Security defaults

- **HTTP-RPC** is on by default and bound to `127.0.0.1` only. There is
  no UI option to expose it to `0.0.0.0`. Users can disable the
  endpoint entirely from Settings → Network.
- **Inbound NAT** is on by default — Wails opens a UPnP/PMP mapping so
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
