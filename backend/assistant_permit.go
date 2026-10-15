// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ParallaxProtocol/parallax-mcp/pkg/server"
)

// MCPMode is how the app answers an assistant's use of a feature: as claude.ai
// asks before a tool runs, the app can ask the user, who allows it once (for
// that assistant's connection), always (the mode becomes allow), or not.
type MCPMode string

const (
	// ModeAllow lets the feature go ahead without asking
	ModeAllow MCPMode = "allow"
	// ModeAsk asks the user each time a connection first uses it; it is
	// also the mode of a feature the config doesn't name
	ModeAsk MCPMode = "ask"
	// ModeBlock refuses the feature without asking
	ModeBlock MCPMode = "block"
)

// UnmarshalJSON reads a mode, and the on/off switches configs held before
// the modes: on is allow, off is ask.
func (m *MCPMode) UnmarshalJSON(b []byte) error {
	var on bool
	if json.Unmarshal(b, &on) == nil {
		*m = ModeAsk
		if on {
			*m = ModeAllow
		}
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	switch v := MCPMode(s); v {
	case ModeAllow, ModeAsk, ModeBlock, "":
		*m = v
		return nil
	}
	return fmt.Errorf("unknown assistant permission mode %q", s)
}

// or is the mode, ask when unset.
func (m MCPMode) or() MCPMode {
	if m == "" {
		return ModeAsk
	}
	return m
}

// mcpFeature is one permission: its mode in the config, and what an
// assistant does with it, in words for messages to the assistant.
type mcpFeature struct {
	mode *MCPMode
	does string
	// request marks the features that only let assistants ask (requests
	// the user approves one by one): they are never prompted for
	request bool
}

func (a *MCPAllow) feature(name string) (mcpFeature, bool) {
	switch name {
	case "nodeStatus":
		return mcpFeature{&a.NodeStatus, "see the node's status", false}, true
	case "nodeLogs":
		return mcpFeature{&a.NodeLogs, "read the logs", false}, true
	case "wallet":
		return mcpFeature{&a.Wallet, "see the wallet", false}, true
	case "contacts":
		return mcpFeature{&a.Contacts, "see the contacts", false}, true
	case "startNode":
		return mcpFeature{&a.StartNode, "start the node", false}, true
	case "stopNode":
		return mcpFeature{&a.StopNode, "ask to stop the node", true}, true
	case "settings":
		return mcpFeature{&a.Settings, "see or ask to change settings", true}, true
	case "newAccounts":
		return mcpFeature{&a.NewAccounts, "ask to create accounts", true}, true
	case "watchOnly":
		return mcpFeature{&a.WatchOnly, "ask to add watch-only accounts", true}, true
	case "editContacts":
		return mcpFeature{&a.EditContacts, "ask to edit the contacts", true}, true
	case "sendTransactions":
		return mcpFeature{&a.SendTransactions, "ask to send transactions", true}, true
	}
	return mcpFeature{}, false
}

// PermissionPrompt is what a permission prompt asks to let go ahead.
type PermissionPrompt struct {
	Feature string `json:"feature"`
	Tool    string `json:"tool"`
	// NodeStopped marks a prompt to start the node because a tool needs it
	NodeStopped bool `json:"nodeStopped,omitempty"`
}

const (
	// defaultPermissionWait is how long a tool waits on the user to answer
	defaultPermissionWait = 2 * time.Minute
	// grantIdle is how long a connection keeps a feature allowed once
	// after its last use of it
	grantIdle = 30 * time.Minute
)

type grantKey struct {
	session *mcp.ServerSession
	feature string
}

// permitTimeout is the timeout of a tool that may wait on a prompt: two,
// when it also needs the node started.
func (a *Assistant) permitTimeout() time.Duration { return 2*a.permissionWait + time.Minute }

const permitNote = ` If the user hasn't allowed it, they are asked in Parallax Wallet first, and the call waits up to 2 minutes for their answer.`

const requestPermitNote = ` The user can block assistants from asking for this in Parallax Wallet.`

const permissionsPlace = "Parallax Wallet, Settings › AI assistants › Permissions"

// permit lets a tool go ahead as the user wants for the feature: at once
// when it's allowed, never when it's blocked, and otherwise once they
// answer a prompt in the app, or allowed it once for this connection.
// Features that only let assistants ask are never prompted for: each
// request is approved on its own.
func (a *Assistant) permit(ctx context.Context, name string) error {
	return a.permitAsk(ctx, name, false)
}

// ensureNode has the node started for a tool that needs it, as the user
// allows starting it: at once (allow), once they answer a prompt (ask),
// or not (block). Outside a tool call, as when a subscription polls the
// head, nobody is there to ask.
func (a *Assistant) ensureNode(ctx context.Context) error {
	if a.deps.Node.Status().Running {
		return nil
	}
	if server.Request(ctx) == nil {
		return errMCPNodeStopped
	}
	if err := a.permitAsk(ctx, "startNode", true); err != nil {
		return fmt.Errorf("the node is stopped: %w", err)
	}
	if err := a.deps.Host.StartNode(); err != nil {
		return fmt.Errorf("starting the node: %w", err)
	}
	return nil
}

// permitAsk is permit; nodeStopped tells the user why it's asked.
func (a *Assistant) permitAsk(ctx context.Context, name string, nodeStopped bool) error {
	allow := a.allow()
	f, ok := allow.feature(name)
	if !ok {
		return fmt.Errorf("unknown permission %q", name)
	}
	switch f.mode.or() {
	case ModeAllow:
		return nil
	case ModeBlock:
		return fmt.Errorf("the user doesn't let assistants %s: they can change it in %s", f.does, permissionsPlace)
	}
	if f.request {
		return nil
	}

	var session *mcp.ServerSession
	tool := ""
	if req := server.Request(ctx); req != nil {
		session = req.Session
		if req.Params != nil {
			tool = req.Params.Name
		}
	}
	key := grantKey{session, name}

	a.mu.Lock()
	if until, ok := a.grants[key]; ok && session != nil {
		if a.now().Before(until) {
			a.grants[key] = a.now().Add(grantIdle)
			a.mu.Unlock()
			return nil
		}
		delete(a.grants, key)
	}
	// A prompt this connection already waits on for the feature answers
	// this call too
	var r *assistantRequest
	for _, p := range a.requests {
		if p.Status == RequestPending && p.Kind == RequestPermission && p.session == session && p.Permission.Feature == name {
			r = p
			break
		}
	}
	if r == nil {
		var err error
		r, err = a.queueLocked(RequestPermission, "", AssistantRequest{Permission: &PermissionPrompt{Feature: name, Tool: tool, NodeStopped: nodeStopped}}, nil,
			a.permissionWait, "the user did not answer within 2 minutes")
		if err != nil {
			a.mu.Unlock()
			return err
		}
		r.session = session
	}
	a.mu.Unlock()

	select {
	case <-r.done:
	case <-ctx.Done():
		// The assistant gave up: the prompt goes with it
		a.mu.Lock()
		if r.Status == RequestPending {
			a.decideLocked(r, RequestExpired, "the assistant stopped waiting")
		}
		a.mu.Unlock()
		return ctx.Err()
	}
	a.mu.Lock()
	status := r.Status
	a.mu.Unlock()
	switch status {
	case RequestApproved:
		return nil
	case RequestRejected:
		return fmt.Errorf("the user turned down your request to %s", f.does)
	default:
		return fmt.Errorf("the user didn't answer your request to %s within 2 minutes; ask them to look at Parallax Wallet, or to allow it in %s", f.does, permissionsPlace)
	}
}

// Allow answers a permission prompt: once, for the connection that asked,
// or always, setting the feature's mode to allow.
func (a *Assistant) Allow(id string, always bool) (AssistantRequest, error) {
	a.mu.Lock()
	r := a.find(id)
	switch {
	case r == nil:
		a.mu.Unlock()
		return AssistantRequest{}, errors.New("no such request")
	case r.Kind != RequestPermission:
		a.mu.Unlock()
		return r.AssistantRequest, errors.New("only a permission prompt is answered with Allow")
	case r.Status != RequestPending:
		a.mu.Unlock()
		return r.AssistantRequest, fmt.Errorf("the request is already %s", r.Status)
	}
	name := r.Permission.Feature
	a.mu.Unlock()

	if always {
		cfg := a.deps.Host.Config()
		f, ok := cfg.MCPAllow.feature(name)
		if !ok {
			return r.AssistantRequest, fmt.Errorf("unknown permission %q", name)
		}
		*f.mode = ModeAllow
		if err := a.deps.Host.SaveConfig(cfg); err != nil {
			return r.AssistantRequest, err
		}
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if r.Status != RequestPending {
		return r.AssistantRequest, fmt.Errorf("the request is already %s", r.Status)
	}
	if r.session != nil {
		a.grants[grantKey{r.session, name}] = a.now().Add(grantIdle)
	}
	result := "allowed once"
	if always {
		result = "allowed always"
	}
	a.decideLocked(r, RequestApproved, result)
	return r.AssistantRequest, nil
}
