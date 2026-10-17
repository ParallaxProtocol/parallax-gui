// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ParallaxProtocol/parallax-mcp/pkg/server"
	"github.com/ParallaxProtocol/parallax-mcp/pkg/untrusted"
)

// MCPAllow is what the user lets AI assistants do in the app, feature by
// feature, beyond reading the chain (assistant_permit.go). What assistants
// may only ask for waits on the user's approval in the app (the requests
// below); the wallet's secrets are never offered at all: no tool reveals a
// recovery phrase, exports or imports a key, removes an account, or sees
// the password.
type MCPAllow struct {
	// What assistants may see
	NodeStatus MCPMode `json:"nodeStatus"` // sync, peers, uptime, version
	NodeLogs   MCPMode `json:"nodeLogs"`
	Wallet     MCPMode `json:"wallet"` // the wallet's accounts, balances and activity
	Contacts   MCPMode `json:"contacts"`
	// Public services the tools may ask, beyond the node. What the
	// assistant looks up there leaves the computer. Changing these
	// restarts the assistant server (mcp.go), so they are on or off
	Explorer   bool `json:"explorer"`   // explorer.parallaxprotocol.org
	StatusPage bool `json:"statusPage"` // status.parallaxprotocol.org
	// What they may do
	StartNode MCPMode `json:"startNode"`
	// LockApp locks the app, as its lock button does: never unlocking it,
	// which takes the wallet password
	LockApp MCPMode `json:"lockApp"`
	// What they may ask for: each request is approved in the app whatever
	// the mode, so allow is the same as ask, and block stops them asking
	StopNode     MCPMode `json:"stopNode"`
	Settings     MCPMode `json:"settings"`
	NewAccounts  MCPMode `json:"newAccounts"`
	WatchOnly    MCPMode `json:"watchOnly"`
	EditContacts MCPMode `json:"editContacts"`
	// Sends are approved one by one too, with the wallet password
	SendTransactions MCPMode `json:"sendTransactions"`
}

// AssistantHost is what the assistant tools need of the app itself: the
// config, saved and applied as the Settings page saves it, and the node.
type AssistantHost interface {
	Config() GUIConfig
	SaveConfig(GUIConfig) error
	StartNode() error
	StopNode() error
}

// AssistantDeps are the parts of the app the assistant tools reach.
type AssistantDeps struct {
	Host     AssistantHost
	Node     *NodeController
	Wallet   *Wallet   // nil when it could not be opened
	Contacts *Contacts // likewise
	Logs     *LogTail
	// HTTP is what the explorer and the status page are asked by: through
	// Tor while its switch is on (tor.go)
	HTTP *http.Client
}

// Request kinds
const (
	RequestStopNode   = "stopNode"
	RequestSettings   = "settings"
	RequestNewAccount = "newAccount"
	RequestWatchOnly  = "watchOnly"
	RequestContact    = "contact"
	// RequestPermission asks the user to let a tool go ahead (permit)
	RequestPermission = "permission"
)

// Request statuses
const (
	RequestPending  = "pending"
	RequestApproved = "approved"
	RequestRejected = "rejected"
	RequestExpired  = "expired"
	RequestFailed   = "failed"
)

const (
	requestTTL        = 10 * time.Minute
	maxPendingRequest = 5
	maxReasonLen      = 500
	// requestKeep is how many decided requests are kept for get_request
	requestKeep = 50
)

// AssistantRequest is something an assistant asked the app to do, waiting
// on the user, or decided.
type AssistantRequest struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Reason is the assistant's own explanation: the app shows it as the
	// assistant's words, never as its own
	Reason  string `json:"reason"`
	Created int64  `json:"created"`
	Expires int64  `json:"expires"`
	Status  string `json:"status"`
	// Result says what happened, or why it failed
	Result string `json:"result"`

	Changes     []SettingChange  `json:"changes,omitempty"`
	Account     *AccountProposal `json:"account,omitempty"`
	Watch       *WatchProposal   `json:"watch,omitempty"`
	Contact     *ContactProposal `json:"contact,omitempty"`
	Transaction *TxProposal      `json:"transaction,omitempty"`
	// Permission is what a permission prompt asks to let go ahead
	Permission *PermissionPrompt `json:"permission,omitempty"`
}

// SettingChange is one setting a request changes, values as JSON.
type SettingChange struct {
	Key       string          `json:"key"`
	Label     string          `json:"label"`
	From      json.RawMessage `json:"from"`
	To        json.RawMessage `json:"to"`
	Applies   string          `json:"applies"` // "now" | "node" (on the node's restart) | "app" (on the app's)
	Sensitive bool            `json:"sensitive"`
}

// AccountProposal is a new account: a new key, or the next one from a
// recovery phrase.
type AccountProposal struct {
	Name     string `json:"name"`
	SeedID   string `json:"seedId,omitempty"`
	SeedName string `json:"seedName,omitempty"`
}

// WatchProposal is a watch-only account to follow.
type WatchProposal struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// ContactProposal is a contact to add, or to change when Previous is set.
type ContactProposal struct {
	ID       string   `json:"id,omitempty"`
	Name     string   `json:"name"`
	Address  string   `json:"address"`
	Note     string   `json:"note"`
	Previous *Contact `json:"previous,omitempty"`
}

// assistantSetting is a setting assistants may ask to change. Those left
// out could expose the node or the wallet, or reroute the node's traffic:
// RPC addresses, APIs, CORS and hosts, proxies and Tor, peers and
// bootnodes, network restrictions, the fee and disk guards, data
// directories, update checks, offline signing, and these settings.
type assistantSetting struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Values  string `json:"values"`
	Applies string `json:"applies"`
	// Sensitive settings are flagged in the review: they open the node to
	// other programs or share something about it
	Sensitive bool `json:"sensitive,omitempty"`
}

var assistantSettings = []assistantSetting{
	{Key: "theme", Label: "Theme", Values: `"system", "light" or "dark"`, Applies: "now"},
	{Key: "avatarStyle", Label: "Address pictures", Values: `"jazzicon" or "blockies"`, Applies: "now"},
	{Key: "disableAnimations", Label: "Turn off animations", Values: "true or false", Applies: "now"},
	{Key: "logLevel", Label: "Log level", Values: "0 (info) or 1 (errors) to 5 (trace)", Applies: "now"},
	{Key: "notifications", Label: "Desktop notifications", Values: "true or false", Applies: "now"},
	{Key: "preventSleep", Label: "Keep the computer awake while syncing", Values: "true or false", Applies: "now"},
	{Key: "autoStartNode", Label: "Start the node with the app", Values: "true or false", Applies: "now"},
	{Key: "clearLogsOnStartup", Label: "Clear the log on each start", Values: "true or false", Applies: "app"},

	{Key: "syncMode", Label: "Sync mode", Values: `"snap" or "full"`, Applies: "node"},
	{Key: "maxPeers", Label: "Peers", Values: "a number of peers", Applies: "node"},
	{Key: "maxPendingPeers", Label: "Pending peers", Values: "a number; 0 is the default", Applies: "node"},
	{Key: "blockInbound", Label: "Refuse incoming connections", Values: "true or false", Applies: "node"},
	{Key: "nodeName", Label: "Node name", Values: "text, shown to peers and the status page", Applies: "node", Sensitive: true},
	{Key: "reportStats", Label: "Report to the status page", Values: "true or false", Applies: "node", Sensitive: true},
	{Key: "enableSmartFee", Label: "Smart fee estimates", Values: "true or false", Applies: "node"},
	{Key: "archiveMode", Label: "Archive mode", Values: "true or false", Applies: "node"},
	{Key: "txLookupLimit", Label: "Transaction index", Values: "blocks to index; 0 is the whole chain; null is the default", Applies: "node"},
	{Key: "noSnapshot", Label: "Turn off the state snapshot", Values: "true or false", Applies: "node"},
	{Key: "noPrefetch", Label: "Turn off prefetching", Values: "true or false", Applies: "node"},
	{Key: "preimages", Label: "Keep preimages", Values: "true or false", Applies: "node"},
	{Key: "databaseCacheMB", Label: "Database cache (MB)", Values: "megabytes", Applies: "node"},
	{Key: "trieCleanCacheMB", Label: "Trie clean cache (MB)", Values: "megabytes", Applies: "node"},
	{Key: "trieDirtyCacheMB", Label: "Trie dirty cache (MB)", Values: "megabytes", Applies: "node"},
	{Key: "snapshotCacheMB", Label: "Snapshot cache (MB)", Values: "megabytes", Applies: "node"},

	{Key: "httpRpcEnabled", Label: "HTTP-RPC", Values: "true or false", Applies: "node", Sensitive: true},
	{Key: "httpRpcPort", Label: "HTTP-RPC port", Values: "a port", Applies: "node"},
	{Key: "wsEnabled", Label: "WebSocket RPC", Values: "true or false", Applies: "node", Sensitive: true},
	{Key: "graphql", Label: "GraphQL", Values: "true or false", Applies: "node", Sensitive: true},
	{Key: "rpcGasCap", Label: "RPC gas cap", Values: "gas; 0 is no cap; null is the default", Applies: "node"},
	{Key: "rpcPvmTimeoutSec", Label: "RPC call timeout (s)", Values: "seconds; 0 is none; null is the default", Applies: "node"},
	{Key: "rpcLogQueryLimit", Label: "RPC log query limit", Values: "a number; 0 is none; null is the default", Applies: "node"},
	{Key: "rpcBatchLimit", Label: "RPC batch limit", Values: "a number; null is the default", Applies: "node"},

	{Key: "txPoolPriceLimit", Label: "Pool minimum gas price (wei)", Values: "wei; null is the default", Applies: "node"},
	{Key: "txPoolPriceBump", Label: "Pool replacement bump (%)", Values: "percent; null is the default", Applies: "node"},
	{Key: "txPoolAccountSlots", Label: "Pool slots per account", Values: "a number; null is the default", Applies: "node"},
	{Key: "txPoolGlobalSlots", Label: "Pool slots", Values: "a number; null is the default", Applies: "node"},
	{Key: "txPoolAccountQueue", Label: "Pool queue per account", Values: "a number; null is the default", Applies: "node"},
	{Key: "txPoolGlobalQueue", Label: "Pool queue", Values: "a number; null is the default", Applies: "node"},
	{Key: "txPoolLifetimeMin", Label: "Pool lifetime (minutes)", Values: "minutes; null is the default", Applies: "node"},
	{Key: "gpoBlocks", Label: "Fee oracle blocks", Values: "a number; null is the default", Applies: "node"},
	{Key: "gpoPercentile", Label: "Fee oracle percentile", Values: "0 to 100; null is the default", Applies: "node"},
	{Key: "gpoMaxPrice", Label: "Fee oracle maximum (wei)", Values: `decimal wei as a string; "" is the default`, Applies: "node"},
	{Key: "gpoIgnorePrice", Label: "Fee oracle ignores below (wei)", Values: `decimal wei as a string; "" is the default`, Applies: "node"},
}

func settingByKey(key string) (assistantSetting, bool) {
	i := slices.IndexFunc(assistantSettings, func(s assistantSetting) bool { return s.Key == key })
	if i < 0 {
		return assistantSetting{}, false
	}
	return assistantSettings[i], true
}

// Assistant answers the app's own MCP tools and keeps the requests
// assistants make until the user decides them.
type Assistant struct {
	deps AssistantDeps
	now  func() time.Time

	// permissionWait is how long a tool waits on the user's answer to a
	// permission prompt
	permissionWait time.Duration

	mu       sync.Mutex
	requests []*assistantRequest // oldest first
	// grants are the features the user allowed once, by connection, until
	// the connection has been idle for grantIdle
	grants map[grantKey]time.Time
	emit   func([]AssistantRequest)
}

type assistantRequest struct {
	AssistantRequest
	// session is the connection a permission prompt was raised for
	session *mcp.ServerSession
	busy    bool          // being carried out
	done    chan struct{} // closed once decided
	// apply carries out the request with the password the user typed, if
	// it needs one, and says what happened
	apply func(password string) (string, error)
}

// NewAssistant returns the tools' host for deps.
func NewAssistant(deps AssistantDeps) *Assistant {
	return &Assistant{deps: deps, now: time.Now, permissionWait: defaultPermissionWait, grants: map[grantKey]time.Time{}}
}

// SetEmitter is called with the pending requests whenever they change.
func (a *Assistant) SetEmitter(fn func([]AssistantRequest)) {
	a.mu.Lock()
	a.emit = fn
	a.mu.Unlock()
}

// Pending lists the requests waiting on the user, oldest first.
func (a *Assistant) Pending() []AssistantRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.pendingLocked()
}

func (a *Assistant) pendingLocked() []AssistantRequest {
	out := []AssistantRequest{}
	for _, r := range a.requests {
		if r.Status == RequestPending {
			out = append(out, r.AssistantRequest)
		}
	}
	return out
}

func (a *Assistant) notifyLocked() {
	if a.emit != nil {
		a.emit(a.pendingLocked())
	}
}

func (a *Assistant) find(id string) *assistantRequest {
	for _, r := range a.requests {
		if r.ID == id {
			return r
		}
	}
	return nil
}

// Approve carries out a pending request, with the wallet password when it
// makes an account, and returns it decided.
func (a *Assistant) Approve(id, password string) (AssistantRequest, error) {
	a.mu.Lock()
	r := a.find(id)
	switch {
	case r == nil:
		a.mu.Unlock()
		return AssistantRequest{}, errors.New("no such request")
	case r.Status != RequestPending:
		a.mu.Unlock()
		return r.AssistantRequest, fmt.Errorf("the request is already %s", r.Status)
	case r.busy:
		a.mu.Unlock()
		return r.AssistantRequest, errors.New("the request is being carried out")
	case r.Kind == RequestPermission:
		a.mu.Unlock()
		return r.AssistantRequest, errors.New("a permission prompt is answered with Allow")
	}
	r.busy = true
	a.mu.Unlock()

	result, err := r.apply(password)

	a.mu.Lock()
	defer a.mu.Unlock()
	r.busy = false
	if err != nil && (errors.Is(err, ErrWrongPassword) || hardwareRetry(err)) {
		// Left pending: the user can try again (with the hardware wallet
		// connected and ready, for a send from one)
		return r.AssistantRequest, err
	}
	if err != nil {
		a.decideLocked(r, RequestFailed, err.Error())
		return r.AssistantRequest, err
	}
	a.decideLocked(r, RequestApproved, result)
	return r.AssistantRequest, nil
}

// Reject turns a pending request down.
func (a *Assistant) Reject(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	r := a.find(id)
	if r == nil {
		return errors.New("no such request")
	}
	if r.Status != RequestPending || r.busy {
		return nil
	}
	a.decideLocked(r, RequestRejected, "the user turned the request down")
	return nil
}

// rejectAll turns down every request still waiting on the user, as the app
// locks: one being carried out finishes.
func (a *Assistant) rejectAll(result string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, r := range a.requests {
		if r.Status == RequestPending && !r.busy {
			a.decideLocked(r, RequestRejected, result)
		}
	}
}

func (a *Assistant) decideLocked(r *assistantRequest, status, result string) {
	r.Status, r.Result = status, result
	close(r.done)
	r.apply = nil
	a.notifyLocked()
}

// submit queues a request for the user.
func (a *Assistant) submit(kind, reason string, req AssistantRequest, apply func(string) (string, error)) (any, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	r, err := a.queueLocked(kind, reason, req, apply, requestTTL, "the user did not decide within 10 minutes")
	if err != nil {
		return nil, err
	}
	return requestOut(r.AssistantRequest), nil
}

// queueLocked adds a request for the user, expiring after ttl.
func (a *Assistant) queueLocked(kind, reason string, req AssistantRequest, apply func(string) (string, error), ttl time.Duration, expired string) (*assistantRequest, error) {
	reason = strings.TrimSpace(untrusted.Sanitize(reason))
	if len([]rune(reason)) > maxReasonLen {
		reason = string([]rune(reason)[:maxReasonLen])
	}
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		return nil, err
	}
	now := a.now()
	if len(a.pendingLocked()) >= maxPendingRequest {
		return nil, server.Inputf("%d requests already wait on the user; wait for them to be decided", maxPendingRequest)
	}
	req.ID, req.Kind, req.Reason = hex.EncodeToString(id), kind, reason
	req.Created, req.Expires = now.Unix(), now.Add(ttl).Unix()
	req.Status = RequestPending
	r := &assistantRequest{AssistantRequest: req, done: make(chan struct{}), apply: apply}
	a.requests = append(a.requests, r)
	if len(a.requests) > requestKeep {
		// Forget the oldest decided ones
		keep := a.requests[:0]
		drop := len(a.requests) - requestKeep
		for _, old := range a.requests {
			if drop > 0 && old.Status != RequestPending {
				drop--
				continue
			}
			keep = append(keep, old)
		}
		a.requests = keep
	}
	time.AfterFunc(ttl, func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if r.Status == RequestPending && !r.busy {
			a.decideLocked(r, RequestExpired, expired)
		}
	})
	a.notifyLocked()
	return r, nil
}

// requestOut is a request as the assistant sees it.
func requestOut(r AssistantRequest) map[string]any {
	out := map[string]any{"id": r.ID, "kind": r.Kind, "status": r.Status, "expires": r.Expires}
	switch r.Status {
	case RequestPending:
		out["next"] = "The user is asked to approve it in Parallax Wallet. Call get_request with this id and wait_seconds to learn the outcome."
	default:
		out["result"] = r.Result
	}
	return out
}

func (a *Assistant) allow() MCPAllow { return a.deps.Host.Config().MCPAllow }

func (a *Assistant) wallet() (*Wallet, error) {
	if a.deps.Wallet == nil {
		return nil, errors.New("the wallet could not be opened; the app's log says why")
	}
	return a.deps.Wallet, nil
}

func (a *Assistant) contacts() (*Contacts, error) {
	if a.deps.Contacts == nil {
		return nil, errors.New("the contacts could not be opened; the app's log says why")
	}
	return a.deps.Contacts, nil
}

// GroupApp is the tool group of the app's own tools.
const GroupApp = "app"

type noIn struct{}

type reasonIn struct {
	Reason string `json:"reason" jsonschema:"why you ask, in a sentence the user reads before deciding"`
}

type logsIn struct {
	Lines    int    `json:"lines,omitempty" jsonschema:"how many of the latest lines (default 100, at most 500)"`
	Level    string `json:"level,omitempty" jsonschema:"the least severe level to include: error, warn, info (default) or debug"`
	Contains string `json:"contains,omitempty" jsonschema:"only lines containing this text, ignoring case"`
}

type addressIn struct {
	Address string `json:"address" jsonschema:"one of the wallet's account addresses"`
}

type activityIn struct {
	Address string `json:"address" jsonschema:"one of the wallet's account addresses"`
	Before  string `json:"before,omitempty" jsonschema:"the next of an earlier answer, for the page of history older than it; omit for the newest"`
	Filter  string `json:"filter,omitempty" jsonschema:"only these: in (received), out (sent), mined or failed; omit for all"`
	With    string `json:"with,omitempty" jsonschema:"only the transactions with this address"`
}

type settingsChangeIn struct {
	Changes map[string]any `json:"changes" jsonschema:"setting keys from app_settings and their new values"`
	Reason  string         `json:"reason" jsonschema:"why you ask, in a sentence the user reads before deciding"`
}

type newAccountIn struct {
	Name           string `json:"name,omitempty" jsonschema:"a name for the account"`
	RecoveryPhrase string `json:"recovery_phrase_id,omitempty" jsonschema:"make the next account of this recovery phrase (an id from wallet_accounts) rather than a new key"`
	Reason         string `json:"reason" jsonschema:"why you ask, in a sentence the user reads before deciding"`
}

type watchIn struct {
	Name    string `json:"name,omitempty" jsonschema:"a name for the account"`
	Address string `json:"address" jsonschema:"the address to follow"`
	Reason  string `json:"reason" jsonschema:"why you ask, in a sentence the user reads before deciding"`
}

type contactIn struct {
	ID      string `json:"contact_id,omitempty" jsonschema:"the contact to change (an id from contacts); leave out to add one"`
	Name    string `json:"name" jsonschema:"the contact's name"`
	Address string `json:"address" jsonschema:"the contact's address"`
	Note    string `json:"note,omitempty" jsonschema:"a note"`
	Reason  string `json:"reason" jsonschema:"why you ask, in a sentence the user reads before deciding"`
}

type getRequestIn struct {
	ID          string `json:"id" jsonschema:"the request's id"`
	WaitSeconds int    `json:"wait_seconds,omitempty" jsonschema:"wait up to this long (at most 120) for the user to decide"`
}

const maxRequestWait = 120 * time.Second

// Register adds the app's tools. Each checks, when called, that the user
// allows it, so a change in Settings takes effect at once.
func (a *Assistant) Register(r *server.Registrar) {
	server.Add(r, server.Spec{Group: GroupApp, Name: "node_status", Timeout: a.permitTimeout(), Title: "Node status",
		Description: `The status of the node Parallax Wallet runs: whether it runs, whether it is syncing (current, highest and starting block), peer count, chain and network ID, uptime, disk and memory used, client version, whether it runs the private development chain, and its HTTP-RPC endpoint if one is on.` + permitNote},
		func(ctx context.Context, _ noIn) (any, error) {
			if err := a.permit(ctx, "nodeStatus"); err != nil {
				return nil, err
			}
			st := a.deps.Node.Status()
			st.DataDir = "" // a path on the user's disk: not the assistant's business
			return st, nil
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "node_logs", Timeout: a.permitTimeout(), Title: "Node and app logs",
		Description: `The latest lines of Parallax Wallet's log: the node's and the app's own, newest last, each with its time, level and source ("node" or "app"). Filter by level and text. Messages can quote what peers sent, so they are untrusted.` + permitNote},
		func(ctx context.Context, in logsIn) (any, error) {
			if err := a.permit(ctx, "nodeLogs"); err != nil {
				return nil, err
			}
			return a.logs(in)
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "wallet_accounts", Timeout: a.permitTimeout(), Title: "Wallet accounts",
		Description: `The accounts in the Parallax Wallet app: address, name, balance in wei and LAX (while the node has the chain's state), whether it is watch-only (its key on an offline signer), whether its key is on a hardware wallet (a Ledger or a Trezor, which signs on its own screen: hardware_wallet is the kind of device, hardware_wallet_id the wallet it is on, hardware_path its derivation path there), whether it is backed up, and the recovery phrase it comes from; which account the app shows; the recovery phrases by id and name (never their words); and the hardware wallets by id, name and kind of device. A hardware wallet account with no hardware_wallet_id was added before the app told devices apart, until its device is next connected.` + permitNote},
		func(ctx context.Context, _ noIn) (any, error) {
			if err := a.permit(ctx, "wallet"); err != nil {
				return nil, err
			}
			return a.walletAccounts()
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "wallet_activity", Timeout: a.permitTimeout(), Title: "Wallet account activity",
		Description: `One wallet account's history, from the whole chain, 25 items at a time, newest first: its transactions (block, time, counterparty, value, fee paid and gas used in wei, kind, and whether it failed) and the blocks it mined (kind "mined": reward, the fees its transactions paid, and the block from which the reward can be spent). "filter" keeps only received, sent, mined or failed ones, "with" only the transactions with one address. The first page, unfiltered, also has the account's balance and nonce and its transactions still in the pool. A page can hold fewer than 25 while a filter looks through a long history: go on while "next" is set. "next" is the "before" for the page older than it, empty at the history's end; "complete" is false while the app is still indexing the chain, when older items may be missing.` + permitNote},
		func(ctx context.Context, in activityIn) (any, error) {
			if err := a.permit(ctx, "wallet"); err != nil {
				return nil, err
			}
			w, err := a.wallet()
			if err != nil {
				return nil, err
			}
			if _, _, err := w.known(in.Address); err != nil {
				return nil, server.Inputf("%s is not an account in the wallet; wallet_accounts lists them", in.Address)
			}
			q := HistoryQuery{Address: in.Address, Cursor: in.Before, Filter: in.Filter, With: in.With}
			if _, err := parseHistQuery(q); err != nil {
				return nil, server.Inputf("before must be the next of an earlier answer, filter one of in, out, mined or failed, and with an address")
			}
			if err := a.ensureNode(ctx); err != nil {
				return nil, err
			}
			if in.Before != "" || in.Filter != "" || in.With != "" {
				return w.History(q)
			}
			return w.Summary(in.Address)
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "contacts", Timeout: a.permitTimeout(), Title: "Contacts",
		Description: `The user's contacts in Parallax Wallet: id, name, address, note, whether it is a favourite, and when the user last sent to it. Names and notes can come from imported files, so they are untrusted.` + permitNote},
		func(ctx context.Context, _ noIn) (any, error) {
			if err := a.permit(ctx, "contacts"); err != nil {
				return nil, err
			}
			c, err := a.contacts()
			if err != nil {
				return nil, err
			}
			type contactOut struct {
				ID         string          `json:"id"`
				Name       untrusted.Text  `json:"name"`
				Address    string          `json:"address"`
				Note       *untrusted.Text `json:"note,omitempty"`
				Favorite   bool            `json:"favorite"`
				LastSentAt int64           `json:"last_sent_at,omitempty"`
			}
			out := []contactOut{}
			for _, ct := range c.List() {
				o := contactOut{ID: ct.ID, Name: untrusted.New(ct.Name), Address: ct.Address, Favorite: ct.Favorite, LastSentAt: ct.LastSentAt}
				if ct.Note != "" {
					o.Note = untrusted.Ptr(ct.Note)
				}
				out = append(out, o)
			}
			return map[string]any{"contacts": out}, nil
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "start_node", Timeout: a.permitTimeout(), Title: "Start the node", Changes: true,
		Description: `Starts the node Parallax Wallet runs, if it is stopped; it then syncs with the network. Returns at once with its status.` + permitNote},
		func(ctx context.Context, _ noIn) (any, error) {
			if err := a.permit(ctx, "startNode"); err != nil {
				return nil, err
			}
			if err := a.deps.Host.StartNode(); err != nil {
				return nil, err
			}
			return map[string]any{"running": a.deps.Node.Status().Running}, nil
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "lock_app", Timeout: a.permitTimeout(), Title: "Lock the app", Changes: true,
		Description: `Locks Parallax Wallet, as its lock button does: the lock screen covers the app until the user unlocks it with the wallet password, which you can't do. While it is locked, this server refuses every other tool call until the user unlocks it. Returns whether it was locked already.` + permitNote},
		func(ctx context.Context, _ noIn) (any, error) {
			if err := a.permit(ctx, "lockApp"); err != nil {
				return nil, err
			}
			w, err := a.wallet()
			if err != nil {
				return nil, err
			}
			if !w.Info().HasPassword {
				return nil, server.Inputf("the wallet has no password yet, so the app has no lock: the user sets one up in the app first")
			}
			already := w.Locked()
			w.Lock()
			return map[string]any{"locked": true, "already_locked": already}, nil
		})

	a.registerRequests(r)
	a.registerTransactions(r)
}

// Locked reports whether the app is locked: the wallet has a password and
// isn't unlocked. Assistants can do nothing then but lock it (mcp.go).
func (a *Assistant) Locked() bool {
	return a.deps.Wallet != nil && a.deps.Wallet.Locked()
}

func (a *Assistant) logs(in logsIn) (any, error) {
	n := in.Lines
	if n <= 0 {
		n = 100
	}
	if n > 500 {
		return nil, server.Inputf("lines is at most 500")
	}
	rank := map[string]int{"crit": 0, "error": 1, "eror": 1, "warn": 2, "info": 3, "debug": 4, "dbug": 4, "trce": 5, "trace": 5}
	max := 3
	if in.Level != "" {
		v, ok := rank[strings.ToLower(in.Level)]
		if !ok {
			return nil, server.Inputf("level is error, warn, info or debug")
		}
		max = v
	}
	if a.deps.Logs == nil {
		return nil, errors.New("the log is unavailable")
	}
	// The lines name the wallet's accounts and what they sent: kept for an
	// unlocked wallet, as everything else that does
	if a.deps.Wallet != nil && a.deps.Wallet.Locked() {
		return nil, ErrLocked
	}
	type lineOut struct {
		Time    int64          `json:"time"`
		Level   string         `json:"level"`
		Source  string         `json:"source"`
		Message untrusted.Text `json:"message"`
	}
	needle := strings.ToLower(in.Contains)
	out := []lineOut{}
	// Read more than asked, as filters drop lines
	for _, l := range a.deps.Logs.Tail(2048) {
		level := strings.ToLower(strings.TrimSpace(l.Level))
		if v, ok := rank[level]; ok && v > max {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(l.Message), needle) {
			continue
		}
		out = append(out, lineOut{Time: l.Timestamp, Level: level, Source: l.Source, Message: untrusted.NewN(l.Message, 2000)})
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return map[string]any{"lines": out}, nil
}

func (a *Assistant) walletAccounts() (any, error) {
	w, err := a.wallet()
	if err != nil {
		return nil, err
	}
	info := w.Info()
	balances, balErr := w.Balances()
	type accountOut struct {
		Address        string `json:"address"`
		Name           string `json:"name,omitempty"`
		WatchOnly      bool   `json:"watch_only"`
		HardwareWallet string `json:"hardware_wallet,omitempty"` // "ledger" or "trezor": it signs on the device
		HardwareID     string `json:"hardware_wallet_id,omitempty"`
		HardwarePath   string `json:"hardware_path,omitempty"`
		BackedUp       bool   `json:"backed_up"`
		RecoveryPhrase string `json:"recovery_phrase_id,omitempty"`
		BalanceWei     string `json:"balance_wei,omitempty"`
		BalanceLAX     string `json:"balance_lax,omitempty"`
	}
	type phraseOut struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Accounts int    `json:"accounts"`
	}
	type hardwareOut struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Device   string `json:"device"`
		Accounts int    `json:"accounts"`
	}
	accounts := []accountOut{}
	for _, acc := range info.Accounts {
		o := accountOut{
			Address: acc.Address, Name: acc.Name, WatchOnly: acc.WatchOnly, BackedUp: acc.BackedUp,
			HardwareWallet: acc.Hardware, HardwareID: acc.HardwareWallet, HardwarePath: acc.HardwarePath,
		}
		if acc.FromSeed {
			o.RecoveryPhrase = acc.SeedID
		}
		if b, ok := balances[acc.Address]; ok {
			o.BalanceWei, o.BalanceLAX = b, weiToLAX(b)
		}
		accounts = append(accounts, o)
	}
	phrases := []phraseOut{}
	for _, s := range info.Seeds {
		phrases = append(phrases, phraseOut{ID: s.ID, Name: s.Name, Accounts: s.Accounts})
	}
	hardware := []hardwareOut{}
	for _, hw := range info.HardwareWallets {
		hardware = append(hardware, hardwareOut{ID: hw.ID, Name: hw.Name, Device: hw.Kind, Accounts: hw.Accounts})
	}
	out := map[string]any{"accounts": accounts, "selected": info.Selected, "recovery_phrases": phrases, "hardware_wallets": hardware}
	if balErr != nil {
		out["balances_unavailable"] = balErr.Error()
	}
	return out, nil
}

// weiToLAX writes decimal wei as LAX, without trailing zeros.
func weiToLAX(wei string) string {
	neg := strings.HasPrefix(wei, "-")
	wei = strings.TrimPrefix(wei, "-")
	if len(wei) <= 18 {
		wei = strings.Repeat("0", 19-len(wei)) + wei
	}
	whole, frac := wei[:len(wei)-18], strings.TrimRight(wei[len(wei)-18:], "0")
	s := whole
	if frac != "" {
		s += "." + frac
	}
	if neg {
		s = "-" + s
	}
	return s
}

const requestNote = ` The user approves or turns it down in Parallax Wallet; the request returns at once with an id for get_request, and expires after 10 minutes.`

func (a *Assistant) registerRequests(r *server.Registrar) {
	server.Add(r, server.Spec{Group: GroupApp, Name: "get_request", Title: "Request outcome",
		Description: `The outcome of a request you made: pending, approved (with what was done), rejected by the user, expired, or failed (with why). With wait_seconds it waits up to that long for the user to decide.`},
		func(ctx context.Context, in getRequestIn) (any, error) {
			wait := time.Duration(in.WaitSeconds) * time.Second
			if wait < 0 || wait > maxRequestWait {
				return nil, server.Inputf("wait_seconds is 0 to 120")
			}
			a.mu.Lock()
			req := a.find(in.ID)
			a.mu.Unlock()
			if req == nil {
				return nil, server.Inputf("no request %q", in.ID)
			}
			if wait > 0 {
				select {
				case <-req.done:
				case <-time.After(wait):
				case <-ctx.Done():
				}
			}
			a.mu.Lock()
			defer a.mu.Unlock()
			return requestOut(req.AssistantRequest), nil
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "request_stop_node", Title: "Ask to stop the node", Changes: true,
		Description: `Asks the user to stop the node Parallax Wallet runs. While it is stopped the chain tools can't answer.` + requestNote + `` + requestPermitNote},
		func(ctx context.Context, in reasonIn) (any, error) {
			if err := a.permit(ctx, "stopNode"); err != nil {
				return nil, err
			}
			if !a.deps.Node.Status().Running {
				return nil, server.Inputf("the node is not running")
			}
			return a.submit(RequestStopNode, in.Reason, AssistantRequest{}, func(string) (string, error) {
				if err := a.deps.Host.StopNode(); err != nil {
					return "", err
				}
				return "the node stopped", nil
			})
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "app_settings", Title: "App settings",
		Description: `The Parallax Wallet settings an assistant may ask to change, each with its key, label, current value, the values it takes, when a change applies ("now", "node" on the node's next start, "app" on the app's) and whether it is sensitive. Settings that could expose the node or the wallet are not listed and can't be changed by assistants.` + requestPermitNote},
		func(ctx context.Context, _ noIn) (any, error) {
			if err := a.permit(ctx, "settings"); err != nil {
				return nil, err
			}
			cur, err := configMap(a.deps.Host.Config())
			if err != nil {
				return nil, err
			}
			type settingOut struct {
				assistantSetting
				Value json.RawMessage `json:"value"`
			}
			out := []settingOut{}
			for _, s := range assistantSettings {
				out = append(out, settingOut{s, cur[s.Key]})
			}
			return map[string]any{"settings": out}, nil
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "request_settings_change", Title: "Ask to change settings", Changes: true,
		Description: `Asks the user to change Parallax Wallet settings: keys from app_settings with their new JSON values. The user sees each change before and after. Changes to node settings apply on the node's next start.` + requestNote + `` + requestPermitNote},
		func(ctx context.Context, in settingsChangeIn) (any, error) {
			if err := a.permit(ctx, "settings"); err != nil {
				return nil, err
			}
			raw := map[string]json.RawMessage{}
			for k, v := range in.Changes {
				// Numbers arrive as float64: past 2^53 they would be rounded
				if f, ok := v.(float64); ok && math.Abs(f) > 1<<53 {
					return nil, server.Inputf("%s is too large to pass exactly", k)
				}
				b, err := json.Marshal(v)
				if err != nil {
					return nil, server.Inputf("%s: %v", k, err)
				}
				raw[k] = b
			}
			changes, err := a.settingChanges(a.deps.Host.Config(), raw)
			if err != nil {
				return nil, err
			}
			return a.submit(RequestSettings, in.Reason, AssistantRequest{Changes: changes}, func(string) (string, error) {
				return a.applySettings(raw)
			})
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "request_new_account", Title: "Ask to create an account", Changes: true,
		Description: `Asks the user to create a wallet account: a new key, or the next account of one of the wallet's recovery phrases. The user types the wallet password in the app; you never see it. Returns the new address once approved.` + requestNote + `` + requestPermitNote},
		func(ctx context.Context, in newAccountIn) (any, error) {
			if err := a.permit(ctx, "newAccounts"); err != nil {
				return nil, err
			}
			w, err := a.wallet()
			if err != nil {
				return nil, err
			}
			name, err := cleanName(in.Name)
			if err != nil {
				return nil, server.Inputf("%v", err)
			}
			info := w.Info()
			if !info.HasPassword {
				return nil, server.Inputf("the wallet has no password yet: the user sets one up in the app first")
			}
			prop := &AccountProposal{Name: name}
			if in.RecoveryPhrase != "" {
				i := slices.IndexFunc(info.Seeds, func(s SeedInfo) bool { return s.ID == in.RecoveryPhrase })
				if i < 0 {
					return nil, server.Inputf("no recovery phrase %q; wallet_accounts lists them", in.RecoveryPhrase)
				}
				prop.SeedID, prop.SeedName = info.Seeds[i].ID, info.Seeds[i].Name
			}
			return a.submit(RequestNewAccount, in.Reason, AssistantRequest{Account: prop}, func(password string) (string, error) {
				var acc WalletAccount
				var err error
				if prop.SeedID != "" {
					acc, err = w.DeriveAccount(prop.SeedID, prop.Name, password)
				} else {
					acc, err = w.Create(prop.Name, password)
				}
				if err != nil {
					return "", err
				}
				return "created account " + acc.Address, nil
			})
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "request_watch_only", Title: "Ask to follow an address", Changes: true,
		Description: `Asks the user to add a watch-only account: an address whose balance and activity the wallet follows, its key kept elsewhere.` + requestNote + `` + requestPermitNote},
		func(ctx context.Context, in watchIn) (any, error) {
			if err := a.permit(ctx, "watchOnly"); err != nil {
				return nil, err
			}
			w, err := a.wallet()
			if err != nil {
				return nil, err
			}
			name, err := cleanName(in.Name)
			if err != nil {
				return nil, server.Inputf("%v", err)
			}
			addr, err := parseRecipient(in.Address)
			if err != nil {
				return nil, server.Inputf("%v", err)
			}
			if _, _, err := w.known(addr.Hex()); err == nil {
				return nil, server.Inputf("%s is already in the wallet", addr.Hex())
			}
			prop := &WatchProposal{Name: name, Address: addr.Hex()}
			return a.submit(RequestWatchOnly, in.Reason, AssistantRequest{Watch: prop}, func(string) (string, error) {
				acc, err := w.AddWatchOnly(prop.Name, prop.Address)
				if err != nil {
					return "", err
				}
				return "following " + acc.Address, nil
			})
		})

	server.Add(r, server.Spec{Group: GroupApp, Name: "request_contact", Title: "Ask to add or change a contact", Changes: true,
		Description: `Asks the user to add a contact, or to change one (with contact_id). The user sees the address in full, and the old values when it changes one.` + requestNote + `` + requestPermitNote},
		func(ctx context.Context, in contactIn) (any, error) {
			if err := a.permit(ctx, "editContacts"); err != nil {
				return nil, err
			}
			c, err := a.contacts()
			if err != nil {
				return nil, err
			}
			addr, err := parseRecipient(in.Address)
			if err != nil {
				return nil, server.Inputf("%v", err)
			}
			prop := &ContactProposal{ID: in.ID, Name: strings.TrimSpace(untrusted.Sanitize(in.Name)), Address: addr.Hex(), Note: strings.TrimSpace(untrusted.Sanitize(in.Note))}
			if prop.Name == "" {
				return nil, server.Inputf("a contact needs a name")
			}
			if in.ID != "" {
				list := c.List()
				i := slices.IndexFunc(list, func(ct Contact) bool { return ct.ID == in.ID })
				if i < 0 {
					return nil, server.Inputf("no contact %q; contacts lists them", in.ID)
				}
				prev := list[i]
				prop.Previous = &prev
			}
			return a.submit(RequestContact, in.Reason, AssistantRequest{Contact: prop}, func(string) (string, error) {
				input := ContactInput{Name: prop.Name, Address: prop.Address, Note: prop.Note}
				if prop.ID != "" {
					ct, err := c.Update(prop.ID, input)
					if err != nil {
						return "", err
					}
					return "changed contact " + ct.ID, nil
				}
				ct, err := c.Add(input)
				if err != nil {
					return "", err
				}
				return "added contact " + ct.ID, nil
			})
		})
}

// configMap is the config as its JSON fields.
func configMap(g GUIConfig) (map[string]json.RawMessage, error) {
	b, err := json.Marshal(g)
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	return m, json.Unmarshal(b, &m)
}

// withChanges is g with the given fields replaced, checked as Settings
// checks a save.
func withChanges(g GUIConfig, changes map[string]json.RawMessage) (GUIConfig, error) {
	m, err := configMap(g)
	if err != nil {
		return g, err
	}
	for k, v := range changes {
		if _, ok := settingByKey(k); !ok {
			return g, server.Inputf("%q is not a setting assistants may change; app_settings lists those that are", k)
		}
		m[k] = v
	}
	b, err := json.Marshal(m)
	if err != nil {
		return g, err
	}
	var out GUIConfig
	if err := json.Unmarshal(b, &out); err != nil {
		return g, server.Inputf("a value has the wrong type: %v", err)
	}
	if err := ValidateConfig(out); err != nil {
		return g, server.Inputf("%v", err)
	}
	return out, nil
}

// settingChanges checks a settings request and describes it for the user.
func (a *Assistant) settingChanges(g GUIConfig, changes map[string]json.RawMessage) ([]SettingChange, error) {
	if len(changes) == 0 {
		return nil, server.Inputf("changes is empty")
	}
	next, err := withChanges(g, changes)
	if err != nil {
		return nil, err
	}
	before, err := configMap(g)
	if err != nil {
		return nil, err
	}
	after, err := configMap(next)
	if err != nil {
		return nil, err
	}
	var out []SettingChange
	for _, s := range assistantSettings {
		if _, asked := changes[s.Key]; !asked || string(before[s.Key]) == string(after[s.Key]) {
			continue
		}
		out = append(out, SettingChange{Key: s.Key, Label: s.Label, From: before[s.Key], To: after[s.Key], Applies: s.Applies, Sensitive: s.Sensitive})
	}
	if len(out) == 0 {
		return nil, server.Inputf("the settings already have these values")
	}
	return out, nil
}

// applySettings saves a request's changes onto the config as it is now.
func (a *Assistant) applySettings(changes map[string]json.RawMessage) (string, error) {
	next, err := withChanges(a.deps.Host.Config(), changes)
	if err != nil {
		return "", err
	}
	if err := a.deps.Host.SaveConfig(next); err != nil {
		return "", err
	}
	var later []string
	for k := range changes {
		if s, _ := settingByKey(k); s.Applies != "now" {
			later = append(later, k)
		}
	}
	if len(later) == 0 {
		return "saved and applied", nil
	}
	slices.Sort(later)
	return "saved; " + strings.Join(later, ", ") + " apply when the node or app restarts", nil
}
