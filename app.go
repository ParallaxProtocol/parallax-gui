// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"path/filepath"
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

	cfg      *backend.ConfigStore
	logs     *backend.LogTail
	node     *backend.NodeController
	wallet   *backend.Wallet
	contacts *backend.Contacts
	mcp      *backend.MCPServer
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
	var conf backend.GUIConfig
	if cfg != nil {
		conf = cfg.Get()
	}
	if conf.LogLevel > 0 {
		a.logs.SetVerbosity(conf.LogLevel)
	}
	// The logs are kept in the app's folder across restarts, unless the
	// user asked for each run to start with a clean log
	if cfg != nil {
		if err := a.logs.Persist(filepath.Join(cfg.Dir(), "logs"), conf.ClearLogsOnStartup); err != nil {
			logging.Warn("Failed to keep the logs on disk", "err", err)
		}
	}
	// --metrics.addr. The shell always starts the daemon collecting the
	// cheap metrics (the app shows its network traffic from them); serving
	// them is what the Metrics setting turns on.
	if metrics.Enabled && conf.Metrics && conf.MetricsAddr != "" {
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
		} else {
			a.wallet.SetAutoLock(conf.AutoLock())
			a.wallet.SetLockEmitter(func(locked bool) {
				a.events.emit("wallet-lock", map[string]bool{"locked": locked})
			})
		}
		if a.contacts, err = backend.OpenContacts(cfg.Dir()); err != nil {
			logging.Error("Failed to open the contacts", "err", err)
		}
		// Serves whichever node runs, so it starts before the node does
		a.mcp = backend.NewMCPServer(cfg.Dir(), backend.AssistantDeps{
			Host:     assistantHost{a},
			Node:     a.node,
			Wallet:   a.wallet,
			Contacts: a.contacts,
			Logs:     a.logs,
		})
		a.mcp.SetEmitter(func(st backend.MCPStatus) {
			a.events.emit("mcp", st)
		})
		a.mcp.SetActivityEmitter(func(act *backend.MCPActivity) {
			a.events.emit("mcp-activity", act)
		})
		a.mcp.Assistant().SetEmitter(func(pending []backend.AssistantRequest) {
			a.events.emit("assistant-requests", pending)
		})
		a.mcp.Apply(conf)
	}

	// Auto-updater: check for new releases on startup and periodically.
	backend.CleanupOldBinary()
	a.updater = backend.NewUpdater()
	a.updater.SetEmitter(func(p backend.UpdateProgress) {
		a.events.emit("update-progress", p)
	})
	a.updater.StartPeriodicCheck(30*time.Minute, func() bool {
		// An offline signer never reaches out, not even for updates
		return a.cfg != nil && !a.cfg.Get().NoUpdateCheck && !a.cfg.Get().OfflineSigner
	})

	if conf.Bootstrapped && conf.AutoStartNode && !conf.OfflineSigner {
		go func() {
			if err := a.node.Start(ctx); err != nil {
				logging.Error("Failed to auto-start the node", "err", err)
			}
		}()
	}
}

func (a *App) shutdown(ctx context.Context) {
	if a.wallet != nil {
		a.wallet.Lock()
	}
	if a.updater != nil {
		a.updater.Stop()
	}
	if a.mcp != nil {
		a.mcp.Close()
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

// BootstrapNeeded reports whether the node still needs its first-launch setup.
func (a *App) BootstrapNeeded() bool {
	return a.cfg == nil || !a.cfg.Get().Bootstrapped
}

// SaveBootstrap persists the first-launch setup, once the node would accept it.
func (a *App) SaveBootstrap(cfg backend.GUIConfig) error {
	if err := backend.ValidateConfig(cfg); err != nil {
		return err
	}
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
	// Becoming an offline signer takes the node down at once; the rest of
	// the change waits on the app's restart
	if c.OfflineSigner && !cur.OfflineSigner {
		if err := a.node.Stop(); err != nil {
			logging.Warn("Failed to stop the node for offline signing", "err", err)
		}
	}
	if a.mcp != nil {
		a.mcp.Apply(c)
	}
	if a.wallet != nil {
		a.wallet.SetAutoLock(c.AutoLock())
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
// AI assistants (MCP)
// ---------------------------------------------------------------------------

// MCPStatus reports the assistant server and how to connect to it.
func (a *App) MCPStatus() backend.MCPStatus {
	if a.mcp == nil {
		return backend.MCPStatus{}
	}
	return a.mcp.Status()
}

// MCPResetToken replaces the assistant server's access token.
func (a *App) MCPResetToken() (backend.MCPStatus, error) {
	if a.mcp == nil {
		return backend.MCPStatus{}, errors.New("the app's settings could not be loaded")
	}
	return a.mcp.ResetToken()
}

// MCPCancel stops the tool call the assistant bar shows.
func (a *App) MCPCancel() bool {
	if a.mcp == nil {
		return false
	}
	return a.mcp.CancelActivity()
}

// AssistantRequests lists what assistants asked for and wait on the user.
func (a *App) AssistantRequests() []backend.AssistantRequest {
	if a.mcp == nil {
		return []backend.AssistantRequest{}
	}
	return a.mcp.Assistant().Pending()
}

// AssistantApprove carries out a request; password is the wallet's, typed
// for a request that sends or makes an account even while the wallet is
// unlocked, and empty otherwise.
func (a *App) AssistantApprove(id, password string) (backend.AssistantRequest, error) {
	if a.mcp == nil {
		return backend.AssistantRequest{}, errors.New("no such request")
	}
	return a.mcp.Assistant().Approve(id, password)
}

// AssistantAllow answers a permission prompt: once, for the assistant
// that asked, or always.
func (a *App) AssistantAllow(id string, always bool) (backend.AssistantRequest, error) {
	if a.mcp == nil {
		return backend.AssistantRequest{}, errors.New("no such request")
	}
	return a.mcp.Assistant().Allow(id, always)
}

// AssistantReject turns a request down.
func (a *App) AssistantReject(id string) error {
	if a.mcp == nil {
		return nil
	}
	return a.mcp.Assistant().Reject(id)
}

// assistantHost is the app as the assistant tools reach it. It is its own
// type, not App methods, which the bridge would offer the frontend.
type assistantHost struct{ a *App }

func (h assistantHost) Config() backend.GUIConfig            { return h.a.cfg.Get() }
func (h assistantHost) SaveConfig(c backend.GUIConfig) error { return h.a.UpdateConfig(c) }
func (h assistantHost) StartNode() error {
	if h.a.cfg.Get().OfflineSigner {
		return errors.New("this app is an offline signer: its node never runs")
	}
	return h.a.node.Start(h.a.ctx)
}
func (h assistantHost) StopNode() error { return h.a.node.Stop() }

// ---------------------------------------------------------------------------
// Node lifecycle
// ---------------------------------------------------------------------------

func (a *App) StartNode() error                 { return a.node.Start(a.ctx) }
func (a *App) StopNode() error                  { return a.node.Stop() }
func (a *App) NodeStatus() backend.NodeStatus   { return a.node.Status() }
func (a *App) NodeDetails() backend.NodeDetails { return a.node.Details() }
func (a *App) NodeUsage() backend.Usage         { return backend.NodeUsage() }
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

// TxDetails is everything the node knows of one transaction, for a row of
// the wallet's activity opened up.
func (a *App) TxDetails(hash string) (backend.TxDetails, error) { return a.node.TxDetails(hash) }

// WalletBalances reads every wallet account's balance at the chain head.
func (a *App) WalletBalances() (map[string]string, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return nil, err
	}
	return w.Balances()
}

// WalletActivitySince lists the wallet's transactions in the blocks after
// `after` and the head it read up to, for the app's notifications.
func (a *App) WalletActivitySince(after uint64) (backend.WalletActivity, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.WalletActivity{}, err
	}
	txs, head, err := w.WalletActivity(after)
	return backend.WalletActivity{Transactions: txs, Head: head}, err
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

// WalletUnlock opens the wallet with its password, for the actions that
// sign or add keys to use without asking again, until it locks
// (backend/session.go).
func (a *App) WalletUnlock(password string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.Unlock(password)
}

// WalletLock locks the wallet: the lock button, and the shell as the
// system sleeps or its screen locks.
func (a *App) WalletLock() {
	if a.wallet != nil {
		a.wallet.Lock()
	}
}

// WalletTouch tells the wallet the user is at the app, putting off its
// auto-lock.
func (a *App) WalletTouch() {
	if a.wallet != nil {
		a.wallet.Touch()
	}
}

// withPassword runs f with the wallet password the unlocked session keeps,
// for an action that signs or adds a key; backend.ErrLocked while locked.
func withPassword[T any](a *App, f func(w *backend.Wallet, password string) (T, error)) (T, error) {
	var out T
	w, err := a.walletOrErr()
	if err != nil {
		return out, err
	}
	err = w.WithPassword(func(password string) (err error) {
		out, err = f(w, password)
		return err
	})
	return out, err
}

// WalletCreate makes a new account, its key encrypted with the wallet
// password.
func (a *App) WalletCreate(name string) (backend.WalletAccount, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletAccount, error) {
		return w.Create(name, password)
	})
}

// WalletImportPrivateKey adds an account from a raw private key in hex.
func (a *App) WalletImportPrivateKey(name, privateKey string) (backend.WalletAccount, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletAccount, error) {
		return w.ImportPrivateKey(name, privateKey, password)
	})
}

// WalletImportKeyfile adds an account from a keystore file's contents,
// opened with the file's own password.
func (a *App) WalletImportKeyfile(name, keyJSON, filePassword string) (backend.WalletAccount, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletAccount, error) {
		return w.ImportKeyfile(name, keyJSON, filePassword, password)
	})
}

// WalletSetupPassword sets the wallet password, the first step before any
// account is made or imported, and unlocks the wallet with it.
func (a *App) WalletSetupPassword(password string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.SetupPassword(password)
}

// WalletChangePassword encrypts every key and phrase of the wallet under a
// new password, which the unlocked session keeps from then on.
func (a *App) WalletChangePassword(oldPassword, newPassword string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.ChangePassword(oldPassword, newPassword)
}

// WalletCreateSeed makes a recovery phrase (with an optional passphrase)
// and its first account. The words are returned once, to be written down.
func (a *App) WalletCreateSeed(name, passphrase string) (backend.SeedPhrase, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.SeedPhrase, error) {
		return w.CreateSeed(name, password, passphrase)
	})
}

// WalletNewSeedWords makes the words of a new recovery phrase, 12 or 24,
// storing nothing until WalletCreateSeedWords.
func (a *App) WalletNewSeedWords(count int) ([]string, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return nil, err
	}
	return w.NewSeedWords(count)
}

// WalletCreateSeedWords stores a recovery phrase WalletNewSeedWords made,
// with its passphrase if any, and makes its first account.
func (a *App) WalletCreateSeedWords(name, words, passphrase string, confirmed bool) (backend.WalletAccount, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletAccount, error) {
		return w.CreateSeedWords(name, words, passphrase, password, confirmed)
	})
}

// WalletScanSeed lists accounts a recovery phrase holds under a derivation
// scheme, with their balances, for the user to choose from. Nothing is
// stored.
func (a *App) WalletScanSeed(words, passphrase, scheme string, from, count uint32) ([]backend.SeedCandidate, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return nil, err
	}
	return w.ScanSeed(words, passphrase, scheme, from, count)
}

// WalletImportSeed brings a recovery phrase into the wallet, with the
// accounts picked from a scan of it.
func (a *App) WalletImportSeed(name, words, passphrase string, picks []backend.SeedPick) (backend.WalletAccount, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletAccount, error) {
		return w.ImportSeed(name, words, passphrase, password, picks)
	})
}

// WalletScanWalletSeed lists accounts a recovery phrase the wallet holds
// has under a derivation scheme, with their balances, for the user to
// choose from. Nothing is stored.
func (a *App) WalletScanWalletSeed(seedID, scheme string, from, count uint32) ([]backend.SeedCandidate, error) {
	return withPassword(a, func(w *backend.Wallet, password string) ([]backend.SeedCandidate, error) {
		return w.ScanWalletSeed(seedID, password, scheme, from, count)
	})
}

// WalletAddSeedAccounts makes the accounts picked from a scan of a
// recovery phrase the wallet holds.
func (a *App) WalletAddSeedAccounts(seedID string, picks []backend.SeedPick) (backend.WalletAccount, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletAccount, error) {
		return w.AddSeedAccounts(seedID, password, picks)
	})
}

// WalletDeriveAccount makes the next account from a recovery phrase.
func (a *App) WalletDeriveAccount(seedID, name string) (backend.WalletAccount, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletAccount, error) {
		return w.DeriveAccount(seedID, name, password)
	})
}

// WalletRevealSeed shows a recovery phrase to its owner, who types the
// password for it even while the wallet is unlocked.
func (a *App) WalletRevealSeed(seedID, password string) (backend.SeedPhrase, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.SeedPhrase{}, err
	}
	return w.RevealSeed(seedID, password)
}

// WalletConfirmSeed records that a recovery phrase was written down.
func (a *App) WalletConfirmSeed(seedID string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.ConfirmSeed(seedID)
}

// WalletRenameSeed labels a recovery phrase.
func (a *App) WalletRenameSeed(seedID, name string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.RenameSeed(seedID, name)
}

// WalletRemoveSeed deletes a recovery phrase and the accounts made from it,
// with the password typed.
func (a *App) WalletRemoveSeed(seedID, password string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.RemoveSeed(seedID, password)
}

// WalletBackup returns an account's keystore file, encrypted with the
// wallet password, which the unlocked session vouches for. The shell
// saves it where the user chooses.
func (a *App) WalletBackup(address string) (backend.WalletBackup, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.WalletBackup, error) {
		return w.Backup(address, password)
	})
}

// WalletMarkBackedUp records that the shell saved an account's backup.
func (a *App) WalletMarkBackedUp(address string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.MarkBackedUp(address)
}

// WalletRemove deletes an account's key from this computer, with the
// password typed.
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

// WalletSend signs a confirmed send and hands it to the node.
func (a *App) WalletSend(req backend.SendRequest) (backend.SentTx, error) {
	tx, err := withPassword(a, func(w *backend.Wallet, password string) (backend.SentTx, error) {
		req.Password = password
		return w.Send(req)
	})
	if err == nil && a.contacts != nil {
		a.contacts.SentTo(req.To)
	}
	return tx, err
}

// WalletQuoteReplace works out what speeding up or cancelling a waiting
// transaction from one of the wallet's accounts costs; kind is "speedUp"
// or "cancel".
func (a *App) WalletQuoteReplace(from, hash, kind string) (backend.ReplaceQuote, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.ReplaceQuote{}, err
	}
	return w.QuoteReplace(from, hash, kind)
}

// WalletReplace signs a confirmed speed-up or cancel and hands it to the
// node.
func (a *App) WalletReplace(req backend.ReplaceRequest) (backend.SentTx, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.SentTx, error) {
		req.Password = password
		return w.Replace(req)
	})
}

// DevSetHold holds the development chain's blocks back, or lets it seal
// again (make dev only).
func (a *App) DevSetHold(hold bool) error { return a.node.SetDevHold(hold) }

// ---------------------------------------------------------------------------
// Watch-only accounts and offline signing (backend/offline.go)
// ---------------------------------------------------------------------------

// WalletAddWatchOnly follows an account whose key is on an offline signer.
func (a *App) WalletAddWatchOnly(name, address string) (backend.WalletAccount, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.WalletAccount{}, err
	}
	return w.AddWatchOnly(name, address)
}

// WalletRemoveWatchOnly stops following a watch-only account.
func (a *App) WalletRemoveWatchOnly(address string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.RemoveWatchOnly(address)
}

// OfflineBuildRequest makes a signing request for a send from a watch-only
// account.
func (a *App) OfflineBuildRequest(in backend.OfflineRequestInput) (backend.SigningRequest, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.SigningRequest{}, err
	}
	return w.BuildRequest(in)
}

// OfflinePendingRequests lists the signing requests the wallet follows.
func (a *App) OfflinePendingRequests() ([]backend.PendingRequest, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return nil, err
	}
	return w.PendingRequests()
}

func (a *App) OfflineDiscardRequest(id string) error {
	w, err := a.walletOrErr()
	if err != nil {
		return err
	}
	return w.DiscardRequest(id)
}

// OfflineReplaceRequest makes a request to cancel, or fill the nonce of,
// another.
func (a *App) OfflineReplaceRequest(id string) (backend.SigningRequest, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.SigningRequest{}, err
	}
	return w.ReplaceRequest(id)
}

// OfflineReviewSigned checks a signed transaction before it is broadcast.
func (a *App) OfflineReviewSigned(data string) (backend.SignedReview, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.SignedReview{}, err
	}
	return w.ReviewSigned(data)
}

// OfflineBroadcast sends a signed transaction through the node.
func (a *App) OfflineBroadcast(data string) (backend.SentTx, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.SentTx{}, err
	}
	rev, err := w.ReviewSigned(data)
	if err != nil {
		return backend.SentTx{}, err
	}
	tx, err := w.Broadcast(data)
	if err == nil && a.contacts != nil {
		a.contacts.SentTo(rev.Tx.To)
	}
	return tx, err
}

// OfflineReviewRequest checks a signing request on the signer, before it
// asks for the password.
func (a *App) OfflineReviewRequest(data string) (backend.RequestReview, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.RequestReview{}, err
	}
	return w.ReviewRequest(data)
}

// OfflineSignRequest signs a signing request on the signer.
func (a *App) OfflineSignRequest(data string) (backend.SignedOffline, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.SignedOffline, error) {
		return w.SignRequest(data, password)
	})
}

// ---------------------------------------------------------------------------
// Messages (backend/message.go)
// ---------------------------------------------------------------------------

// MessageSign signs a message with one of the wallet's keys.
func (a *App) MessageSign(address, message string) (backend.SignedMessage, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.SignedMessage, error) {
		return w.SignMessage(address, message, password)
	})
}

// MessageVerify checks a signature; it needs no wallet.
func (a *App) MessageVerify(address, message, signature string) (backend.MessageCheck, error) {
	return backend.VerifyMessage(address, message, signature)
}

// MessageBuildRequest makes a message signing request for a watch-only
// account.
func (a *App) MessageBuildRequest(address, message string) (backend.MessageRequest, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.MessageRequest{}, err
	}
	return w.BuildMessageRequest(address, message)
}

// MessageReviewRequest checks a message signing request on the signer.
func (a *App) MessageReviewRequest(data string) (backend.MessageRequest, error) {
	w, err := a.walletOrErr()
	if err != nil {
		return backend.MessageRequest{}, err
	}
	return w.ReviewMessageRequest(data)
}

// MessageSignRequest signs a message signing request on the signer.
func (a *App) MessageSignRequest(data string) (backend.SignedMessage, error) {
	return withPassword(a, func(w *backend.Wallet, password string) (backend.SignedMessage, error) {
		return w.SignMessageRequest(data, password)
	})
}

// MessageReviewSigned checks a signed message brought back from a signer.
func (a *App) MessageReviewSigned(data string) (backend.SignedMessageReview, error) {
	return backend.ReviewSignedMessage(data)
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

var errNoContacts = errors.New("contacts: the contacts could not be opened")

func (a *App) contactsOrErr() (*backend.Contacts, error) {
	if a.contacts == nil {
		return nil, errNoContacts
	}
	return a.contacts, nil
}

// Contacts lists the contacts: favourites first, then by name.
func (a *App) Contacts() ([]backend.Contact, error) {
	c, err := a.contactsOrErr()
	if err != nil {
		return nil, err
	}
	return c.List(), nil
}

func (a *App) ContactAdd(in backend.ContactInput) (backend.Contact, error) {
	c, err := a.contactsOrErr()
	if err != nil {
		return backend.Contact{}, err
	}
	return c.Add(in)
}

func (a *App) ContactUpdate(id string, in backend.ContactInput) (backend.Contact, error) {
	c, err := a.contactsOrErr()
	if err != nil {
		return backend.Contact{}, err
	}
	return c.Update(id, in)
}

func (a *App) ContactSetFavorite(id string, on bool) error {
	c, err := a.contactsOrErr()
	if err != nil {
		return err
	}
	return c.SetFavorite(id, on)
}

func (a *App) ContactRemove(id string) error {
	c, err := a.contactsOrErr()
	if err != nil {
		return err
	}
	return c.Remove(id)
}

// ContactsExport writes the contacts as "json" or "csv".
func (a *App) ContactsExport(format string) (string, error) {
	c, err := a.contactsOrErr()
	if err != nil {
		return "", err
	}
	return c.Export(format)
}

// ContactsImport adds the contacts of an exported contacts file.
func (a *App) ContactsImport(data string) (backend.ContactsImport, error) {
	c, err := a.contactsOrErr()
	if err != nil {
		return backend.ContactsImport{}, err
	}
	return c.Import(data)
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

func (a *App) GetLogTail(n int) []backend.LogLine { return a.logs.Tail(n) }

// SetLogVerbosity changes the active log level (0 = silent, 3 = info,
// 5 = trace).
func (a *App) SetLogVerbosity(level int) { a.logs.SetVerbosity(level) }

// ClearLogs empties the logs: the panel's tail and the file they're kept in.
func (a *App) ClearLogs() { a.logs.Clear() }

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

func (a *App) Version() string {
	return fmt.Sprintf("Parallax Wallet %s", backend.GUIVersion)
}

// Profile is the development profile this copy of the app runs as, "" for
// the default one (backend.Profile).
func (a *App) Profile() string { return backend.Profile() }

// ---------------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------------

// CheckForUpdate queries GitHub Releases for a newer version. Returns nil if
// the app is already up-to-date.
func (a *App) CheckForUpdate() (*backend.UpdateInfo, error) {
	if a.offline() {
		return nil, backend.ErrOfflineSigner
	}
	return a.updater.CheckForUpdate()
}

// offline reports whether the app is an offline signer (backend/offline.go).
func (a *App) offline() bool { return a.cfg != nil && a.cfg.Get().OfflineSigner }

// GetLatestUpdate returns the cached update info from the last check, or nil.
func (a *App) GetLatestUpdate() *backend.UpdateInfo {
	if a.offline() {
		return nil
	}
	return a.updater.Latest()
}

// ApplyUpdate downloads, verifies, and installs the latest update. Progress is
// streamed via the "update-progress" event channel.
func (a *App) ApplyUpdate() error {
	if a.offline() {
		return backend.ErrOfflineSigner
	}
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
