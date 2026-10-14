// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"sort"
	"strings"

	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

// MempoolTx is one transaction waiting in the node's pool. Amounts are
// decimal wei strings; To is empty for a contract creation.
type MempoolTx struct {
	Hash        string `json:"hash"`
	From        string `json:"from"`
	To          string `json:"to"`
	Nonce       uint64 `json:"nonce"`
	ValueWei    string `json:"valueWei"`
	GasPriceWei string `json:"gasPriceWei"`
	Gas         uint64 `json:"gas"`
	SizeBytes   uint64 `json:"sizeBytes"`
	DataBytes   int    `json:"dataBytes"`
	Type        uint8  `json:"type"`
	// Queued transactions can't be mined yet: a nonce gap, or not enough
	// balance, holds them back
	Queued bool `json:"queued"`
}

// MempoolView is a page of the pool: the pool's totals, how many
// transactions match the query, and the first of them.
type MempoolView struct {
	Pending int         `json:"pending"`
	Queued  int         `json:"queued"`
	Matched int         `json:"matched"`
	Txs     []MempoolTx `json:"txs"`
}

const (
	mempoolDefaultLimit = 200
	mempoolMaxLimit     = 1000
)

// Mempool lists the transactions in the node's pool that match query (a
// fragment of a hash, sender or recipient, any case), up to limit of them:
// pending before queued, the best-paying first, and a sender's own in
// nonce order. An empty query matches everything.
func (n *NodeController) Mempool(query string, limit int) MempoolView {
	parallax := n.Parallax()
	if parallax == nil {
		return MempoolView{Txs: []MempoolTx{}}
	}
	pending, queued := parallax.TxPool().Content()
	return listMempool(pending, queued, query, limit)
}

// listMempool filters, orders and pages the pool's content for Mempool.
func listMempool(pending, queued map[util.Address]types.Transactions, query string, limit int) MempoolView {
	if limit <= 0 {
		limit = mempoolDefaultLimit
	}
	if limit > mempoolMaxLimit {
		limit = mempoolMaxLimit
	}
	q := strings.ToLower(strings.TrimSpace(query))

	view := MempoolView{Txs: []MempoolTx{}}
	var all []MempoolTx
	add := func(content map[util.Address]types.Transactions, isQueued bool) int {
		count := 0
		for from, txs := range content {
			sender := strings.ToLower(from.Hex())
			for _, tx := range txs {
				count++
				mtx := MempoolTx{
					Hash:        tx.Hash().Hex(),
					From:        sender,
					Nonce:       tx.Nonce(),
					ValueWei:    tx.Value().String(),
					GasPriceWei: tx.GasPrice().String(),
					Gas:         tx.Gas(),
					SizeBytes:   uint64(tx.Size()),
					DataBytes:   len(tx.Data()),
					Type:        tx.Type(),
					Queued:      isQueued,
				}
				if to := tx.To(); to != nil {
					mtx.To = strings.ToLower(to.Hex())
				}
				if q == "" || strings.Contains(mtx.Hash, q) || strings.Contains(mtx.From, q) || strings.Contains(mtx.To, q) {
					all = append(all, mtx)
				}
			}
		}
		return count
	}
	view.Pending = add(pending, false)
	view.Queued = add(queued, true)
	view.Matched = len(all)

	sort.SliceStable(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if a.Queued != b.Queued {
			return !a.Queued
		}
		if c := compareDecimal(a.GasPriceWei, b.GasPriceWei); c != 0 {
			return c > 0
		}
		if a.From != b.From {
			return a.From < b.From
		}
		return a.Nonce < b.Nonce
	})
	if len(all) > limit {
		all = all[:limit]
	}
	view.Txs = append(view.Txs, all...)
	return view
}

// compareDecimal compares two non-negative decimal integer strings without
// parsing them: the longer is larger, and equal lengths compare as text.
func compareDecimal(a, b string) int {
	if len(a) != len(b) {
		if len(a) > len(b) {
			return 1
		}
		return -1
	}
	return strings.Compare(a, b)
}
