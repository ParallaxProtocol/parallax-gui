// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// testHost is the app as the assistant tools see it, recording what they
// did to it.
type testHost struct {
	mu      sync.Mutex
	cfg     GUIConfig
	saved   int
	started int
	stopped int
}

func (h *testHost) Config() GUIConfig {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.cfg
}

func (h *testHost) SaveConfig(c GUIConfig) error {
	if err := ValidateConfig(c); err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.cfg = c
	h.saved++
	return nil
}

func (h *testHost) StartNode() error { h.mu.Lock(); h.started++; h.mu.Unlock(); return nil }
func (h *testHost) StopNode() error  { h.mu.Lock(); h.stopped++; h.mu.Unlock(); return nil }

func (h *testHost) allow(fn func(*MCPAllow)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	fn(&h.cfg.MCPAllow)
}

// TestAssistantTools drives the app's own tools as an assistant would,
// with the user's permissions and decisions in between.
func TestAssistantTools(t *testing.T) {
	dir := t.TempDir()
	store, err := LoadConfigStore(filepath.Join(dir, "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	node := NewNodeController(store)
	w, err := NewWallet(dir, node)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SetupPassword(testPassword); err != nil {
		t.Fatal(err)
	}
	mine, err := w.Create("Main", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	book := bookFor(t, w, dir)

	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(dir, "parallax")
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	host := &testHost{cfg: cfg}
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: host, Node: node, Wallet: w, Contacts: book, Logs: NewLogTail(16)})
	defer m.Close()
	m.Apply(cfg)
	cs := connectMCP(t, m.Status())
	call := func(name string, args map[string]any) (map[string]any, string) {
		t.Helper()
		return callMCP(t, cs, name, args)
	}
	as := m.Assistant()

	// Node status is allowed by default; blocked features are refused
	// without asking
	if out, errText := call("node_status", nil); errText != "" || out["running"] != false || out["dataDir"] != "" {
		t.Fatalf("node_status: %v %s", out, errText)
	}
	host.allow(func(a *MCPAllow) {
		a.Wallet, a.Contacts, a.StartNode, a.NodeLogs, a.Settings, a.StopNode = ModeBlock, ModeBlock, ModeBlock, ModeBlock, ModeBlock, ModeBlock
	})
	for _, tool := range []string{"wallet_accounts", "contacts", "start_node", "node_logs", "app_settings"} {
		if _, errText := call(tool, nil); !strings.Contains(errText, "Settings › AI assistants") {
			t.Errorf("%s answered while blocked: %q", tool, errText)
		}
	}
	if _, errText := call("request_stop_node", map[string]any{"reason": "x"}); !strings.Contains(errText, "doesn't let assistants ask to stop") {
		t.Errorf("request_stop_node while blocked: %q", errText)
	}
	if len(as.Pending()) != 0 {
		t.Fatal("a blocked feature prompted the user")
	}

	host.allow(func(a *MCPAllow) { a.Wallet, a.Contacts, a.StartNode = ModeAllow, ModeAllow, ModeAllow })
	out, errText := call("wallet_accounts", nil)
	if errText != "" || testutilGet(out, "selected") != mine.Address || len(out["accounts"].([]any)) != 1 {
		t.Fatalf("wallet_accounts: %v %s", out, errText)
	}
	if out["balances_unavailable"] == nil {
		t.Errorf("balances with the node stopped: %v", out)
	}
	if _, errText := call("wallet_activity", map[string]any{"address": "0x2CAa9795cd62261f96e40B8448b33636FF5e249a"}); !strings.Contains(errText, "not an account in the wallet") {
		t.Errorf("activity of an outside address: %q", errText)
	}
	if _, errText := call("start_node", nil); errText != "" || host.started != 1 {
		t.Errorf("start_node: %q, started %d", errText, host.started)
	}

	// A watch-only account: asked, approved, done
	// Requests are made in the ask mode, each approved on its own
	host.allow(func(a *MCPAllow) {
		a.WatchOnly, a.NewAccounts, a.Settings, a.EditContacts = ModeAsk, ModeAsk, ModeAsk, ModeAsk
	})
	watched := "0x2CAa9795cd62261f96e40B8448b33636FF5e249a"
	req, errText := call("request_watch_only", map[string]any{"name": "Cold", "address": strings.ToLower(watched), "reason": "to follow your cold wallet"})
	if errText != "" || req["status"] != RequestPending {
		t.Fatalf("request_watch_only: %v %s", req, errText)
	}
	id := req["id"].(string)
	pending := as.Pending()
	if len(pending) != 1 || pending[0].Watch.Address != watched || pending[0].Reason != "to follow your cold wallet" {
		t.Fatalf("pending: %+v", pending)
	}
	if out, _ := call("get_request", map[string]any{"id": id}); out["status"] != RequestPending {
		t.Fatalf("get_request before deciding: %v", out)
	}
	if _, err := as.Approve(id, ""); err != nil {
		t.Fatal(err)
	}
	if out, _ := call("get_request", map[string]any{"id": id}); out["status"] != RequestApproved || !strings.Contains(out["result"].(string), watched) {
		t.Fatalf("get_request after approving: %v", out)
	}
	if _, _, err := w.known(watched); err != nil {
		t.Fatal("the watch-only account was not added")
	}
	if _, err := as.Approve(id, ""); err == nil {
		t.Fatal("a request was carried out twice")
	}

	// A new account needs the wallet password, which only the app asks for
	req, _ = call("request_new_account", map[string]any{"name": "Savings", "reason": "for savings"})
	id = req["id"].(string)
	if _, err := as.Approve(id, "wrong"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password: %v", err)
	}
	if len(as.Pending()) != 1 {
		t.Fatal("a wrong password decided the request")
	}
	done, err := as.Approve(id, testPassword)
	if err != nil || done.Status != RequestApproved || len(w.Info().Accounts) != 3 {
		t.Fatalf("new account: %+v %v", done, err)
	}

	// Settings: only those on the list, checked, shown before and after
	if _, errText := call("request_settings_change", map[string]any{"changes": map[string]any{"httpHost": "0.0.0.0"}, "reason": "x"}); !strings.Contains(errText, "not a setting assistants may change") {
		t.Errorf("httpHost: %q", errText)
	}
	if _, errText := call("request_settings_change", map[string]any{"changes": map[string]any{"maxPeers": "many"}, "reason": "x"}); !strings.Contains(errText, "wrong type") {
		t.Errorf("a string for a number: %q", errText)
	}
	if _, errText := call("request_settings_change", map[string]any{"changes": map[string]any{"theme": cfg.Theme}, "reason": "x"}); !strings.Contains(errText, "already") {
		t.Errorf("no change: %q", errText)
	}
	req, errText = call("request_settings_change", map[string]any{"changes": map[string]any{"logLevel": 4, "reportStats": true}, "reason": "to debug a sync problem"})
	if errText != "" {
		t.Fatal(errText)
	}
	ch := as.Pending()[0].Changes
	if len(ch) != 2 || ch[0].Key != "logLevel" || string(ch[0].To) != "4" || ch[1].Key != "reportStats" || !ch[1].Sensitive || ch[1].Applies != "node" {
		t.Fatalf("changes: %+v", ch)
	}
	if done, err := as.Approve(req["id"].(string), ""); err != nil || !strings.Contains(done.Result, "reportStats") {
		t.Fatalf("settings: %+v %v", done, err)
	}
	if got := host.Config(); got.LogLevel != 4 || !got.ReportStats || got.MCPAllow.Settings != ModeAsk {
		t.Fatalf("saved config: %+v", got)
	}

	// A contact, turned down
	req, _ = call("request_contact", map[string]any{"name": "Exchange", "address": watched, "reason": "x"})
	if err := as.Reject(req["id"].(string)); err != nil {
		t.Fatal(err)
	}
	if out, _ := call("get_request", map[string]any{"id": req["id"], "wait_seconds": 1}); out["status"] != RequestRejected || len(book.List()) != 0 {
		t.Fatalf("rejected contact: %v, book %v", out, book.List())
	}

	// No more than five wait at once
	for i := range maxPendingRequest {
		if _, errText := call("request_contact", map[string]any{"name": "C", "address": watched, "reason": "x"}); errText != "" {
			t.Fatalf("request %d: %s", i, errText)
		}
	}
	if _, errText := call("request_contact", map[string]any{"name": "C", "address": watched, "reason": "x"}); !strings.Contains(errText, "already wait") {
		t.Fatalf("a sixth request: %q", errText)
	}
}

// TestAssistantPermissionPrompts asks the user, as claude.ai asks before
// a tool runs: allowed once for the connection, always (the mode becomes
// allow), turned down, or not answered.
func TestAssistantPermissionPrompts(t *testing.T) {
	dir := t.TempDir()
	store, err := LoadConfigStore(filepath.Join(dir, "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	node := NewNodeController(store)
	w, err := NewWallet(dir, node)
	if err != nil {
		t.Fatal(err)
	}
	book := bookFor(t, w, dir)
	cfg := defaultGUIConfig()
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	host := &testHost{cfg: cfg}
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: host, Node: node, Wallet: w, Contacts: book, Logs: NewLogTail(16)})
	defer m.Close()
	m.Apply(cfg)
	as := m.Assistant()

	// prompt calls a tool in the background, waits for the prompt it
	// raises, answers it with answer, and returns the call's error text
	prompt := func(cs *mcp.ClientSession, tool, feature string, answer func(id string)) string {
		t.Helper()
		done := make(chan string, 1)
		go func() {
			_, errText := callMCP(t, cs, tool, nil)
			done <- errText
		}()
		deadline := time.Now().Add(5 * time.Second)
		for {
			if p := as.Pending(); len(p) == 1 {
				if p[0].Kind != RequestPermission || p[0].Permission.Feature != feature || p[0].Permission.Tool != tool {
					t.Fatalf("prompt: %+v", p[0])
				}
				answer(p[0].ID)
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("%s raised no prompt", tool)
			}
			time.Sleep(10 * time.Millisecond)
		}
		return <-done
	}

	// Allowed once: this connection goes on without asking again
	cs := connectMCP(t, m.Status())
	if errText := prompt(cs, "wallet_accounts", "wallet", func(id string) {
		if _, err := as.Allow(id, false); err != nil {
			t.Fatal(err)
		}
	}); errText != "" {
		t.Fatalf("allowed once: %s", errText)
	}
	if _, errText := callMCP(t, cs, "wallet_accounts", nil); errText != "" || len(as.Pending()) != 0 {
		t.Fatalf("asked again on the same connection: %s", errText)
	}
	if host.Config().MCPAllow.Wallet != ModeAsk {
		t.Fatal("allowing once changed the setting")
	}

	// Another connection is asked anew; turned down
	other := connectMCP(t, m.Status())
	if errText := prompt(other, "wallet_accounts", "wallet", func(id string) {
		if err := as.Reject(id); err != nil {
			t.Fatal(err)
		}
	}); !strings.Contains(errText, "turned down") {
		t.Fatalf("turned down: %q", errText)
	}

	// Always: the setting becomes allow, for every connection
	if errText := prompt(other, "node_logs", "nodeLogs", func(id string) {
		if _, err := as.Allow(id, true); err != nil {
			t.Fatal(err)
		}
	}); errText != "" {
		t.Fatalf("allowed always: %s", errText)
	}
	if host.Config().MCPAllow.NodeLogs != ModeAllow {
		t.Fatal("allowing always didn't change the setting")
	}
	if _, errText := callMCP(t, connectMCP(t, m.Status()), "node_logs", nil); errText != "" {
		t.Fatalf("a new connection after always: %s", errText)
	}

	// Not answered in time
	as.permissionWait = 200 * time.Millisecond
	if _, errText := callMCP(t, cs, "contacts", nil); !strings.Contains(errText, "didn't answer") || len(as.Pending()) != 0 {
		t.Fatalf("unanswered: %q, pending %v", errText, as.Pending())
	}

	// A request is never prompted for: it is approved on its own
	if out, errText := callMCP(t, cs, "request_stop_node", map[string]any{"reason": "x"}); errText != "" && !strings.Contains(errText, "not running") {
		t.Fatalf("request: %v %s", out, errText)
	}
	for _, p := range as.Pending() {
		if p.Kind == RequestPermission {
			t.Fatal("a request raised a permission prompt")
		}
	}
	if _, err := as.Approve(as.requests[0].ID, ""); err == nil {
		t.Fatal("a permission prompt was approved as a request")
	}
}

// TestMCPModesFromSwitches reads configs saved before the modes.
func TestMCPModesFromSwitches(t *testing.T) {
	var a MCPAllow
	if err := json.Unmarshal([]byte(`{"wallet":true,"contacts":false,"nodeLogs":"block","startNode":"allow"}`), &a); err != nil {
		t.Fatal(err)
	}
	if a.Wallet != ModeAllow || a.Contacts != ModeAsk || a.NodeLogs != ModeBlock || a.StartNode != ModeAllow || a.Settings.or() != ModeAsk {
		t.Fatalf("modes: %+v", a)
	}
	if err := json.Unmarshal([]byte(`{"wallet":"maybe"}`), &a); err == nil {
		t.Fatal("an unknown mode was read")
	}
}

func TestWeiToLAX(t *testing.T) {
	for wei, lax := range map[string]string{"0": "0", "1": "0.000000000000000001", "1000000000000000000": "1", "1500000000000000000": "1.5", "123000000000000000000": "123"} {
		if got := weiToLAX(wei); got != lax {
			t.Errorf("%s wei = %s LAX, want %s", wei, got, lax)
		}
	}
}

// TestAssistantTransactions asks to send LAX on the development chain: the
// proposal as the user reviews it, approved with the wallet password, sent;
// to a contact; from a watch-only account, as a signing request; and what's
// refused before the user is asked.
func TestAssistantTransactions(t *testing.T) {
	t.Setenv("PARALLAX_DEV", "1")
	dir := t.TempDir()
	store, err := LoadConfigStore(filepath.Join(dir, "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	node := NewNodeController(store)
	w, err := NewWallet(dir, node)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SetupPassword(testPassword); err != nil {
		t.Fatal(err)
	}
	mine, err := w.Create("Main", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	book := bookFor(t, w, dir)
	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(dir, "parallax")
	cfg.HTTPRPCEnabled = false
	cfg.IPCDisabled = true
	cfg.DevChain = true
	cfg.DevFundAddress = mine.Address // the genesis funds the wallet's own account
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	if err := node.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer node.Stop()

	host := &testHost{cfg: cfg}
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: host, Node: node, Wallet: w, Contacts: book, Logs: NewLogTail(16)})
	defer m.Close()
	m.Apply(cfg)
	as := m.Assistant()
	cs := connectMCP(t, m.Status())
	call := func(args map[string]any) (map[string]any, string) {
		t.Helper()
		return callMCP(t, cs, "request_transaction", args)
	}

	// To an address the wallet has never seen
	friend := "0x2CAa9795cd62261f96e40B8448b33636FF5e249a"
	req, errText := call(map[string]any{"from": mine.Address, "to": strings.ToLower(friend), "value_lax": "1.5", "reason": "to pay back lunch"})
	if errText != "" || req["status"] != RequestPending {
		t.Fatalf("request: %v %s", req, errText)
	}
	p := as.Pending()[0].Transaction
	if p.From != mine.Address || p.FromName != "Main" || p.To != friend || p.Recipient != "new" || p.ValueWei != "1500000000000000000" ||
		p.WatchOnly || p.GasLimit != 21000 || p.FeeWei == "" || p.TotalWei == "" {
		t.Fatalf("proposal: %+v", p)
	}
	id := req["id"].(string)
	if _, err := as.Approve(id, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password: %v", err)
	}
	done, err := as.Approve(id, testPassword)
	if err != nil || !strings.Contains(done.Result, "sent transaction 0x") {
		t.Fatalf("approved: %+v %v", done, err)
	}

	// To a contact, by name
	if _, err := book.Add(ContactInput{Name: "Alice", Address: friend}); err != nil {
		t.Fatal(err)
	}
	req, _ = call(map[string]any{"from": mine.Address, "to": friend, "value_wei": "1000", "reason": "x"})
	if p := as.Pending()[0].Transaction; p.Recipient != "contact" || p.ToName != "Alice" {
		t.Fatalf("to a contact: %+v", p)
	}
	_ = as.Reject(req["id"].(string))

	// From a watch-only account: a signing request for the offline signer
	if _, err := w.AddWatchOnly("Cold", friend); err != nil {
		t.Fatal(err)
	}
	req, errText = call(map[string]any{"from": friend, "to": mine.Address, "value_lax": "0.5", "reason": "x"})
	if errText != "" {
		t.Fatal(errText)
	}
	if p := as.Pending()[0].Transaction; !p.WatchOnly || p.Recipient != "own" || p.ToName != "Main" {
		t.Fatalf("from watch-only: %+v", p)
	}
	if done, err := as.Approve(req["id"].(string), ""); err != nil || !strings.Contains(done.Result, "signing request") {
		t.Fatalf("watch-only approved: %+v %v", done, err)
	}
	if pending, err := w.PendingRequests(); err != nil || len(pending) != 1 {
		t.Fatalf("signing requests: %v %v", pending, err)
	}

	// Refused before the user is asked
	for _, c := range []struct {
		args map[string]any
		want string
	}{
		{map[string]any{"from": friend, "to": mine.Address, "value_lax": "1000000", "reason": "x"}, "short of"},
		{map[string]any{"from": "0x00000000000000000000000000000000000000aa", "to": friend, "value_lax": "1", "reason": "x"}, "not an account in the wallet"},
		{map[string]any{"from": mine.Address, "to": friend, "value_lax": "1.0000000000000000001", "reason": "x"}, "at most 18 decimals"},
		{map[string]any{"from": mine.Address, "to": friend, "value_lax": "0", "reason": "x"}, "more than 0"},
		{map[string]any{"from": mine.Address, "to": friend, "value_lax": "1", "value_wei": "1", "reason": "x"}, "not both"},
	} {
		if _, errText := call(c.args); !strings.Contains(errText, c.want) {
			t.Errorf("%v: %q, want %q", c.args, errText, c.want)
		}
	}
	cfg.OfflineFeeCapWei = "1"
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	if _, errText := call(map[string]any{"from": mine.Address, "to": friend, "value_lax": "1", "reason": "x"}); !strings.Contains(errText, "fee cap") {
		t.Errorf("over the fee cap: %q", errText)
	}
	host.allow(func(a *MCPAllow) { a.SendTransactions = ModeBlock })
	if _, errText := call(map[string]any{"from": mine.Address, "to": friend, "value_lax": "1", "reason": "x"}); !strings.Contains(errText, "doesn't let assistants ask to send") {
		t.Errorf("blocked: %q", errText)
	}
	if len(as.Pending()) != 0 {
		t.Fatalf("refused requests reached the user: %+v", as.Pending())
	}
}

func TestLAXToWei(t *testing.T) {
	for in, want := range map[string]string{"1": "1000000000000000000", "1.5": "1500000000000000000", ".25": "250000000000000000", "0.000000000000000001": "1"} {
		if got, ok := laxToWei(in); !ok || got.String() != want {
			t.Errorf("%s LAX = %v wei, want %s", in, got, want)
		}
	}
	for _, in := range []string{"", "1.2.3", "-1", "1e18", "abc", "0.0000000000000000001"} {
		if _, ok := laxToWei(in); ok {
			t.Errorf("%q read as LAX", in)
		}
	}
}

// TestAssistantLock locks the app as an assistant would, and checks that
// nothing else answers while it is locked, that a call the lock cuts short
// says why, and that a running call keeps the wallet from locking itself.
func TestAssistantLock(t *testing.T) {
	dir := t.TempDir()
	store, err := LoadConfigStore(filepath.Join(dir, "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	node := NewNodeController(store)
	w, err := NewWallet(dir, node)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.SetupPassword(testPassword); err != nil {
		t.Fatal(err)
	}

	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(dir, "parallax")
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	host := &testHost{cfg: cfg}
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: host, Node: node, Wallet: w, Logs: NewLogTail(16)})
	defer m.Close()
	// As the app does (app.go)
	w.SetLockEmitter(func(locked bool) {
		if locked {
			m.AppLocked()
		}
	})
	m.Apply(cfg)
	cs := connectMCP(t, m.Status())
	call := func(name string, args map[string]any) (map[string]any, string) {
		t.Helper()
		return callMCP(t, cs, name, args)
	}
	as := m.Assistant()

	// Allowed by default
	if out, errText := call("lock_app", nil); errText != "" || out["locked"] != true || out["already_locked"] != false {
		t.Fatalf("lock_app: %v %s", out, errText)
	}
	if w.Unlocked() {
		t.Fatal("lock_app left the wallet unlocked")
	}

	// Locked, nothing but lock_app answers
	for _, tool := range []string{"node_status", "wallet_accounts", "get_request", "chain_info"} {
		if _, errText := call(tool, map[string]any{"id": "x"}); errText != errAppLocked {
			t.Errorf("%s while locked: %q", tool, errText)
		}
	}
	if _, err := cs.ReadResource(context.Background(), &mcp.ReadResourceParams{URI: "parallax://chain/head"}); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Errorf("reading a resource while locked: %v", err)
	}
	if out, errText := call("lock_app", nil); errText != "" || out["already_locked"] != true {
		t.Fatalf("lock_app while locked: %v %s", out, errText)
	}
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	if _, errText := call("node_status", nil); errText != "" {
		t.Fatalf("node_status once unlocked: %s", errText)
	}

	// A call waiting on a prompt holds the auto-lock off, and starts the
	// idle time over as it ends
	waitPrompt := func() AssistantRequest {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for len(as.Pending()) == 0 {
			if time.Now().After(deadline) {
				t.Fatal("no prompt")
			}
			time.Sleep(10 * time.Millisecond)
		}
		return as.Pending()[0]
	}
	w.SetAutoLock(100 * time.Millisecond)
	done := make(chan string)
	go func() {
		_, errText := callMCP(t, cs, "wallet_accounts", nil)
		done <- errText
	}()
	prompt := waitPrompt()
	time.Sleep(300 * time.Millisecond)
	if !w.Unlocked() {
		t.Fatal("the wallet locked itself during a call")
	}
	if err := as.Reject(prompt.ID); err != nil {
		t.Fatal(err)
	}
	<-done
	deadline := time.Now().Add(2 * time.Second)
	for w.Unlocked() {
		if time.Now().After(deadline) {
			t.Fatal("never locked once the call ended")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Locking ends a running call, telling the assistant why
	w.SetAutoLock(0)
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	go func() {
		_, errText := callMCP(t, cs, "wallet_accounts", nil)
		done <- errText
	}()
	waitPrompt()
	w.Lock()
	select {
	case errText := <-done:
		if errText != errLockedMidCall {
			t.Fatalf("a call cut short by the lock: %q", errText)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the lock didn't end the call")
	}

	// Locking turns down the requests waiting on the user
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	req, errText := call("request_watch_only", map[string]any{"address": "0x00000000000000000000000000000000000000aa", "reason": "x"})
	if errText != "" {
		t.Fatalf("request_watch_only: %s", errText)
	}
	w.Lock()
	if len(as.Pending()) != 0 {
		t.Fatal("a request still waits after the lock")
	}
	if err := w.Unlock(testPassword); err != nil {
		t.Fatal(err)
	}
	if out, errText := call("get_request", map[string]any{"id": req["id"]}); errText != "" || out["status"] != RequestRejected || out["result"] != errLockedRequest {
		t.Fatalf("get_request after the lock: %v %s", out, errText)
	}

	// Blocked, assistants can't lock it
	host.allow(func(a *MCPAllow) { a.LockApp = ModeBlock })
	if _, errText := call("lock_app", nil); !strings.Contains(errText, "doesn't let assistants lock") {
		t.Fatalf("lock_app while blocked: %q", errText)
	}
	if !w.Unlocked() {
		t.Fatal("a blocked lock_app locked the wallet")
	}
}

// TestAssistantTor checks the Tor switch as assistants see it: node_status
// says how Tor is doing, the node doesn't start while Tor isn't connected,
// and the switch can be asked for under its own permission, never as an
// ordinary setting, while the Tor it goes through can't be at all.
func TestAssistantTor(t *testing.T) {
	dir := t.TempDir()
	store, err := LoadConfigStore(filepath.Join(dir, "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	node := NewNodeController(store)
	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(dir, "parallax")
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	// Tor on, at a Tor on this computer that isn't there
	cfg.Tor, cfg.TorSystem, cfg.Proxy = true, true, closedPort(t)
	cfg.MCPAllow.StartNode, cfg.MCPAllow.Settings, cfg.MCPAllow.Tor = ModeAllow, ModeAsk, ModeBlock
	tor := NewTorController(t.TempDir())
	defer tor.Close()
	tor.Apply(cfg)
	deadline := time.Now().Add(5 * time.Second)
	for tor.Status().State == "starting" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	host := &testHost{cfg: cfg}
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: host, Node: node, Logs: NewLogTail(16), Tor: tor})
	defer m.Close()
	m.Apply(cfg)
	cs := connectMCP(t, m.Status())
	call := func(name string, args map[string]any) (map[string]any, string) {
		t.Helper()
		return callMCP(t, cs, name, args)
	}

	out, errText := call("node_status", nil)
	if errText != "" {
		t.Fatal(errText)
	}
	if v, _ := out["tor"].(map[string]any); v["enabled"] != true || v["state"] != "failed" || v["system"] != true {
		t.Errorf("tor in node_status: %v", out["tor"])
	}
	if _, errText := call("start_node", nil); !strings.Contains(errText, "Tor is on and not connected") || host.started != 0 {
		t.Errorf("start_node with Tor not connected: %q, started %d", errText, host.started)
	}

	// The Tor the node goes through isn't the assistant's to set, nor the
	// switch as an ordinary setting
	for _, key := range []string{"proxy", "torSystem", "torControl", "tor", "torOnionOnly"} {
		if _, errText := call("request_settings_change", map[string]any{"changes": map[string]any{key: "127.0.0.1:1080"}, "reason": "x"}); !strings.Contains(errText, "not a setting assistants may change") {
			t.Errorf("%s: %q", key, errText)
		}
	}
	// Blocked, it isn't asked for; allowed, each request is still approved
	if _, errText := call("request_tor", map[string]any{"enabled": false, "reason": "x"}); !strings.Contains(errText, "Settings › AI assistants") {
		t.Errorf("request_tor while blocked: %q", errText)
	}
	host.allow(func(a *MCPAllow) { a.Tor = ModeAllow })
	if _, errText := call("request_tor", map[string]any{"reason": "x"}); !strings.Contains(errText, "give enabled") {
		t.Errorf("request_tor asking nothing: %q", errText)
	}
	req, errText := call("request_tor", map[string]any{"enabled": false, "reason": "to sync faster"})
	if errText != "" {
		t.Fatal(errText)
	}
	as := m.Assistant()
	if ch := as.Pending()[0].Changes; len(ch) != 1 || ch[0].Key != "tor" || !ch[0].Sensitive || ch[0].Applies != "node" {
		t.Fatalf("changes: %+v", ch)
	}
	if _, err := as.Approve(req["id"].(string), ""); err != nil {
		t.Fatal(err)
	}
	if host.Config().Tor {
		t.Error("Tor still on after the approved change")
	}
}
