// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/ParallaxProtocol/parallax/v2/dbstore"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/util/hexutil"
	"github.com/ParallaxProtocol/parallax/v2/validation"
	"github.com/ParallaxProtocol/parallax/v2/validation/rawdb"
)

// TxDetails is everything the node knows of one transaction, for the
// wallet's activity list to show when a row is opened. A transaction still
// in the pool has no block, receipt or fee paid yet: Status is "pending"
// and FeeWei is the most it can cost. Parallax has no base fee: the gas
// price is the whole price per gas. Amounts are decimal wei strings.
type TxDetails struct {
	Hash   string `json:"hash"`
	Status string `json:"status"` // "pending" | "success" | "failed"

	// Where it was included; zero while pending
	Block     uint64 `json:"block"`
	BlockHash string `json:"blockHash"`
	Index     uint64 `json:"index"` // its position in the block
	Timestamp int64  `json:"timestamp"`

	From            string `json:"from"`
	To              string `json:"to"`              // empty for a contract creation
	ContractAddress string `json:"contractAddress"` // the contract it created, if any
	ValueWei        string `json:"valueWei"`
	Nonce           uint64 `json:"nonce"`

	GasLimit    uint64 `json:"gasLimit"`
	GasUsed     uint64 `json:"gasUsed"` // zero while pending
	GasPriceWei string `json:"gasPriceWei"`
	FeeWei      string `json:"feeWei"` // gasUsed × price; gasLimit × price while pending

	Input     string `json:"input"` // 0x-prefixed call data
	SizeBytes uint64 `json:"sizeBytes"`
	Logs      int    `json:"logs"` // events it emitted
}

// TxDetails looks a transaction up by hash, in the chain and then the pool.
func (n *NodeController) TxDetails(hash string) (TxDetails, error) {
	return n.TxDetailsAt(hash, 0, 0)
}

// TxDetailsAt looks a transaction up as TxDetails does, first at the
// position the wallet's history found it in (block, when non-zero, and
// its index there): the node's transaction index holds only the last
// TxLookupLimit blocks' (a year's by default), the history all of them.
func (n *NodeController) TxDetailsAt(hash string, block, index uint64) (TxDetails, error) {
	hash = strings.TrimSpace(hash)
	raw, err := hexutil.Decode(hash)
	if err != nil || len(raw) != util.HashLength {
		return TxDetails{}, fmt.Errorf("invalid transaction hash %q", hash)
	}
	h := util.BytesToHash(raw)
	prl := n.Parallax()
	if prl == nil {
		return TxDetails{}, ErrNodeStopped
	}
	bc := prl.BlockChain()
	signer := types.LatestSignerForChainID(bc.Config().ChainID)

	tx, blockHash, number, index := findTx(bc, prl.ChainDb(), h, block, index)
	if tx == nil {
		tx = prl.TxPool().Get(h)
		if tx == nil {
			return TxDetails{}, fmt.Errorf("transaction %s is not known to the node", hash)
		}
		d := txDetails(tx, signer)
		d.Status = "pending"
		d.FeeWei = new(big.Int).Mul(tx.GasPrice(), new(big.Int).SetUint64(tx.Gas())).String()
		return d, nil
	}

	d := txDetails(tx, signer)
	d.Block = number
	d.BlockHash = blockHash.Hex()
	d.Index = index
	if header := bc.GetHeaderByHash(blockHash); header != nil {
		d.Timestamp = int64(header.Time)
	}
	d.Status = "success"
	if receipts := bc.GetReceiptsByHash(blockHash); index < uint64(len(receipts)) {
		r := receipts[index]
		if r.Status == types.ReceiptStatusFailed {
			d.Status = "failed"
		}
		d.GasUsed = r.GasUsed
		d.Logs = len(r.Logs)
		if r.ContractAddress != (util.Address{}) {
			d.ContractAddress = r.ContractAddress.Hex()
		}
	}
	d.FeeWei = new(big.Int).Mul(tx.GasPrice(), new(big.Int).SetUint64(d.GasUsed)).String()
	return d, nil
}

// findTx finds the canonical transaction h: at block's position index if
// it's there, by the node's transaction index otherwise. tx is nil when
// neither has it.
func findTx(bc *validation.BlockChain, db dbstore.Reader, h util.Hash, block, index uint64) (tx *types.Transaction, blockHash util.Hash, number, at uint64) {
	if block > 0 {
		if b := bc.GetBlockByNumber(block); b != nil {
			if txs := b.Transactions(); index < uint64(len(txs)) && txs[index].Hash() == h {
				return txs[index], b.Hash(), block, index
			}
		}
	}
	return rawdb.ReadTransaction(db, h)
}

// txDetails fills in what the transaction itself carries.
func txDetails(tx *types.Transaction, signer types.Signer) TxDetails {
	d := TxDetails{
		Hash:        tx.Hash().Hex(),
		ValueWei:    tx.Value().String(),
		Nonce:       tx.Nonce(),
		GasLimit:    tx.Gas(),
		GasPriceWei: tx.GasPrice().String(),
		Input:       hexutil.Encode(tx.Data()),
		SizeBytes:   uint64(tx.Size()),
	}
	if from, err := types.Sender(signer, tx); err == nil {
		d.From = from.Hex()
	}
	if to := tx.To(); to != nil {
		d.To = to.Hex()
	}
	return d
}

// walletActivityMaxBlocks bounds one WalletActivity call: a caller that
// fell further behind (the app was asleep) hears of the latest blocks only.
const walletActivityMaxBlocks = 100

// WalletTx is a wallet account's transaction in a block, for the app to
// notify about: money received, or a send confirmed or failed.
type WalletTx struct {
	TxView
	Failed bool `json:"failed"`
}

// WalletActivity is one WalletActivitySince answer: the transactions, and
// the head they were read up to.
type WalletActivity struct {
	Transactions []WalletTx `json:"transactions"`
	Head         uint64     `json:"head"`
}

// WalletActivity lists the transactions from or to any of the wallet's
// accounts in the blocks after `after`, oldest first, and the head it read
// up to, for the next call.
func (w *Wallet) WalletActivity(after uint64) ([]WalletTx, uint64, error) {
	if err := w.requireOpen(); err != nil {
		return nil, 0, err
	}
	prl := w.node.Parallax()
	if prl == nil {
		return nil, 0, ErrNodeStopped
	}
	bc := prl.BlockChain()
	head := bc.CurrentBlock()
	if head == nil {
		return nil, 0, fmt.Errorf("chain head unavailable")
	}
	headNum := head.NumberU64()
	out := []WalletTx{}
	if after >= headNum {
		return out, headNum, nil
	}
	if headNum-after > walletActivityMaxBlocks {
		after = headNum - walletActivityMaxBlocks
	}

	mine := map[util.Address]bool{}
	for _, addr := range w.addresses() {
		mine[addr] = true
	}
	signer := types.LatestSignerForChainID(bc.Config().ChainID)
	for num := after + 1; num <= headNum; num++ {
		block := bc.GetBlockByNumber(num)
		if block == nil {
			continue
		}
		var receipts types.Receipts
		for i, tx := range block.Transactions() {
			from, err := types.Sender(signer, tx)
			to := tx.To()
			if !(err == nil && mine[from]) && !(to != nil && mine[*to]) {
				continue
			}
			if receipts == nil {
				receipts = bc.GetReceiptsByHash(block.Hash())
			}
			v := WalletTx{TxView: TxView{
				Hash:      tx.Hash().Hex(),
				Block:     num,
				Timestamp: int64(block.Time()),
				From:      from.Hex(),
				ValueWei:  tx.Value().String(),
				GasUsed:   tx.Gas(),
				Kind:      "call",
			}}
			switch {
			case to == nil:
				v.Kind = "contract"
			case len(tx.Data()) == 0:
				v.Kind = "transfer"
			}
			if to != nil {
				v.To = to.Hex()
			}
			if i < len(receipts) {
				v.Failed = receipts[i].Status == types.ReceiptStatusFailed
				v.GasUsed = receipts[i].GasUsed
			}
			out = append(out, v)
		}
	}
	return out, headNum, nil
}

// Balances reads every wallet account's balance at the chain head, by
// checksummed address, for the sidebar's account switcher. It is empty
// while the head state is unavailable (a snap sync still downloading it).
func (w *Wallet) Balances() (map[string]string, error) {
	if err := w.requireOpen(); err != nil {
		return nil, err
	}
	prl := w.node.Parallax()
	if prl == nil {
		return nil, ErrNodeStopped
	}
	out := map[string]string{}
	st, err := prl.BlockChain().State()
	if err != nil {
		return out, nil
	}
	for _, addr := range w.addresses() {
		out[addr.Hex()] = st.GetBalance(addr).String()
	}
	return out, nil
}
