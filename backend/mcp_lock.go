// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"errors"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// errAppLocked is what an assistant is told of a call made while the app
// is locked.
const errAppLocked = "Parallax Wallet is locked: nothing but lock_app answers until the user unlocks it in the app with the wallet password, which you can't do. Ask them to unlock it, then try again."

// errLockedMidCall is what it's told of a call the lock cut short.
const errLockedMidCall = "The user locked Parallax Wallet while this call was running, so it was cancelled before it finished. Nothing but lock_app answers until they unlock it in the app with the wallet password, which you can't do. Ask them to unlock it before trying this again."

// lockedMethods are what an assistant can't do while the app is locked:
// everything that reads or does something. Introducing itself, listing
// what there is, pinging and its notifications go on.
var lockedMethods = map[string]bool{
	"tools/call":          true,
	"resources/read":      true,
	"resources/subscribe": true,
	"prompts/get":         true,
	"completion/complete": true,
}

// lockTool is the one tool that answers while the app is locked.
const lockTool = "lock_app"

// lockGated reports whether the method call waits for the app to be
// unlocked.
func lockGated(method string, req mcp.Request) bool {
	if !lockedMethods[method] {
		return false
	}
	if call, ok := req.(*mcp.CallToolRequest); ok && call.Params != nil && call.Params.Name == lockTool {
		return false
	}
	return true
}

// lockGate is the server's outermost middleware: while the app is locked
// it refuses everything but locking it, and as it locks it ends the calls
// still running. While a call runs, the wallet doesn't lock itself for
// being left idle.
func (m *MCPServer) lockGate(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		if !lockGated(method, req) {
			return next(ctx, method, req)
		}
		ctx, cancel := context.WithCancel(ctx)
		defer cancel()
		// Followed before the check, so a lock between the two still ends it
		c := m.calls.start(cancel)
		defer m.calls.end(c)
		if m.assistant.Locked() {
			return lockedResult(method, errAppLocked)
		}
		if w := m.assistant.deps.Wallet; w != nil {
			defer w.Hold()()
		}
		res, err := next(ctx, method, req)
		if c.ended() {
			return lockedResult(method, errLockedMidCall)
		}
		return res, err
	}
}

// lockedResult refuses a call for the lock: a tool's as its result, which
// the assistant reads, anything else as an error.
func lockedResult(method, text string) (mcp.Result, error) {
	if method == "tools/call" {
		return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil
	}
	return nil, errors.New(text)
}

// errLockedRequest is the outcome of a request the lock turned down.
const errLockedRequest = "the user locked Parallax Wallet before deciding, which turned the request down; ask again once they have unlocked it, if it's still wanted"

// AppLocked ends the calls assistants are making, and turns down the
// requests waiting on the user, as the app locks.
func (m *MCPServer) AppLocked() {
	m.calls.endAll()
	m.assistant.rejectAll(errLockedRequest)
}

// lockCall is a call that ends as the app locks.
type lockCall struct {
	cancel context.CancelFunc
	mu     sync.Mutex
	done   bool
}

func (c *lockCall) ended() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.done
}

// lockCalls are the calls running now.
type lockCalls struct {
	mu    sync.Mutex
	calls map[*lockCall]struct{}
}

func (l *lockCalls) start(cancel context.CancelFunc) *lockCall {
	c := &lockCall{cancel: cancel}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.calls == nil {
		l.calls = map[*lockCall]struct{}{}
	}
	l.calls[c] = struct{}{}
	return c
}

func (l *lockCalls) end(c *lockCall) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.calls, c)
}

func (l *lockCalls) endAll() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for c := range l.calls {
		c.mu.Lock()
		c.done = true
		c.mu.Unlock()
		c.cancel()
	}
}
