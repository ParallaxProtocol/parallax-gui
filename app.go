// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/ParallaxProtocol/parallax-gui/backend"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the root struct bound to the Wails frontend. Every exported method
// becomes a JS-callable function under window.go.main.App.*
type App struct {
	ctx context.Context

	cfg      *backend.ConfigStore
	logs     *backend.LogTail
	node     *backend.NodeController
	metamask *backend.MetaMaskHelper
	miner    *backend.MinerController
	updater  *backend.Updater
	geo      *backend.GeoLocator
}

// NewApp constructs the App. The heavy lifting (loading config, attaching the
// log handler) happens in startup so that early errors can be surfaced to the
// frontend instead of crashing the binary.
func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Logs first so that any subsequent setup gets captured.
	a.logs = backend.NewLogTail(2048)
	a.logs.Install()
	a.logs.SetEmitter(func(line backend.LogLine) {
		wruntime.EventsEmit(ctx, "log", line)
	})

	backend.InstallCrashHandler(func(reportPath string) {
		wruntime.EventsEmit(ctx, "crash", reportPath)
	})

	cfg, err := backend.LoadConfigStore("")
	if err != nil {
		wruntime.LogErrorf(ctx, "load config: %v", err)
	}
	a.cfg = cfg

	a.node = backend.NewNodeController(cfg)
	a.node.SetEmitter(func(evt backend.NodeEvent) {
		wruntime.EventsEmit(ctx, "node", evt)
	})

	// Tiny localhost helper that serves a one-click "Add to MetaMask"
	// page. Lives for the lifetime of the GUI process so the URL is
	// stable across navigations.
	a.metamask = backend.NewMetaMaskHelper(cfg)
	if err := a.metamask.Start(); err != nil {
		wruntime.LogErrorf(ctx, "metamask helper: %v", err)
	}

	a.geo = backend.NewGeoLocator()

	a.miner = backend.NewMinerController(cfg, a.node)
	a.miner.SetEmitter(func(evt backend.MinerEvent) {
		wruntime.EventsEmit(ctx, "miner", evt)
	})

	// Auto-updater: check for new releases on startup and periodically.
	backend.CleanupOldBinary()
	a.updater = backend.NewUpdater()
	a.updater.SetEmitter(func(p backend.UpdateProgress) {
		wruntime.EventsEmit(ctx, "update-progress", p)
	})
	a.updater.StartPeriodicCheck(30 * time.Minute)
}

func (a *App) shutdown(ctx context.Context) {
	if a.updater != nil {
		a.updater.Stop()
	}
	if a.miner != nil {
		_ = a.miner.Stop()
	}
	if a.metamask != nil {
		_ = a.metamask.Stop()
	}
	if a.node != nil {
		_ = a.node.Stop()
	}
	if a.logs != nil {
		a.logs.Close()
	}
}

// ---------------------------------------------------------------------------
// Bootstrap / config
// ---------------------------------------------------------------------------

// BootstrapNeeded reports whether the onboarding wizard should run.
func (a *App) BootstrapNeeded() bool {
	return a.cfg == nil || !a.cfg.Get().Bootstrapped
}

// SaveBootstrap finalises the onboarding wizard and persists initial config.
func (a *App) SaveBootstrap(cfg backend.GUIConfig) error {
	cfg.Bootstrapped = true
	return a.cfg.Save(cfg)
}

func (a *App) GetConfig() backend.GUIConfig           { return a.cfg.Get() }
func (a *App) UpdateConfig(c backend.GUIConfig) error { return a.cfg.Save(c) }

// ---------------------------------------------------------------------------
// Node lifecycle
// ---------------------------------------------------------------------------

func (a *App) StartNode() error                   { return a.node.Start(a.ctx) }
func (a *App) StopNode() error                    { return a.node.Stop() }
func (a *App) NodeStatus() backend.NodeStatus     { return a.node.Status() }
func (a *App) WalletStatus() backend.WalletStatus { return a.node.WalletStatus() }
func (a *App) Peers() []backend.PeerView          { return a.node.Peers() }
func (a *App) RecentBlocks(n int) []backend.BlockView {
	return a.node.RecentBlocks(n)
}
func (a *App) RecentTransactions(n int) []backend.TxView {
	return a.node.RecentTransactions(n)
}

// ---------------------------------------------------------------------------
// Geo IP
// ---------------------------------------------------------------------------

// GeoSelf returns the public IP / coordinates of this machine. The result
// is cached for the lifetime of the process.
func (a *App) GeoSelf() (backend.GeoLocation, error) {
	return a.geo.LookupSelf()
}

// GeoLookupPeers resolves the current peer set's remote addresses to
// coordinates. Cached lookups are returned immediately; new addresses are
// batched against ip-api.com.
func (a *App) GeoLookupPeers() []backend.GeoLocation {
	peers := a.node.Peers()
	addrs := make([]string, 0, len(peers))
	for _, p := range peers {
		addrs = append(addrs, p.RemoteAddr)
	}
	return a.geo.LookupIPs(addrs)
}

// PublicNodes returns the public Parallax node directory snapshot. The
// upstream is polled at most once per minute and the result is cached
// in-process; this call is cheap to make from the polling dashboard.
func (a *App) PublicNodes() []backend.PublicNode {
	return a.geo.PublicNodes()
}

// ---------------------------------------------------------------------------
// MetaMask helper
// ---------------------------------------------------------------------------

// MetaMaskHelperURL returns the loopback URL of the embedded "Add to
// MetaMask" landing page. The frontend opens this in the user's default
// browser via window.runtime.BrowserOpenURL.
func (a *App) MetaMaskHelperURL() string {
	if a.metamask == nil {
		return ""
	}
	return a.metamask.URL()
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

func (a *App) GetLogTail(n int) []backend.LogLine { return a.logs.Tail(n) }

// SetLogVerbosity changes the active log level (0 = silent, 3 = info,
// 5 = trace).
func (a *App) SetLogVerbosity(level int) { a.logs.SetVerbosity(level) }

// ---------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------

func (a *App) StartMining(mode string) error              { return a.miner.Start(a.ctx, mode) }
func (a *App) StopMining() error                          { return a.miner.Stop() }
func (a *App) MinerStatus() backend.MinerStatus           { return a.miner.Status() }
func (a *App) DetectGPUs() ([]backend.DeviceInfo, error)  { return a.miner.DetectGPUs() }
func (a *App) DefaultPools() []backend.PoolInfo           { return a.miner.DefaultPools() }
func (a *App) HashwarpInstalled() bool                    { return a.miner.HashwarpInstalled() }
func (a *App) AddDefenderExclusion() error                { return a.miner.AddDefenderExclusion() }
func (a *App) InstallHashwarp(gpuType string) error {
	return a.miner.InstallHashwarp(gpuType, func(step, detail string) {
		wruntime.EventsEmit(a.ctx, "hashwarp-install", map[string]string{
			"step":   step,
			"detail": detail,
		})
	})
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

func (a *App) Version() string {
	return fmt.Sprintf("Parallax Desktop %s", backend.GUIVersion)
}

// ClientVersion returns the embedded prlx client version string.
func (a *App) ClientVersion() string {
	return a.node.ClientVersion()
}

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------

// CheckForUpdate queries GitHub Releases for a newer version. Returns nil if
// the app is already up-to-date.
func (a *App) CheckForUpdate() (*backend.UpdateInfo, error) {
	return a.updater.CheckForUpdate()
}

// GetLatestUpdate returns the cached update info from the last check, or nil.
func (a *App) GetLatestUpdate() *backend.UpdateInfo {
	return a.updater.Latest()
}

// ApplyUpdate downloads, verifies, and installs the latest update. Progress is
// streamed via the "update-progress" event channel.
func (a *App) ApplyUpdate() error {
	return a.updater.DownloadAndInstall(a.ctx)
}

// DismissUpdate hides the update notification until a newer version appears.
func (a *App) DismissUpdate() {
	a.updater.Dismiss()
}

// RestartApp launches the updated binary as a new process and then quits the
// current instance, giving the user a seamless restart experience. On Linux
// we relaunch via $APPIMAGE (set by the AppImage runtime) so the freshly
// installed AppImage runs instead of the stale binary still mapped inside
// the previous FUSE mount.
func (a *App) RestartApp() {
	target := ""
	if appimg := os.Getenv("APPIMAGE"); appimg != "" {
		target = appimg
	} else if exe, err := os.Executable(); err == nil {
		target = exe
	}
	if target != "" {
		cmd := exec.Command(target, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Start()
	}
	wruntime.Quit(a.ctx)
}
