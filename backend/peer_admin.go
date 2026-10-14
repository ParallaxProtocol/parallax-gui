// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"errors"
	"fmt"
	"net"
	"slices"
	"strings"
)

// Peer management from the GUI's peer list. Each action goes through the
// daemon's own admin API over the in-process RPC handler, so it behaves
// exactly as `parallax attach` would: v2 peers are addressed by ip:port
// (they have no persistent identity), a ban also drops matching live
// peers, and the ban list persists in the daemon.

// BanEntry is one entry of the node's ban list.
type BanEntry struct {
	Subnet      string `json:"subnet"`
	CreatedAt   int64  `json:"createdAt"`   // unix seconds
	BannedUntil int64  `json:"bannedUntil"` // unix seconds
}

// errNodeStopped is what every peer action answers while the node is off.
var errNodeStopped = errors.New("the node is not running")

// admin calls the daemon's admin_<method> in-process and returns its
// boolean answer.
func (n *NodeController) admin(method string, args ...any) (bool, error) {
	stack := n.Stack()
	if stack == nil {
		return false, errNodeStopped
	}
	client, err := stack.Attach()
	if err != nil {
		return false, err
	}
	defer client.Close()
	var ok bool
	if err := client.Call(&ok, "admin_"+method, args...); err != nil {
		return false, err
	}
	return ok, nil
}

func isEnode(s string) bool {
	return strings.HasPrefix(s, "enode://") || strings.HasPrefix(s, "enr:")
}

// AddPeer connects to a peer and keeps it: an enode URL becomes a static
// peer the node redials whenever it drops, saved so it is redialed after
// a restart too; an ip:port is pinned in the daemon's address book (which
// persists it and dials it ahead of other addresses) and dialed now.
func (n *NodeController) AddPeer(target string) error {
	target = strings.TrimSpace(target)
	if target == "" {
		return errors.New("enter an enode URL or an ip:port")
	}
	if isEnode(target) {
		if _, err := n.admin("addPeer", target); err != nil {
			return err
		}
		return n.editPeerList(func(c *GUIConfig) { c.StaticPeers = addUnique(c.StaticPeers, target) })
	}
	if _, err := n.admin("addnode", target); err != nil {
		return err
	}
	_, err := n.admin("addPeer", target)
	return err
}

// DisconnectPeer drops a connected peer, named by its enode URL or its
// ip:port. A static peer stops being redialed, now and after a restart.
func (n *NodeController) DisconnectPeer(target string) error {
	target = strings.TrimSpace(target)
	ok, err := n.admin("removePeer", target)
	if err != nil {
		return err
	}
	if isEnode(target) {
		return n.editPeerList(func(c *GUIConfig) { c.StaticPeers = slices.DeleteFunc(c.StaticPeers, sameEnode(target)) })
	}
	if !ok {
		return fmt.Errorf("no connected peer at %s", target)
	}
	return nil
}

// SetTrusted trusts a peer, letting it connect even when every peer slot
// is taken, or stops trusting it. Trust needs a persistent identity, so
// only enode peers can have it. It is saved and re-applied at start.
func (n *NodeController) SetTrusted(enodeURL string, trusted bool) error {
	enodeURL = strings.TrimSpace(enodeURL)
	if !isEnode(enodeURL) {
		return errors.New("only peers with an enode URL can be trusted")
	}
	method := "removeTrustedPeer"
	if trusted {
		method = "addTrustedPeer"
	}
	if _, err := n.admin(method, enodeURL); err != nil {
		return err
	}
	return n.editPeerList(func(c *GUIConfig) {
		if trusted {
			c.TrustedPeers = addUnique(c.TrustedPeers, enodeURL)
		} else {
			c.TrustedPeers = slices.DeleteFunc(c.TrustedPeers, sameEnode(enodeURL))
		}
	})
}

// Ban blocks an IP address or CIDR subnet for seconds (0: the daemon's
// default of a day), disconnecting any matching peer. A host:port, as a
// peer's remote address comes, is banned by its host.
func (n *NodeController) Ban(subnet string, seconds int64) error {
	subnet = banTarget(subnet)
	_, err := n.admin("setban", subnet, "add", seconds)
	return err
}

// Unban lifts a ban.
func (n *NodeController) Unban(subnet string) error {
	_, err := n.admin("setban", strings.TrimSpace(subnet), "remove")
	return err
}

// ClearBanned lifts every ban.
func (n *NodeController) ClearBanned() error {
	_, err := n.admin("clearbanned")
	return err
}

// Banned lists the active bans.
func (n *NodeController) Banned() ([]BanEntry, error) {
	stack := n.Stack()
	if stack == nil {
		return []BanEntry{}, nil
	}
	srv := stack.Server()
	if srv == nil || srv.BanList == nil {
		return []BanEntry{}, nil
	}
	out := []BanEntry{}
	for _, b := range srv.BanList.ListBanned() {
		out = append(out, BanEntry{Subnet: b.Subnet, CreatedAt: b.BanCreated, BannedUntil: b.BannedTill})
	}
	return out, nil
}

// banTarget reduces a peer's remote address ("1.2.3.4:30303",
// "[::1]:30303") to the host the ban list keys on; anything else (an IP,
// a CIDR, an onion name) passes through.
func banTarget(s string) string {
	s = strings.TrimSpace(s)
	if host, _, err := net.SplitHostPort(s); err == nil && !strings.Contains(s, "/") {
		return host
	}
	return s
}

// editPeerList applies edit to the saved config.
func (n *NodeController) editPeerList(edit func(*GUIConfig)) error {
	c := n.cfg.Get()
	edit(&c)
	return n.cfg.Save(c)
}

func addUnique(list []string, s string) []string {
	if slices.ContainsFunc(list, sameEnode(s)) {
		return list
	}
	return append(list, s)
}

// sameEnode matches an enode URL ignoring its query (discport) and case.
func sameEnode(url string) func(string) bool {
	key := func(u string) string { return strings.ToLower(strings.SplitN(u, "?", 2)[0]) }
	k := key(url)
	return func(other string) bool { return key(other) == k }
}
