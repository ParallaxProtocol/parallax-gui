// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ParallaxProtocol/parallax/v2/util"
)

type bearer struct{ token string }

func (b bearer) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(req)
}

// connectMCP opens an MCP session to the server as an assistant would.
func connectMCP(t *testing.T, st MCPStatus) *mcp.ClientSession {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)
	cs, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint:   st.URL,
		HTTPClient: &http.Client{Transport: bearer{st.Token}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return cs
}

// callMCP calls a tool and returns its JSON result, or its error text.
func callMCP(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any) (map[string]any, string) {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("calling %s: %v", name, err)
	}
	text := ""
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			text += tc.Text
		}
	}
	if res.IsError {
		return nil, text
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("%s returned %q: %v", name, text, err)
	}
	return out, ""
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func post(t *testing.T, url string, header map[string]string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, url, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range header {
		if k == "Host" {
			req.Host = v
		} else {
			req.Header.Set(k, v)
		}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// TestMCPServer serves the tools from a development chain node to an MCP
// client, and checks who the server turns away.
func TestMCPServer(t *testing.T) {
	t.Setenv("PARALLAX_DEV", "1")
	fund := util.HexToAddress("0x809934Fd0543aCe5621082125162e6899544aF46")
	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(t.TempDir(), "parallax")
	cfg.HTTPRPCEnabled = false
	cfg.IPCDisabled = true
	cfg.DevChain = true
	cfg.DevFundAddress = fund.Hex()
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	store, err := LoadConfigStore(filepath.Join(t.TempDir(), "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	n := NewNodeController(store)

	dir := t.TempDir()
	// Blocked from starting the node, so a call while it's stopped says so
	// at once rather than asking (TestMCPNodeStartsOnDemand asks)
	blocked := cfg
	blocked.MCPAllow.StartNode = ModeBlock
	m := NewMCPServer(dir, AssistantDeps{Host: &testHost{cfg: blocked}, Node: n})
	defer m.Close()
	m.Apply(cfg)
	st := m.Status()
	if !st.Running || st.Error != "" || len(st.Token) != 64 {
		t.Fatalf("status = %+v, want running with a token", st)
	}
	if fi, err := os.Stat(filepath.Join(dir, mcpTokenFile)); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("token file: %v %v", fi, err)
	}

	// The server comes up before the node and says why it can't answer
	cs := connectMCP(t, st)
	if got := m.Status().Clients; len(got) != 1 || got[0] != "test" {
		t.Errorf("connected clients: %v", got)
	}
	if got := cs.InitializeResult().Instructions; !strings.HasPrefix(got, "Parallax Wallet, the user's own node and wallet on their computer (chain ID 1337)") || !strings.Contains(got, "get_request") || !strings.Contains(got, `{"untrusted": "..."}`) {
		t.Errorf("instructions: %q", got)
	}
	if _, errText := callMCP(t, cs, "get_balance", map[string]any{"address": fund.Hex()}); !strings.Contains(errText, "doesn't let assistants start the node") {
		t.Fatalf("with the node stopped: %q", errText)
	}

	if err := n.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer n.Stop()
	// What the server is told the node serves while it's stopped, it does
	rpcc, err := n.Stack().Attach()
	if err != nil {
		t.Fatal(err)
	}
	var mods map[string]string
	if err := rpcc.Call(&mods, "rpc_modules"); err != nil {
		t.Fatal(err)
	}
	for ns := range embeddedModules {
		if _, ok := mods[ns]; !ok {
			t.Errorf("the embedded node doesn't serve %s: it serves %v", ns, mods)
		}
	}
	// The call shows as the assistant's activity while it runs, then clears
	var actMu sync.Mutex
	var acts []*MCPActivity
	m.SetActivityEmitter(func(a *MCPActivity) {
		actMu.Lock()
		acts = append(acts, a)
		actMu.Unlock()
	})
	out, errText := callMCP(t, cs, "get_balance", map[string]any{"address": fund.Hex()})
	if errText != "" || testutilGet(out, "balance", "wei") != devFunds.String() {
		t.Fatalf("balance: %v %s", out, errText)
	}
	m.SetActivityEmitter(nil)
	actMu.Lock()
	if len(acts) != 2 || acts[0] == nil || acts[0].Tool != "get_balance" || acts[0].Client != "test" || acts[1] != nil {
		t.Errorf("activity: %+v", acts)
	}
	actMu.Unlock()
	out, errText = callMCP(t, cs, "chain_info", nil)
	if errText != "" || out["chain_id"] != float64(1337) || out["chain_id_matches"] != true {
		t.Fatalf("chain info: %v %s", out, errText)
	}
	tools := strings.Join(m.Status().Tools, ",")
	for _, name := range []string{"get_block", "build_unsigned_tx", "mempool_status", "search_docs"} {
		if !strings.Contains(tools, name) {
			t.Errorf("%s not served: %s", name, tools)
		}
	}
	for _, name := range []string{"broadcast_signed_tx", "explorer_search", "network_health"} {
		if strings.Contains(tools, name) {
			t.Errorf("%s served: %s", name, tools)
		}
	}

	// A wait the user cancels from the bar stops, and the assistant is told
	waitDone := make(chan string, 1)
	go func() {
		_, errText := callMCP(t, cs, "wait_for_new_block", map[string]any{"timeout_seconds": 60})
		waitDone <- errText
	}()
	deadline := time.Now().Add(5 * time.Second)
	for !m.CancelActivity() {
		if time.Now().After(deadline) {
			t.Fatal("the wait never showed as activity")
		}
		time.Sleep(10 * time.Millisecond)
	}
	select {
	case errText := <-waitDone:
		if !strings.Contains(errText, "the user cancelled this call") {
			t.Errorf("cancelled wait: %q", errText)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the cancelled wait went on")
	}

	// A new connection is told at once, not on the next poll
	var stMu sync.Mutex
	var told []int
	m.SetEmitter(func(s MCPStatus) {
		stMu.Lock()
		told = append(told, len(s.Clients))
		stMu.Unlock()
	})
	connectMCP(t, st)
	m.SetEmitter(nil)
	stMu.Lock()
	if !slices.Contains(told, 2) {
		t.Errorf("a second connection wasn't told: %v", told)
	}
	stMu.Unlock()

	// Turned away: no token, a wrong one, a web page, a rebound host name
	if code := post(t, st.URL, nil); code != http.StatusUnauthorized {
		t.Errorf("no token: %d", code)
	}
	if code := post(t, st.URL, map[string]string{"Authorization": "Bearer " + strings.Repeat("0", 64)}); code != http.StatusUnauthorized {
		t.Errorf("wrong token: %d", code)
	}
	auth := "Bearer " + st.Token
	if code := post(t, st.URL, map[string]string{"Authorization": auth, "Origin": "https://example.com"}); code != http.StatusForbidden {
		t.Errorf("from a web page: %d", code)
	}
	if code := post(t, st.URL, map[string]string{"Authorization": auth, "Host": "attacker.example:80"}); code != http.StatusForbidden {
		t.Errorf("rebound host: %d", code)
	}

	// A new token cuts off the old one
	fresh, err := m.ResetToken()
	if err != nil || fresh.Token == st.Token {
		t.Fatalf("reset: %v %v", fresh, err)
	}
	if code := post(t, st.URL, map[string]string{"Authorization": auth}); code != http.StatusUnauthorized {
		t.Errorf("old token after reset: %d", code)
	}
	if again := NewMCPServer(dir, AssistantDeps{Host: &testHost{cfg: cfg}, Node: n}); again.startLocked() != nil || again.token != fresh.Token {
		t.Error("the new token was not kept")
	} else {
		again.Close()
	}

	// Off on an offline signer, and when switched off
	cfg.OfflineSigner = true
	m.Apply(cfg)
	if st := m.Status(); st.Running || st.Enabled {
		t.Fatalf("offline signer: %+v", st)
	}
	cfg.OfflineSigner = false
	cfg.MCPEnabled = false
	m.Apply(cfg)
	if st := m.Status(); st.Running || st.URL != "" || st.Token != "" {
		t.Fatalf("switched off: %+v", st)
	}
}

// TestMCPPortTaken reports a port in use in the status.
func TestMCPPortTaken(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	cfg := defaultGUIConfig()
	cfg.MCPEnabled = true
	cfg.MCPPort = ln.Addr().(*net.TCPAddr).Port
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: &testHost{cfg: cfg}, Node: NewNodeController(nil)})
	defer m.Close()
	m.Apply(cfg)
	if st := m.Status(); st.Running || !strings.Contains(st.Error, "address already in use") && !strings.Contains(st.Error, "Only one usage") {
		t.Fatalf("status = %+v", st)
	}

	cfg.HTTPRPCPort = cfg.MCPPort
	if err := ValidateConfig(cfg); err == nil {
		t.Fatal("the same port for HTTP-RPC and the assistant server passed validation")
	}
}

// testutilGet walks a decoded JSON value by keys.
func testutilGet(v any, keys ...string) any {
	for _, k := range keys {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[k]
	}
	return v
}

// TestMCPPublicServices serves the explorer's and the status page's tools
// only as the user allows each, restarting the server to change them, and
// never on the development chain, which they don't describe.
func TestMCPPublicServices(t *testing.T) {
	dir := t.TempDir()
	store, err := LoadConfigStore(filepath.Join(dir, "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	cfg := defaultGUIConfig()
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: &testHost{cfg: cfg}, Node: NewNodeController(store)})
	defer m.Close()

	serves := func(name string) bool {
		return strings.Contains(","+strings.Join(m.Status().Tools, ",")+",", ","+name+",")
	}
	told := func() string {
		t.Helper()
		return connectMCP(t, m.Status()).InitializeResult().Instructions
	}
	for _, c := range []struct{ explorer, status bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		cfg.MCPAllow.Explorer, cfg.MCPAllow.StatusPage = c.explorer, c.status
		m.Apply(cfg)
		if !m.Status().Running {
			t.Fatalf("%+v: not running: %s", c, m.Status().Error)
		}
		if serves("explorer_search") != c.explorer || serves("explorer_address") != c.explorer {
			t.Errorf("%+v: explorer tools served = %v", c, serves("explorer_search"))
		}
		if serves("network_health") != c.status {
			t.Errorf("%+v: network tools served = %v", c, serves("network_health"))
		}
		if !serves("mining_stats") || !serves("supply_info") {
			t.Errorf("%+v: mining tools not served", c)
		}
		got := told()
		if strings.Contains(got, "public block explorer is off") == c.explorer || strings.Contains(got, "public status page is off") == c.status {
			t.Errorf("%+v: instructions: %q", c, got)
		}
	}

	t.Setenv("PARALLAX_DEV", "1")
	cfg.DevChain = true
	m.Apply(cfg)
	if serves("explorer_search") || serves("network_health") {
		t.Fatal("public services served on the development chain")
	}
}

func TestActivityOf(t *testing.T) {
	for _, c := range []struct {
		tool, args, want string
	}{
		{"get_balance", `{}`, "get_balance"},
		{"wait_for_new_block", `{"after_block":9}`, "wait_for_new_block@10"},
		{"wait_for_new_block", `{}`, "wait_for_new_block"},
		{"get_request", `{"id":"x"}`, ""},
		{"", `{}`, ""},
	} {
		got := ""
		if a := activityOf(c.tool, json.RawMessage(c.args)); a != nil {
			got = a.Tool
			if a.Block != nil {
				got += fmt.Sprintf("@%d", *a.Block)
			}
		}
		if got != c.want {
			t.Errorf("%s %s: %q, want %q", c.tool, c.args, got, c.want)
		}
	}
}

// nodeHost is a testHost whose node really starts and stops.
type nodeHost struct {
	testHost
	node *NodeController
}

func (h *nodeHost) StartNode() error { return h.node.Start(context.Background()) }
func (h *nodeHost) StopNode() error  { return h.node.Stop() }

// TestMCPNodeStartsOnDemand has a tool that needs the stopped node start
// it, as the user allows: at once, after a prompt, or not at all.
func TestMCPNodeStartsOnDemand(t *testing.T) {
	t.Setenv("PARALLAX_DEV", "1")
	fund := util.HexToAddress("0x809934Fd0543aCe5621082125162e6899544aF46")
	cfg := defaultGUIConfig()
	cfg.DataDir = filepath.Join(t.TempDir(), "parallax")
	cfg.HTTPRPCEnabled = false
	cfg.IPCDisabled = true
	cfg.DevChain = true
	cfg.DevFundAddress = fund.Hex()
	cfg.MCPEnabled = true
	cfg.MCPPort = freePort(t)
	store, err := LoadConfigStore(filepath.Join(t.TempDir(), "gui.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	node := NewNodeController(store)
	defer node.Stop()
	host := &nodeHost{testHost: testHost{cfg: cfg}, node: node}
	m := NewMCPServer(t.TempDir(), AssistantDeps{Host: host, Node: node})
	defer m.Close()
	m.Apply(cfg)
	as := m.Assistant()
	cs := connectMCP(t, m.Status())
	balance := func(cs *mcp.ClientSession) (map[string]any, string) {
		return callMCP(t, cs, "get_balance", map[string]any{"address": fund.Hex()})
	}
	waitPrompt := func() AssistantRequest {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for len(as.Pending()) == 0 {
			if time.Now().After(deadline) {
				t.Fatal("no prompt to start the node")
			}
			time.Sleep(10 * time.Millisecond)
		}
		return as.Pending()[0]
	}

	// Allowed: started at once, and the call carries on
	host.allow(func(a *MCPAllow) { a.StartNode = ModeAllow })
	if out, errText := balance(cs); errText != "" || testutilGet(out, "balance", "wei") != devFunds.String() || !node.Status().Running {
		t.Fatalf("allowed: %v %s", out, errText)
	}

	// Ask: a prompt saying the node is stopped; allowed once, it starts
	node.Stop()
	host.allow(func(a *MCPAllow) { a.StartNode = ModeAsk })
	done := make(chan string, 1)
	go func() {
		_, errText := balance(cs)
		done <- errText
	}()
	p := waitPrompt()
	if p.Permission == nil || p.Permission.Feature != "startNode" || !p.Permission.NodeStopped || p.Permission.Tool != "get_balance" {
		t.Fatalf("prompt: %+v", p)
	}
	if _, err := as.Allow(p.ID, false); err != nil {
		t.Fatal(err)
	}
	if errText := <-done; errText != "" || !node.Status().Running {
		t.Fatalf("after allowing: %q", errText)
	}

	// Turned down, on another connection (asked anew): the call says so,
	// and the node stays stopped
	node.Stop()
	other := connectMCP(t, m.Status())
	go func() {
		_, errText := balance(other)
		done <- errText
	}()
	_ = as.Reject(waitPrompt().ID)
	if errText := <-done; !strings.Contains(errText, "node is stopped") || !strings.Contains(errText, "turned down") || node.Status().Running {
		t.Fatalf("turned down: %q", errText)
	}

	// Blocked: refused without asking
	host.allow(func(a *MCPAllow) { a.StartNode = ModeBlock })
	if _, errText := balance(other); !strings.Contains(errText, "doesn't let assistants start the node") || len(as.Pending()) != 0 {
		t.Fatalf("blocked: %q", errText)
	}
}
