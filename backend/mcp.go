// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"cmp"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/logging"

	"github.com/ParallaxProtocol/parallax-mcp/pkg/backend/blockscout"
	mcpnode "github.com/ParallaxProtocol/parallax-mcp/pkg/backend/node"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/backend/status"
	mcpconfig "github.com/ParallaxProtocol/parallax-mcp/pkg/config"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/httpx"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/prompts"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/resources"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/server"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/chain"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/docs"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/explorer"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/live"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/mempool"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/mining"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/network"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/tools/tx"
)

// DefaultMCPPort is where the assistant server listens unless the user
// picks another port: clear of the node's own 8545 to 8547 and 8551.
const DefaultMCPPort = 8549

// mcpCallTimeout bounds a tool call and its node requests, with room for
// the user to answer a prompt to start the node.
const mcpCallTimeout = 3 * time.Minute

// mcpTokenFile holds the bearer token assistants connect with, beside the
// wallet's keystore rather than in gui.json, so a settings page holding an
// older copy of the config can't overwrite it.
const mcpTokenFile = "mcp-token"

// MCPStatus is what Settings shows about the assistant server.
type MCPStatus struct {
	Enabled bool     `json:"enabled"`
	Running bool     `json:"running"`
	URL     string   `json:"url"`
	Token   string   `json:"token"`
	Error   string   `json:"error"`
	Tools   []string `json:"tools"`
	// Clients names the assistants connected now, as they introduce
	// themselves ("Claude Code"), one entry per connection
	Clients []string `json:"clients"`
}

// MCPServer serves parallax-mcp's read-only tools to AI assistants (Claude
// Code and other MCP clients) on the loopback interface, answered by the
// embedded node: nothing is asked of the public RPC, explorer or status
// page, so the addresses and transactions an assistant looks up stay on this
// computer. It needs the node's HTTP-RPC no more than the wallet does: its
// requests go to the node in process, through parallax-mcp's allowlist,
// which refuses anything that signs, sends or changes the node.
type MCPServer struct {
	dir       string
	node      *NodeController
	assistant *Assistant

	mu sync.Mutex
	mcpSettings
	token string
	srv   *http.Server
	reg   *server.Registrar
	err   string
	emit  func(MCPStatus)
	// activity is the tool calls in progress, for the assistant bar
	activity mcpActivity
	// calls are the calls in progress, ended as the app locks (mcp_lock.go)
	calls lockCalls
}

// NewMCPServer returns a stopped server keeping its token in dir. Beside
// the chain's tools it serves the app's own (assistant.go), each answering
// only when the user allows it.
func NewMCPServer(dir string, deps AssistantDeps) *MCPServer {
	return &MCPServer{dir: dir, node: deps.Node, assistant: NewAssistant(deps)}
}

// Assistant holds the requests assistants make of the app.
func (m *MCPServer) Assistant() *Assistant { return m.assistant }

// CancelActivity stops the tool call the assistant bar shows, as the user
// asked: the tool's work ends, and the assistant is told they cancelled it.
func (m *MCPServer) CancelActivity() bool { return m.activity.cancelLatest() }

// SetActivityEmitter is called with the tool call an assistant is making
// now whenever that changes, nil once none is.
func (m *MCPServer) SetActivityEmitter(fn func(*MCPActivity)) { m.activity.setEmitter(fn) }

// SetEmitter is called with the new status whenever it changes.
func (m *MCPServer) SetEmitter(fn func(MCPStatus)) {
	m.mu.Lock()
	m.emit = fn
	m.mu.Unlock()
}

// mcpChainID is the chain ID the tools expect for the config: the
// development chain's when it runs, else mainnet's.
func mcpChainID(g GUIConfig) uint64 {
	if devChain(g) {
		return chainparams.AllCliqueProtocolChanges.ChainID.Uint64()
	}
	return chainparams.MainnetChainConfig.ChainID.Uint64()
}

// mcpSettings are what the server is started with: a change to any of
// them restarts it, as parallax-mcp settles its tools at the start.
type mcpSettings struct {
	enabled bool
	port    int
	chainID uint64
	// explorer and statusPage let the tools ask the public block explorer
	// and status page. Both describe mainnet, so the development chain
	// never uses them.
	explorer   bool
	statusPage bool
}

func mcpSettingsOf(g GUIConfig) mcpSettings {
	dev := devChain(g)
	return mcpSettings{
		enabled:    g.MCPEnabled && !g.OfflineSigner,
		port:       mcpPort(g),
		chainID:    mcpChainID(g),
		explorer:   g.MCPAllow.Explorer && !dev,
		statusPage: g.MCPAllow.StatusPage && !dev,
	}
}

// Apply starts, stops, moves or restarts the server to match the settings.
// It never runs on an offline signer. A server that cannot start (its port
// taken, say) is reported in its status, not as an error: the settings are
// saved either way.
func (m *MCPServer) Apply(g GUIConfig) {
	want := mcpSettingsOf(g)
	m.mu.Lock()
	defer m.mu.Unlock()
	if want == m.mcpSettings && (m.srv != nil || !want.enabled) {
		return
	}
	m.stopLocked()
	m.mcpSettings = want
	m.err = ""
	if want.enabled {
		if err := m.startLocked(); err != nil {
			m.err = err.Error()
			logging.Warn("Failed to start the AI assistant server", "port", want.port, "err", err)
		}
	}
	m.notifyLocked()
}

// Close stops the server.
func (m *MCPServer) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
}

// Status reports whether the server runs and how to connect to it.
func (m *MCPServer) Status() MCPStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

// ResetToken replaces the token, cutting off every assistant set up with
// the old one.
func (m *MCPServer) ResetToken() (MCPStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	tok, err := newMCPToken()
	if err != nil {
		return m.statusLocked(), err
	}
	if err := writeMCPToken(m.dir, tok); err != nil {
		return m.statusLocked(), err
	}
	m.token = tok
	m.notifyLocked()
	return m.statusLocked(), nil
}

func (m *MCPServer) statusLocked() MCPStatus {
	st := MCPStatus{Enabled: m.enabled, Running: m.srv != nil, Error: m.err}
	if m.enabled {
		st.URL = mcpURL(m.port)
		st.Token = m.token
	}
	st.Clients = []string{}
	if m.reg != nil {
		st.Tools = m.reg.ToolNames()
		for sess := range m.reg.MCP().Sessions() {
			st.Clients = append(st.Clients, cmp.Or(clientName(sess), "an assistant"))
		}
	}
	return st
}

func (m *MCPServer) notifyLocked() {
	if m.emit != nil {
		m.emit(m.statusLocked())
	}
}

func mcpPort(g GUIConfig) int {
	if g.MCPPort == 0 {
		return DefaultMCPPort
	}
	return g.MCPPort
}

func mcpURL(port int) string { return "http://127.0.0.1:" + strconv.Itoa(port) + "/mcp" }

func (m *MCPServer) startLocked() error {
	if m.token == "" {
		tok, err := loadMCPToken(m.dir)
		if err != nil {
			return fmt.Errorf("reading the access token: %w", err)
		}
		m.token = tok
	}

	public := mcpconfig.Default()
	cfg := public
	cfg.Transport = mcpconfig.TransportHTTP
	// Never dialled: requests reach the node through nodeTransport
	cfg.RPCURL = "http://embedded-node.invalid/"
	cfg.ExplorerURL, cfg.ExplorerStatsURL, cfg.StatusURL = "", "", ""
	// Mining works from the node alone; the status page adds its figures
	cfg.Groups = []string{mcpconfig.GroupChain, mcpconfig.GroupMempool, mcpconfig.GroupMining, mcpconfig.GroupTx, mcpconfig.GroupDocs, GroupApp}
	cfg.AllowBroadcast = false
	cfg.ChainID = m.chainID
	// Room for the user to answer a prompt to start the node, mid-call
	cfg.ToolTimeout = mcpCallTimeout
	if m.explorer {
		cfg.ExplorerURL = public.ExplorerURL
		cfg.Groups = append(cfg.Groups, mcpconfig.GroupExplorer)
	}
	if m.statusPage {
		cfg.StatusURL = public.StatusURL
		cfg.Groups = append(cfg.Groups, mcpconfig.GroupNetwork)
	}

	// A request may wait on the user to let the node start (ensureNode):
	// the in-process node needs no tighter bound, and no retries, which
	// would ask again after a refusal
	n, err := mcpnode.Dial(mcpnode.Options{URL: cfg.RPCURL, Timeout: mcpCallTimeout, Transport: nodeTransport{m.node, m.assistant.ensureNode}})
	if err != nil {
		return err
	}
	log := slog.New(&slogHandler{l: logging.Root().New("module", "mcp")})
	deps := server.Deps{Cfg: cfg, Node: n, Log: log, Instructions: mcpInstructions(m.chainID, m.explorer, m.statusPage)}
	ua := "parallax-wallet-app/" + GUIVersion
	if cfg.ExplorerURL != "" {
		deps.Explorer = blockscout.New(httpx.Options{BaseURL: cfg.ExplorerURL, Timeout: cfg.BackendTimeout, Retries: cfg.BackendRetries, UserAgent: ua})
		deps.ExplorerStats = blockscout.NewStats(httpx.Options{BaseURL: cfg.StatsURL(), Timeout: cfg.BackendTimeout, Retries: cfg.BackendRetries, UserAgent: ua})
	}
	if cfg.StatusURL != "" {
		deps.Status = status.New(httpx.Options{BaseURL: cfg.StatusURL, Timeout: cfg.BackendTimeout, Retries: cfg.BackendRetries, UserAgent: ua}, cfg.StatusCacheTTL)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	reg := server.New(ctx, deps,
		chain.Register, live.Register, mempool.Register, mining.Register, explorer.Register, network.Register,
		tx.Register, docs.Register, resources.Register, prompts.Register,
		m.assistant.Register)
	reg.MCP().AddReceivingMiddleware(m.lockGate, m.observe)

	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return reg.MCP() }, &mcp.StreamableHTTPOptions{
		SessionTimeout:      30 * time.Minute,
		Logger:              log,
		MaxRequestBodyBytes: 1 << 20,
	})
	mux := http.NewServeMux()
	mux.Handle("/mcp", m.guard(handler))

	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(m.port)))
	if err != nil {
		n.Close()
		return err
	}
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	srv.RegisterOnShutdown(n.Close)
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logging.Warn("The AI assistant server stopped", "err", err)
		}
	}()
	m.srv, m.reg = srv, reg
	logging.Info("AI assistant server listening", "url", mcpURL(m.port), "tools", len(reg.ToolNames()))
	return nil
}

// mcpInstructions tells assistants what this server is, at initialization:
// the user's own node and wallet rather than the public network's service,
// which public services it may ask, and how the app's tools ask before
// they act.
func mcpInstructions(chainID uint64, explorer, statusPage bool) string {
	explorerText := "The public block explorer is off, so explorer data (address histories, token lists, verified contract sources, labels) isn't available; the user can allow it under Permissions."
	if explorer {
		explorerText = "The explorer tools ask the public block explorer (explorer.parallaxprotocol.org), and calldata and events are decoded with its verified contract sources: what you look up there leaves the user's computer."
	}
	statusText := "The public status page is off, so network health, alerts, incidents and network-wide mining figures aren't available; the user can allow it under Permissions."
	if statusPage {
		statusText = "The network tools, and the mining figures they compare against, read the public status page (status.parallaxprotocol.org)."
	}
	devText := ""
	if chainID == chainparams.AllCliqueProtocolChanges.ChainID.Uint64() {
		devText = " This node runs a private development chain: it makes a block only when there is a transaction to put in it, so waiting alone never brings a new block; say so before waiting."
	}
	return fmt.Sprintf("Parallax Wallet, the user's own node and wallet on their computer (chain ID %d): ", chainID) + server.Chain + `

The chain tools answer from the node Parallax Wallet runs, never a public RPC. They need the node running: when it's stopped, the app starts it, asking the user first if they want to be asked, and the call carries on; if they won't have it started, the call says so. ` + explorerText + " " + statusText + `

To wait for a block, or for the chain to reach a height, call wait_for_new_block (after_block: the height before the one awaited) rather than checking again and again: it returns as soon as the block comes, or times out, and you can call it again.` + devText + `

While Parallax Wallet is locked, every call but lock_app is refused, a call still running as the user locks it is cancelled, saying so, and requests still waiting on the user are turned down: the user unlocks it in the app with the wallet password, which you can't do. lock_app locks it, as its lock button does, when the user asks you to or would want it locked.

The app's own tools (node_status, node_logs, wallet_accounts, wallet_activity, contacts, start_node, lock_app, app_settings and the request_ tools) work only as far as the user allows them in Parallax Wallet, Settings › AI assistants › Permissions. A tool the user hasn't allowed yet asks them in the app first, and the call waits up to 2 minutes for their answer: tell the user to look at Parallax Wallet when you call it. One they block, or turn down, says so; don't call it again in the hope of a different answer.

The request_ tools don't act: they ask the user, who approves or turns the request down in Parallax Wallet. Tell the user to look there, then call get_request with wait_seconds for the outcome. Never say a request was carried out before get_request says it was approved.

request_transaction asks the user to send LAX from one of their accounts: they review it in the app and approve it with the wallet password, which you never see. Nothing is sent without their approval. You can't see recovery phrases, keys or the password, or remove anything. build_unsigned_tx builds a transaction for the user to sign elsewhere.

` + server.Conventions
}

func (m *MCPServer) stopLocked() {
	if m.srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := m.srv.Shutdown(ctx); err != nil {
		// Streams still open (an assistant waiting on a block) end here
		_ = m.srv.Close()
	}
	m.srv, m.reg = nil, nil
}

// guard admits only requests that carry the token and come from a program
// rather than a web page: browsers send Origin on every cross-site request,
// and MCP clients send none. The SDK refuses non-loopback Host headers on
// its own, against DNS rebinding.
func (m *MCPServer) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "" {
			http.Error(w, "requests from web pages are not accepted", http.StatusForbidden)
			return
		}
		m.mu.Lock()
		want := m.token
		m.mu.Unlock()
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || want == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="Parallax Wallet"`)
			http.Error(w, "missing or wrong access token: copy it from Parallax Wallet's settings", http.StatusUnauthorized)
			return
		}
		// A connection ended is told at once, for the bar (a new one is told
		// by observe)
		if r.Method == http.MethodDelete {
			defer m.notifyStatus()
		}
		next.ServeHTTP(w, r)
	})
}

// notifyStatus tells the status anew, as who is connected changed.
func (m *MCPServer) notifyStatus() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.notifyLocked()
}

// nodeTransport hands parallax-mcp's JSON-RPC requests, already through its
// allowlist, to the embedded node's in-process handler, whichever node is
// running at the time of the request. A tool that finds the node stopped
// has it started first, as the user allows (ensure), and carries on.
type nodeTransport struct {
	node   *NodeController
	ensure func(context.Context) error
}

var errMCPNodeStopped = errors.New("the node is not running: start it in Parallax Wallet")

// embeddedModules are RPC namespaces the embedded node's in-process
// handler always serves, whatever the HTTP-RPC settings: those the tools
// may need (Spec.Requires) and the basics. Answering rpc_modules with them
// while the node is stopped spares parallax-mcp a failed probe, and its
// warning, when the server starts before the node, as it does at launch.
var embeddedModules = map[string]string{"eth": "1.0", "net": "1.0", "web3": "1.0", "debug": "1.0", "txpool": "1.0", "admin": "1.0"}

func (t nodeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	stack := t.node.Stack()
	if stack == nil {
		if resp, ok := modulesWhileStopped(req); ok {
			return resp, nil
		}
		if t.ensure == nil {
			return nil, errMCPNodeStopped
		}
		if err := t.ensure(req.Context()); err != nil {
			return nil, err
		}
		if stack = t.node.Stack(); stack == nil {
			return nil, errMCPNodeStopped
		}
	}
	h, err := stack.RPCHandler()
	if err != nil {
		return nil, errMCPNodeStopped
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result(), nil
}

// modulesWhileStopped answers a lone rpc_modules call with embeddedModules.
func modulesWhileStopped(req *http.Request) (*http.Response, bool) {
	if req.Body == nil {
		return nil, false
	}
	body, err := io.ReadAll(req.Body)
	req.Body.Close()
	// Handed on as it came when it isn't the probe
	req.Body = io.NopCloser(bytes.NewReader(body))
	if err != nil {
		return nil, false
	}
	var call struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
	}
	if json.Unmarshal(body, &call) != nil || call.Method != "rpc_modules" || len(call.ID) == 0 {
		return nil, false
	}
	out, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": embeddedModules})
	if err != nil {
		return nil, false
	}
	rec := httptest.NewRecorder()
	rec.Header().Set("Content-Type", "application/json")
	rec.Write(out)
	return rec.Result(), true
}

func newMCPToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// loadMCPToken reads the token, creating it on first use.
func loadMCPToken(dir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, mcpTokenFile))
	if err == nil {
		if tok := strings.TrimSpace(string(data)); tok != "" {
			return tok, nil
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	tok, err := newMCPToken()
	if err != nil {
		return "", err
	}
	return tok, writeMCPToken(dir, tok)
}

func writeMCPToken(dir, tok string) error {
	path := filepath.Join(dir, mcpTokenFile)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(tok+"\n"), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// slogHandler writes parallax-mcp's slog records to the app's log, so tool
// calls show in Settings › Diagnostics with everything else.
type slogHandler struct {
	l     logging.Logger
	attrs []any
	group string
}

func (h *slogHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *slogHandler) Handle(_ context.Context, r slog.Record) error {
	ctx := append([]any{}, h.attrs...)
	r.Attrs(func(a slog.Attr) bool {
		ctx = append(ctx, h.key(a.Key), a.Value.Any())
		return true
	})
	switch {
	case r.Level >= slog.LevelError:
		h.l.Error(r.Message, ctx...)
	case r.Level >= slog.LevelWarn:
		h.l.Warn(r.Message, ctx...)
	case r.Level >= slog.LevelInfo:
		h.l.Info(r.Message, ctx...)
	default:
		h.l.Debug(r.Message, ctx...)
	}
	return nil
}

func (h *slogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	out := &slogHandler{l: h.l, group: h.group, attrs: append([]any{}, h.attrs...)}
	for _, a := range attrs {
		out.attrs = append(out.attrs, h.key(a.Key), a.Value.Any())
	}
	return out
}

func (h *slogHandler) WithGroup(name string) slog.Handler {
	return &slogHandler{l: h.l, attrs: h.attrs, group: h.key(name)}
}

func (h *slogHandler) key(k string) string {
	if h.group == "" {
		return k
	}
	return h.group + "." + k
}
