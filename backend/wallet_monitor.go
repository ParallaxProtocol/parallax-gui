// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"
	"time"
)

// WalletStatus is the dashboard's view of whether any local wallet is
// currently talking to our JSON-RPC endpoint. Connected = at least one
// HTTP request was seen within walletActiveWindow.
type WalletStatus struct {
	Connected         bool  `json:"connected"`
	LastSeenUnixMilli int64 `json:"lastSeenUnixMilli"`
}

// walletActiveWindow is the staleness threshold for "wallet connected".
// MetaMask polls eth_blockNumber roughly every 4s while its UI is open;
// other wallets poll on similar cadences. 12s is a comfortable margin
// that smooths over a single missed poll without lingering after the
// wallet actually disconnects.
const walletActiveWindow = 12 * time.Second

// WalletMonitor wraps the embedded node's HTTP RPC port behind a tiny
// reverse proxy that timestamps every incoming request. The dashboard
// polls the resulting LastSeen value to show a "wallet connected" hint
// without having to know which wallet is actually talking — any HTTP
// client hitting the local RPC counts.
type WalletMonitor struct {
	mu       sync.RWMutex
	lastSeen time.Time

	// User-facing port the wallet connects to (the value the dashboard
	// shows in RPCEndpoint). The actual parallax HTTP listener is
	// rebound to internalPort and we sit between them.
	publicPort   int
	internalPort int

	server *http.Server
}

// NewWalletMonitor builds a stopped monitor. Call Start to bind the
// proxy and tear it down with Stop on shutdown.
func NewWalletMonitor(publicPort, internalPort int) *WalletMonitor {
	return &WalletMonitor{
		publicPort:   publicPort,
		internalPort: internalPort,
	}
}

// LastSeen returns the most recent timestamp at which any HTTP request
// passed through the proxy. Zero value if nothing has connected yet.
func (w *WalletMonitor) LastSeen() time.Time {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.lastSeen
}

// Status reports whether a wallet appears connected based on recent
// activity through the proxy.
func (w *WalletMonitor) Status() WalletStatus {
	last := w.LastSeen()
	connected := !last.IsZero() && time.Since(last) <= walletActiveWindow
	var ms int64
	if !last.IsZero() {
		ms = last.UnixMilli()
	}
	return WalletStatus{Connected: connected, LastSeenUnixMilli: ms}
}

func (w *WalletMonitor) record() {
	now := time.Now()
	w.mu.Lock()
	w.lastSeen = now
	w.mu.Unlock()
}

// Start binds the reverse-proxy listener on publicPort and forwards all
// requests to the embedded node's internal port. Each request updates
// the activity timestamp before reaching the upstream handler.
func (w *WalletMonitor) Start() error {
	target, err := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", w.internalPort))
	if err != nil {
		return fmt.Errorf("wallet proxy target url: %w", err)
	}
	proxy := &httputil.ReverseProxy{
		// Preserve the upstream Host header so geth's virtual-host
		// check (configured to allow "localhost"/"127.0.0.1") doesn't
		// reject the proxied request.
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = target.Host
		},
	}

	handler := http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		// Skip CORS preflights from counting as wallet activity — they
		// also fire when the user just opens a dapp tab without
		// actually connecting it to our RPC.
		if r.Method != http.MethodOptions {
			w.record()
		}
		proxy.ServeHTTP(rw, r)
	})

	addr := fmt.Sprintf("127.0.0.1:%d", w.publicPort)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("wallet proxy listen %s: %w", addr, err)
	}

	w.server = &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		if err := w.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			// The proxy is non-essential; log via the embedded node's
			// log handler instead of crashing the GUI process.
			fmt.Printf("wallet monitor proxy serve: %v\n", err)
		}
	}()
	return nil
}

// Stop tears down the proxy listener. Safe to call on a never-started
// monitor.
func (w *WalletMonitor) Stop() error {
	if w.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := w.server.Shutdown(ctx)
	w.server = nil
	w.mu.Lock()
	w.lastSeen = time.Time{}
	w.mu.Unlock()
	return err
}

// pickInternalRPCPort returns a free loopback TCP port for parallax to
// bind to internally. We bind a temporary listener to port 0, read the
// kernel-assigned port back, then close — the tiny race window where
// another process could grab the same port is acceptable for a
// loopback-only allocation made once at startup.
func pickInternalRPCPort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	addr, ok := l.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected listener addr type")
	}
	return addr.Port, nil
}
