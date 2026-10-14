// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	"github.com/ParallaxProtocol/parallax-gui/backend"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/support/metrics"
	"github.com/ParallaxProtocol/parallax/v2/support/metrics/exp"
)

// App is what the frontend talks to. Every exported method is callable
// through the bridge (bridge.go) under its own name, as api.ts does.
type App struct {
	ctx    context.Context
	events *hub

	cfg     *backend.ConfigStore
	logs    *backend.LogTail
	node    *backend.NodeController
	wallet  *backend.Wallet
	updater *backend.Updater
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
	var conf backend.GUIConfig
	if cfg != nil {
		conf = cfg.Get()
	}
	if conf.LogLevel > 0 {
		a.logs.SetVerbosity(conf.LogLevel)
	}
	// --metrics.addr. Whether metrics are collected at all was settled at
	// process start: the shell passes --metrics when the setting is on.
	if metrics.Enabled && conf.MetricsAddr != "" {
		port := conf.MetricsPort
		if port == 0 {
			port = metrics.DefaultConfig.Port
		}
		exp.Setup(net.JoinHostPort(conf.MetricsAddr, strconv.Itoa(port)))
	}

	a.node = backend.NewNodeController(cfg)
	a.node.SetEmitter(func(evt backend.NodeEvent) {
		a.events.emit("node", evt)
	})

	// The wallet works with the node stopped: only its balances and sends
	// need the chain
	if cfg != nil {
		if a.wallet, err = backend.NewWallet(cfg.Dir(), a.node); err != nil {
			logging.Error("Failed to open the wallet", "err", err)
		}
	}

	// Auto-updater: check for new releases on startup and periodically.
	backend.CleanupOldBinary()
	a.updater = backend.NewUpdater()
	a.updater.SetEmitter(func(p backend.UpdateProgress) {
		a.events.emit("update-progress", p)
	})
	a.updater.StartPeriodicCheck(30*time.Minute, func() bool {
		return a.cfg != nil && !a.cfg.Get().NoUpdateCheck
	})

	if conf.Bootstrapped && conf.AutoStartNode {
		go func() {
			if err := a.node.Start(ctx); err != nil {
				logging.Error("Failed to auto-start the node", "err", err)
			}
		}()
	}
}

func (a *App) shutdown(ctx context.Context) {
	if a.updater != nil {
		a.updater.Stop()
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

func (a *App) GetConfig() backend.GUIConfig { return a.cfg.Get() }

// UpdateConfig saves the config the frontend edited, once the node would
// accept it. Fields the backend keeps itself (the peer lists) are carried
// over from the stored config, so a page holding an older copy can't roll
// them back.
func (a *App) UpdateConfig(c backend.GUIConfig) error {
	if err := backend.ValidateConfig(c); err != nil {
		return err
	}
	cur := a.cfg.Get()
	c.Bootstrapped = cur.Bootstrapped
	c.StaticPeers = cur.StaticPeers
	c.TrustedPeers = cur.TrustedPeers
	if err := a.cfg.Save(c); err != nil {
		return err
	}
	if c.LogLevel != cur.LogLevel {
		level := c.LogLevel
		if level == 0 {
			level = int(logging.LvlInfo)
		}
		a.logs.SetVerbosity(level)
	}
	return nil
}

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
func (a *App) Peers() []backend.PeerView                  { return a.node.Peers() }
func (a *App) RecentBlocks(n int) []backend.BlockView {
	return a.node.RecentBlocks(n)
}
func (a *App) RecentTransactions(n int) []backend.TxView {
	return a.node.RecentTransactions(n)
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

// errNoWallet answers every wallet call when the wallet could not be
// opened at startup (the log says why).
var errNoWallet = errors.New("wallet: unavailable, see the log")

func (a *App) walletOrErr() (*backend.Wallet, error) {
	if a.wallet == nil {
		return nil, errNoWallet
	}
	return a.wallet, nil
}

// WalletInfo lists the wallet's accounts and the one the app shows.
func (a *App) WalletInfo() (backend.WalletInfo, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.WalletInfo{}, err
	}
	return w.Info(), nil
}

func (a *App) WalletSelect(address string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.Select(address)
}

func (a *App) WalletRename(address, name string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.Rename(address, name)
}

// WalletCreate makes a new account, its key encrypted with password.
func (a *App) WalletCreate(name, password string) (backend.WalletAccount, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.WalletAccount{}, err
	}
	return w.Create(name, password)
}

// WalletImportPrivateKey adds an account from a raw private key in hex.
func (a *App) WalletImportPrivateKey(name, privateKey, password string) (backend.WalletAccount, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.WalletAccount{}, err
	}
	return w.ImportPrivateKey(name, privateKey, password)
}

// WalletImportKeyfile adds an account from a keystore file's contents.
func (a *App) WalletImportKeyfile(name, keyJSON, filePassword, newPassword string) (backend.WalletAccount, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.WalletAccount{}, err
	}
	return w.ImportKeyfile(name, keyJSON, filePassword, newPassword)
}

// WalletBackup returns an account's encrypted keystore file, once the
// password opens it. The shell saves it where the user chooses.
func (a *App) WalletBackup(address, password string) (backend.WalletBackup, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.WalletBackup{}, err
	}
	return w.Backup(address, password)
}

// WalletMarkBackedUp records that the shell saved an account's backup.
func (a *App) WalletMarkBackedUp(address string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.MarkBackedUp(address)
}

func (a *App) WalletChangePassword(address, oldPassword, newPassword string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.ChangePassword(address, oldPassword, newPassword)
}

// WalletRemove deletes an account's key from this computer.
func (a *App) WalletRemove(address, password string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.Remove(address, password)
}

// WalletSummary reports an account's balance, recent activity and the
// transactions it has waiting in the pool.
func (a *App) WalletSummary(address string) (backend.AddressView, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.AddressView{}, err
	}
	return w.Summary(address)
}

// WalletQuote works out what a send would cost; gasPriceWei may be empty
// for the node's suggestion.
func (a *App) WalletQuote(from, to, valueWei, gasPriceWei string) (backend.SendQuote, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.SendQuote{}, err
	}
	return w.Quote(from, to, valueWei, gasPriceWei)
}

// WalletSend signs a confirmed send with the account's password and hands
// it to the node.
func (a *App) WalletSend(req backend.SendRequest) (backend.SentTx, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.SentTx{}, err
	}
	return w.Send(req)
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

func (a *App) GetLogTail(n int) []backend.LogLine { return a.logs.Tail(n) }

// SetLogVerbosity changes the active log level (0 = silent, 3 = info,
// 5 = trace).
func (a *App) SetLogVerbosity(level int) { a.logs.SetVerbosity(level) }

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
