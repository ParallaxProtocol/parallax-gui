// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

// addressCache holds the last AddressSummary per address, valid while
// neither the head nor the history index's tip has moved. The Wallet page
// polls, and most polls land on the same head. The pool's transactions are
// read afresh on every call.
type addressCache struct {
	mu      sync.Mutex
	head    util.Hash
	tip     uint64
	entries map[util.Address]AddressView
}

var addrCache = addressCache{entries: make(map[util.Address]AddressView)}

// AddressSummary returns the balance of addr at the chain head, the newest
// page of its history (history.go) and its transactions still waiting in
// the pool.
func (n *NodeController) AddressSummary(addr string) (AddressView, error) {
	addr = strings.TrimSpace(addr)
	if !util.IsHexAddress(addr) {
		return AddressView{}, fmt.Errorf("invalid address %q", addr)
	}
	parallax := n.Parallax()
	if parallax == nil {
		return AddressView{}, fmt.Errorf("node is not running")
	}
	bc := parallax.BlockChain()
	head := bc.CurrentBlock()
	if head == nil {
		return AddressView{}, fmt.Errorf("chain head unavailable")
	}
	account := util.HexToAddress(addr)
	idx := n.historyIndex()
	var tip uint64
	if idx != nil {
		tip = idx.Tip().num
	}

	addrCache.mu.Lock()
	if addrCache.head != head.Hash() || addrCache.tip != tip {
		addrCache.head = head.Hash()
		addrCache.tip = tip
		addrCache.entries = make(map[util.Address]AddressView)
	}
	if v, ok := addrCache.entries[account]; ok {
		addrCache.mu.Unlock()
		pending, queued := parallax.TxPool().Content()
		v.Pending = poolActivity(pending, queued, account)
		return v, nil
	}
	addrCache.mu.Unlock()

	view := AddressView{
		Address:   account.Hex(),
		HeadBlock: head.NumberU64(),
	}
	// The head state is missing until a snap sync has finished
	if st, err := bc.State(); err == nil {
		view.BalanceWei = st.GetBalance(account).String()
		view.Nonce = st.GetNonce(account)
	}
	page, err := readHistory(bc, idx, histQuery{addr: account}, historyPageSize)
	if err != nil {
		return AddressView{}, err
	}
	view.HistoryPage = page

	addrCache.mu.Lock()
	if addrCache.head == head.Hash() && addrCache.tip == tip {
		addrCache.entries[account] = view
	}
	addrCache.mu.Unlock()
	pending, queued := parallax.TxPool().Content()
	view.Pending = poolActivity(pending, queued, account)
	return view, nil
}

// AccountHistory reads a page of an account's history, as q asks.
func (n *NodeController) AccountHistory(q HistoryQuery) (HistoryPage, error) {
	hq, err := parseHistQuery(q)
	if err != nil {
		return HistoryPage{}, err
	}
	parallax := n.Parallax()
	if parallax == nil {
		return HistoryPage{}, fmt.Errorf("node is not running")
	}
	return readHistory(parallax.BlockChain(), n.historyIndex(), hq, historyPageSize)
}

// FindHistoryTx finds transaction hash among addr's.
func (n *NodeController) FindHistoryTx(addr, hash string) (HistoryFind, error) {
	addr = strings.TrimSpace(addr)
	if !util.IsHexAddress(addr) {
		return HistoryFind{}, fmt.Errorf("invalid address %q", addr)
	}
	parallax := n.Parallax()
	if parallax == nil {
		return HistoryFind{}, fmt.Errorf("node is not running")
	}
	return findHistoryTx(parallax.BlockChain(), parallax.ChainDb(), parallax.TxPool(), util.HexToAddress(addr), hash)
}

// HistoryBlockAt is the newest block mined at or before t (Unix seconds),
// for the history to start from a date.
func (n *NodeController) HistoryBlockAt(t int64) (uint64, error) {
	parallax := n.Parallax()
	if parallax == nil {
		return 0, fmt.Errorf("node is not running")
	}
	return blockAt(parallax.BlockChain(), t), nil
}

// ExportHistory writes the whole history q asks for to path as CSV
// (exportHistory).
func (n *NodeController) ExportHistory(q HistoryQuery, path string, names map[string]string, progress func(done, total uint64)) (int, error) {
	hq, err := parseHistQuery(q)
	if err != nil {
		return 0, err
	}
	parallax := n.Parallax()
	if parallax == nil {
		return 0, fmt.Errorf("node is not running")
	}
	return exportHistory(parallax.BlockChain(), n.historyIndex(), hq, path, names, progress)
}

// poolActivity lists the pool's transactions from or to account. Queued
// ones (held back by a nonce gap or the balance) are listed with the
// pending: both are waiting. The order holds from one call to the next,
// though the pool hands its transactions over in no order: the account's
// own first, by nonce, the order they'll be mined in; then those sent to
// it, by sender and nonce.
func poolActivity(pending, queued map[util.Address]types.Transactions, account util.Address) []TxView {
	type waiting struct {
		view  TxView
		from  util.Address
		nonce uint64
	}
	var all []waiting
	for _, pool := range []map[util.Address]types.Transactions{pending, queued} {
		for from, txs := range pool {
			for _, tx := range txs {
				to := tx.To()
				if from != account && (to == nil || *to != account) {
					continue
				}
				v := TxView{
					Hash:     tx.Hash().Hex(),
					From:     from.Hex(),
					ValueWei: tx.Value().String(),
					GasUsed:  tx.Gas(),
					Kind:     "call",
				}
				switch {
				case to == nil:
					v.Kind = "contract"
				case len(tx.Data()) == 0:
					v.Kind = "transfer"
				}
				if to != nil {
					v.To = to.Hex()
				}
				all = append(all, waiting{view: v, from: from, nonce: tx.Nonce()})
			}
		}
	}
	sort.Slice(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if mineA, mineB := a.from == account, b.from == account; mineA != mineB {
			return mineA
		}
		if c := bytes.Compare(a.from.Bytes(), b.from.Bytes()); c != 0 {
			return c < 0
		}
		return a.nonce < b.nonce
	})
	out := make([]TxView, len(all))
	for i, w := range all {
		out[i] = w.view
	}
	return out
}
