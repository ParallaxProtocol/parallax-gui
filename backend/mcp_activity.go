// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"cmp"
	"context"
	"encoding/json"
	"slices"
	"sync"
	"sync/atomic"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// MCPActivity is a tool call an assistant is making now, for the assistant
// bar to show it at work, and to let the user cancel it.
type MCPActivity struct {
	Tool   string `json:"tool"`
	Client string `json:"client"`
	// Block is the block a wait_for_new_block call waits for, when it
	// names one; the bar says what is awaited
	Block *uint64 `json:"block,omitempty"`

	cancel    context.CancelFunc
	cancelled atomic.Bool
}

// idleTools wait on the user rather than work, so they don't show as
// activity: the user's decision shows in the bar already.
var idleTools = map[string]bool{"get_request": true}

// errCancelled is what the assistant is told of a call the user cancelled.
const errCancelled = "the user cancelled this call in Parallax Wallet; ask them before trying it again"

// activityOf is the activity a call of the tool with its arguments shows
// as, nil for one that doesn't show.
func activityOf(tool string, args json.RawMessage) *MCPActivity {
	if tool == "" || idleTools[tool] {
		return nil
	}
	act := &MCPActivity{Tool: tool}
	if tool == "wait_for_new_block" {
		var in struct {
			AfterBlock *uint64 `json:"after_block"`
		}
		if json.Unmarshal(args, &in) == nil && in.AfterBlock != nil {
			next := *in.AfterBlock + 1
			act.Block = &next
		}
	}
	return act
}

// observe is the server's middleware for the assistant bar: it shows each
// tool call while it runs, under a context the user can cancel, and tells
// of a new connection once the assistant has introduced itself.
func (m *MCPServer) observe(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		switch method {
		case "initialize":
			defer m.notifyStatus()
		case "tools/call":
			call, ok := req.(*mcp.CallToolRequest)
			if !ok || call.Params == nil {
				break
			}
			act := activityOf(call.Params.Name, call.Params.Arguments)
			if act == nil {
				break
			}
			act.Client = clientName(call.Session)
			ctx, act.cancel = context.WithCancel(ctx)
			defer act.cancel()
			defer m.activity.start(act)()
			res, err := next(ctx, method, req)
			if act.cancelled.Load() {
				return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: errCancelled}}}, nil
			}
			return res, err
		}
		return next(ctx, method, req)
	}
}

// mcpActivity follows the tool calls in progress; the latest is what the
// bar shows, and none is told as nil.
type mcpActivity struct {
	mu    sync.Mutex
	calls []*MCPActivity // in progress, oldest first
	emit  func(*MCPActivity)
}

func (a *mcpActivity) setEmitter(fn func(*MCPActivity)) {
	a.mu.Lock()
	a.emit = fn
	a.mu.Unlock()
}

// start records a call, until the returned func is called.
func (a *mcpActivity) start(c *MCPActivity) func() {
	a.mu.Lock()
	a.calls = append(a.calls, c)
	a.notifyLocked()
	a.mu.Unlock()
	return func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		if i := slices.Index(a.calls, c); i >= 0 {
			a.calls = slices.Delete(a.calls, i, i+1)
			a.notifyLocked()
		}
	}
}

// cancelLatest cancels the call the bar shows, reporting whether there was one.
func (a *mcpActivity) cancelLatest() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := len(a.calls)
	if n == 0 {
		return false
	}
	c := a.calls[n-1]
	c.cancelled.Store(true)
	c.cancel()
	return true
}

func (a *mcpActivity) notifyLocked() {
	if a.emit == nil {
		return
	}
	var latest *MCPActivity
	if n := len(a.calls); n > 0 {
		latest = a.calls[n-1]
	}
	a.emit(latest)
}

// clientName is how an assistant introduced itself.
func clientName(sess *mcp.ServerSession) string {
	if sess == nil {
		return ""
	}
	if p := sess.InitializeParams(); p != nil && p.ClientInfo != nil {
		return cmp.Or(p.ClientInfo.Title, p.ClientInfo.Name)
	}
	return ""
}
