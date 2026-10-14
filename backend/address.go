// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"fmt"
	"strings"
	"sync"

	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

const (
	// addressLookback bounds the activity scan: about a week of 10 minute
	// blocks. The chain is walked in-process, so this stays cheap, and the
	// result is cached per head.
	addressLookback = 1008
	addressMaxTxs   = 25
)

// addressCache holds the last AddressSummary per address, valid while the
// head has not moved. The Wallet page polls, and most polls land on the
// same head.
type addressCache struct {
	mu      sync.Mutex
	head    util.Hash
	entries map[util.Address]AddressView
}

var addrCache = addressCache{entries: make(map[util.Address]AddressView)}

// AddressSummary returns the balance of addr at the chain head and its
// activity over the last addressLookback blocks: transactions from or to
// it.
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

	addrCache.mu.Lock()
	if addrCache.head != head.Hash() {
		addrCache.head = head.Hash()
		addrCache.entries = make(map[util.Address]AddressView)
	}
	if v, ok := addrCache.entries[account]; ok {
		addrCache.mu.Unlock()
		return v, nil
	}
	addrCache.mu.Unlock()

	headNum := head.NumberU64()
	view := AddressView{
		Address:      account.Hex(),
		HeadBlock:    headNum,
		Transactions: []TxView{},
	}
	// The head state is missing until a snap sync has finished
	if st, err := bc.State(); err == nil {
		view.BalanceWei = st.GetBalance(account).String()
		view.Nonce = st.GetNonce(account)
	}

	signer := types.LatestSignerForChainID(bc.Config().ChainID)
	view.ScannedFrom = headNum
	for i := uint64(0); i < addressLookback && i <= headNum; i++ {
		num := headNum - i
		block := bc.GetBlockByNumber(num)
		if block == nil {
			break
		}
		view.ScannedFrom = num
		if len(view.Transactions) >= addressMaxTxs {
			break
		}
		for _, tx := range block.Transactions() {
			from, err := types.Sender(signer, tx)
			toMatch := tx.To() != nil && *tx.To() == account
			if !toMatch && (err != nil || from != account) {
				continue
			}
			to, kind := "", "call"
			if tx.To() == nil {
				kind = "contract"
			} else {
				to = tx.To().Hex()
				if len(tx.Data()) == 0 {
					kind = "transfer"
				}
			}
			fromHex := ""
			if err == nil {
				fromHex = from.Hex()
			}
			view.Transactions = append(view.Transactions, TxView{
				Hash:      tx.Hash().Hex(),
				Block:     num,
				Timestamp: int64(block.Time()),
				From:      fromHex,
				To:        to,
				ValueWei:  tx.Value().String(),
				GasUsed:   tx.Gas(),
				Kind:      kind,
			})
			if len(view.Transactions) >= addressMaxTxs {
				break
			}
		}
	}

	addrCache.mu.Lock()
	if addrCache.head == head.Hash() {
		addrCache.entries[account] = view
	}
	addrCache.mu.Unlock()
	return view, nil
}
