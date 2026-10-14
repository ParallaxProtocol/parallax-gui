// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"context"
	"fmt"
	"time"

	"github.com/ParallaxProtocol/parallax-gui/backend"
	"github.com/ParallaxProtocol/parallax/v2/logging"
)

// App is what the frontend talks to. Every exported method is callable
// through the bridge (bridge.go) under its own name, as api.ts does.
type App struct {
	ctx    context.Context
	events *hub

	cfg      *backend.ConfigStore
	logs     *backend.LogTail
	node     *backend.NodeController
	metamask *backend.MetaMaskHelper
	miner    *backend.MinerController
	updater  *backend.Updater
}

// NewApp constructs the App, emitting its events through events. The heavy
// lifting (loading config, attaching the log handler) happens in startup.
func NewApp(events *hub) *App {
	return &App{events: events}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Logs first so that any subsequent setup gets captured.
	a.logs = backend.NewLogTail(2048)
	a.logs.Install()
	a.logs.SetEmitter(func(lines []backend.LogLine) {
		a.events.emit("logs", lines)
	})

	backend.InstallCrashHandler(func(reportPath string) {
		a.events.emit("crash", reportPath)
	})

	cfg, err := backend.LoadConfigStore("")
	if err != nil {
		logging.Error("Failed to load config", "err", err)
	}
	a.cfg = cfg

	a.node = backend.NewNodeController(cfg)
	a.node.SetEmitter(func(evt backend.NodeEvent) {
		a.events.emit("node", evt)
	})

	// Tiny localhost helper that serves a one-click "Add to MetaMask"
	// page. Lives for the lifetime of the GUI process so the URL is
	// stable across navigations.
	a.metamask = backend.NewMetaMaskHelper(cfg)
	if err := a.metamask.Start(); err != nil {
		logging.Error("Failed to start the MetaMask helper", "err", err)
	}

	a.miner = backend.NewMinerController(cfg, a.node)
	a.miner.SetEmitter(func(evt backend.MinerEvent) {
		a.events.emit("miner", evt)
	})

	// Auto-updater: check for new releases on startup and periodically.
	backend.CleanupOldBinary()
	a.updater = backend.NewUpdater()
	a.updater.SetEmitter(func(p backend.UpdateProgress) {
		a.events.emit("update-progress", p)
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

func (a *App) StartNode() error                 { return a.node.Start(a.ctx) }
func (a *App) StopNode() error                  { return a.node.Stop() }
func (a *App) NodeStatus() backend.NodeStatus   { return a.node.Status() }
func (a *App) NodeDetails() backend.NodeDetails { return a.node.Details() }
func (a *App) Mempool(query string, limit int) backend.MempoolView {
	return a.node.Mempool(query, limit)
}

// Peer management, from the Overview's peer list
func (a *App) AddPeer(target string) error                { return a.node.AddPeer(target) }
func (a *App) DisconnectPeer(target string) error         { return a.node.DisconnectPeer(target) }
func (a *App) SetPeerTrusted(enode string, on bool) error { return a.node.SetTrusted(enode, on) }
func (a *App) BanPeer(subnet string, seconds int64) error { return a.node.Ban(subnet, seconds) }
func (a *App) UnbanPeer(subnet string) error              { return a.node.Unban(subnet) }
func (a *App) ClearBanned() error                         { return a.node.ClearBanned() }
func (a *App) Banned() ([]backend.BanEntry, error)        { return a.node.Banned() }
func (a *App) WalletStatus() backend.WalletStatus         { return a.node.WalletStatus() }
func (a *App) Peers() []backend.PeerView                  { return a.node.Peers() }
func (a *App) RecentBlocks(n int) []backend.BlockView {
	return a.node.RecentBlocks(n)
}
func (a *App) RecentTransactions(n int) []backend.TxView {
	return a.node.RecentTransactions(n)
}

// AddressSummary reports the balance and recent activity of one address,
// for the Wallet page's watched address.
func (a *App) AddressSummary(addr string) (backend.AddressView, error) {
	return a.node.AddressSummary(addr)
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

func (a *App) StartMining(mode string) error             { return a.miner.Start(a.ctx, mode) }
func (a *App) StopMining() error                         { return a.miner.Stop() }
func (a *App) MinerStatus() backend.MinerStatus          { return a.miner.Status() }
func (a *App) DetectGPUs() ([]backend.DeviceInfo, error) { return a.miner.DetectGPUs() }
func (a *App) DefaultPools() []backend.PoolInfo          { return a.miner.DefaultPools() }
func (a *App) HashwarpInstalled() bool                   { return a.miner.HashwarpInstalled() }
func (a *App) AddDefenderExclusion() error               { return a.miner.AddDefenderExclusion() }
func (a *App) InstallHashwarp(gpuType string) error {
	return a.miner.InstallHashwarp(gpuType, func(step, detail string) {
		a.events.emit("hashwarp-install", map[string]string{
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

// RestartApp asks the shell to restart the app, onto the update just
// installed: it relaunches the app (the AppImage on Linux), or on Windows
// runs the downloaded installer, which starts the app again when done.
func (a *App) RestartApp() {
	a.events.emit("app:restart", map[string]string{
		"installer": a.updater.PendingInstaller(),
	})
}
