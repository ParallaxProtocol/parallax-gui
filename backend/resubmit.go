// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"encoding/hex"
	"path/filepath"
	"strings"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/rpc/client"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

// The node keeps no journal of the transactions sent through it (flags.go):
// one would sit in its data folder in the clear, linking this computer to
// the accounts it sends from, and the node runs while the wallet is
// locked, so it couldn't be sealed. The wallet keeps its own sends
// instead, sealed (pending.sealed), until each is in a block, and sends
// them again as it unlocks with the node running, or as the node starts
// while it's unlocked: one the node lost by restarting gets to its peers
// again.

// pendingSend is one send waiting for its block: the signed transaction,
// and its sender and nonce, to tell when it's done.
type pendingSend struct {
	Hash  string `json:"hash"`
	From  string `json:"from"`
	Nonce uint64 `json:"nonce"`
	Raw   string `json:"raw"` // hex, the signed transaction
}

// maxPending bounds the sends kept: far more than an account has waiting.
const maxPending = 256

func (w *Wallet) pendingPath() string { return filepath.Join(filepath.Dir(w.dir), sealedPending) }

// recordPending keeps tx, just sent from from, until it's in a block; a
// send it replaces (the same sender and nonce) goes. A failure only costs
// the resend after a restart, so it is logged.
func (w *Wallet) recordPending(tx *types.Transaction, from util.Address) {
	raw, err := tx.MarshalBinary()
	if err != nil {
		return
	}
	w.pendMu.Lock()
	defer w.pendMu.Unlock()
	var list []pendingSend
	damaged, err := w.readSealedOrRecover(w.pendingPath(), sealedPending, &list)
	if damaged {
		w.noteDamaged("pending")
	}
	if err != nil {
		logging.Warn("Failed to read the sends waiting for a block", "err", err)
		return
	}
	kept := list[:0]
	for _, p := range list {
		if !(strings.EqualFold(p.From, from.Hex()) && p.Nonce == tx.Nonce()) {
			kept = append(kept, p)
		}
	}
	kept = append(kept, pendingSend{Hash: tx.Hash().Hex(), From: from.Hex(), Nonce: tx.Nonce(), Raw: hex.EncodeToString(raw)})
	if len(kept) > maxPending {
		kept = kept[len(kept)-maxPending:]
	}
	if err := w.WriteSealed(w.pendingPath(), sealedPending, kept); err != nil {
		logging.Warn("Failed to keep a send until its block", "err", err)
	}
}

// Resubmit sends again each kept send not yet in a block, and forgets
// those that are (their sender's nonce has moved past theirs). Nothing
// happens while the wallet is locked or the node isn't running.
func (w *Wallet) Resubmit() {
	if !w.opened() {
		return
	}
	stack := w.node.Stack()
	if stack == nil {
		return
	}
	rpcClient, err := stack.Attach()
	if err != nil {
		return
	}
	ec := client.NewClient(rpcClient)
	defer ec.Close()

	w.pendMu.Lock()
	defer w.pendMu.Unlock()
	var list []pendingSend
	damaged, err := w.readSealedOrRecover(w.pendingPath(), sealedPending, &list)
	if damaged {
		w.noteDamaged("pending")
	}
	if err != nil || len(list) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	nonces := map[string]uint64{}
	kept := list[:0]
	resent := 0
	for _, p := range list {
		from := util.HexToAddress(p.From)
		next, ok := nonces[p.From]
		if !ok {
			// The nonce the chain's latest block says comes next
			if next, err = ec.NonceAt(ctx, from, nil); err != nil {
				kept = append(kept, p)
				continue
			}
			nonces[p.From] = next
		}
		if p.Nonce < next {
			continue // in a block, this send or one that replaced it
		}
		kept = append(kept, p)
		raw, err := hex.DecodeString(p.Raw)
		if err != nil {
			continue
		}
		tx := new(types.Transaction)
		if tx.UnmarshalBinary(raw) != nil {
			continue
		}
		// Already in the pool is as good as sent
		if err := ec.SendTransaction(ctx, tx); err == nil {
			resent++
		}
	}
	if err := w.WriteSealed(w.pendingPath(), sealedPending, kept); err != nil {
		logging.Warn("Failed to keep the sends waiting for a block", "err", err)
	}
	if resent > 0 {
		logging.Info("Sent again the wallet's transactions still waiting for a block", "count", resent)
	}
}
