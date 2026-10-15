// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/validation"
)

// Replacing a waiting transaction: the pool holds one transaction per
// account and nonce, and takes a second for the same nonce only when it
// pays at least --txpool.pricebump percent more. A speed-up resends the
// same transaction at a higher price; a cancel sends nothing to the
// account itself at that nonce, so the original can never be included.
// Whichever a miner takes first wins: a replacement can lose the race.

const (
	ReplaceSpeedUp = "speedUp"
	ReplaceCancel  = "cancel"
)

// Keep in step with WALLET_ERRORS in frontend/src/lib/api.ts.
var (
	ErrTxNotWaiting = errors.New("wallet: the transaction is no longer waiting: it is in a block or was replaced")
	ErrNotYourTx    = errors.New("wallet: the transaction is not sent from this account")
	ErrBadReplace   = errors.New("wallet: not a valid replacement")
)

// ReplaceQuote is what speeding up or cancelling a waiting transaction
// costs, for the user to confirm.
type ReplaceQuote struct {
	Kind        string `json:"kind"` // ReplaceSpeedUp or ReplaceCancel
	Hash        string `json:"hash"` // the transaction replaced
	From        string `json:"from"`
	To          string `json:"to"` // the replacement's recipient: the account itself for a cancel
	Nonce       uint64 `json:"nonce"`
	ValueWei    string `json:"valueWei"`
	GasLimit    uint64 `json:"gasLimit"`
	OldPriceWei string `json:"oldPriceWei"`
	GasPriceWei string `json:"gasPriceWei"` // the least the pool takes, or the node's suggestion if more
	OldFeeWei   string `json:"oldFeeWei"`   // the most the original could cost in fees
	FeeWei      string `json:"feeWei"`      // the most the replacement can cost in fees
	TotalWei    string `json:"totalWei"`    // value + fee
	BalanceWei  string `json:"balanceWei"`
	Sufficient  bool   `json:"sufficient"`
}

// ReplaceRequest is a replacement the user confirmed, with the account's
// password. The transaction is read again from the pool: only the price
// is taken from the frontend, and only at or above the least the pool takes.
type ReplaceRequest struct {
	From        string `json:"from"`
	Hash        string `json:"hash"`
	Kind        string `json:"kind"`
	GasPriceWei string `json:"gasPriceWei"`
	// Password is the wallet's, from the unlocked session (app.go), never
	// from the frontend
	Password string `json:"-"`
}

// bumpedPrice is the least a replacement of a transaction paying old must
// pay for a pool with the given bump to take it.
func bumpedPrice(old *big.Int, bumpPercent uint64) *big.Int {
	p := new(big.Int).Mul(old, new(big.Int).SetUint64(100+bumpPercent))
	return p.Div(p, big.NewInt(100)).Add(p, big.NewInt(1))
}

// priceBump is the node's --txpool.pricebump.
func (w *Wallet) priceBump() uint64 {
	if w.node != nil && w.node.cfg != nil {
		if b := w.node.cfg.Get().TxPoolPriceBump; b != nil && *b > 0 {
			return *b
		}
	}
	return priceBumpPercent
}

// waitingTx finds a transaction from one of the wallet's own accounts
// still waiting in the node's pool.
func (w *Wallet) waitingTx(from, hash string) (util.Address, *types.Transaction, error) {
	addr, watch, err := w.known(from)
	if err != nil {
		return util.Address{}, nil, err
	}
	if watch {
		return util.Address{}, nil, ErrWatchOnly
	}
	hash = strings.TrimSpace(hash)
	if len(hash) != 66 || !strings.HasPrefix(hash, "0x") {
		return util.Address{}, nil, ErrTxNotWaiting
	}
	prl := w.node.Parallax()
	if prl == nil {
		return util.Address{}, nil, ErrNodeStopped
	}
	tx := prl.TxPool().Get(util.HexToHash(hash))
	if tx == nil {
		return util.Address{}, nil, ErrTxNotWaiting
	}
	sender, err := types.Sender(types.LatestSignerForChainID(prl.BlockChain().Config().ChainID), tx)
	if err != nil || sender != addr {
		return util.Address{}, nil, ErrNotYourTx
	}
	return addr, tx, nil
}

// replacement is the transaction that replaces tx at price: the same one
// for a speed-up, nothing sent to the account itself for a cancel.
func replacement(kind string, from util.Address, tx *types.Transaction, price *big.Int) (*types.Transaction, error) {
	switch kind {
	case ReplaceSpeedUp:
		if tx.To() == nil {
			return types.NewContractCreation(tx.Nonce(), tx.Value(), tx.Gas(), price, tx.Data()), nil
		}
		return types.NewTransaction(tx.Nonce(), *tx.To(), tx.Value(), tx.Gas(), price, tx.Data()), nil
	case ReplaceCancel:
		return types.NewTransaction(tx.Nonce(), from, new(big.Int), chainparams.TxGas, price, nil), nil
	}
	return nil, ErrBadReplace
}

// QuoteReplace works out what speeding up or cancelling a waiting
// transaction from one of the wallet's accounts costs.
func (w *Wallet) QuoteReplace(from, hash, kind string) (ReplaceQuote, error) {
	addr, tx, err := w.waitingTx(from, hash)
	if err != nil {
		return ReplaceQuote{}, err
	}
	ec, _, err := w.readyNode()
	if err != nil {
		return ReplaceQuote{}, err
	}
	defer ec.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	price := bumpedPrice(tx.GasPrice(), w.priceBump())
	if suggested, err := ec.SuggestGasPrice(ctx); err == nil && suggested.Cmp(price) > 0 {
		price = suggested
	}
	next, err := replacement(kind, addr, tx, price)
	if err != nil {
		return ReplaceQuote{}, err
	}
	// The pool checks a replacement against the head's balance alone: what
	// the original would spend is not taken from it
	balance, err := ec.BalanceAt(ctx, addr, nil)
	if err != nil {
		return ReplaceQuote{}, err
	}
	fee := new(big.Int).Mul(price, new(big.Int).SetUint64(next.Gas()))
	total := new(big.Int).Add(next.Value(), fee)
	return ReplaceQuote{
		Kind:        kind,
		Hash:        tx.Hash().Hex(),
		From:        addr.Hex(),
		To:          next.To().Hex(),
		Nonce:       tx.Nonce(),
		ValueWei:    next.Value().String(),
		GasLimit:    next.Gas(),
		OldPriceWei: tx.GasPrice().String(),
		GasPriceWei: price.String(),
		OldFeeWei:   new(big.Int).Mul(tx.GasPrice(), new(big.Int).SetUint64(tx.Gas())).String(),
		FeeWei:      fee.String(),
		TotalWei:    total.String(),
		BalanceWei:  balance.String(),
		Sufficient:  balance.Cmp(total) >= 0,
	}, nil
}

// Replace signs the speed-up or cancel the user confirmed and hands it to
// the node, at the waiting transaction's nonce.
func (w *Wallet) Replace(req ReplaceRequest) (SentTx, error) {
	if len(req.Password) > maxPasswordLen {
		return SentTx{}, ErrWrongPassword
	}
	price, err := parseWei(req.GasPriceWei, ErrBadFee)
	if err != nil {
		return SentTx{}, ErrBadFee
	}
	acc, err := w.find(req.From)
	if err != nil {
		if _, watch, _ := w.known(req.From); watch {
			return SentTx{}, ErrWatchOnly
		}
		return SentTx{}, err
	}
	ec, chainID, err := w.readyNode()
	if err != nil {
		return SentTx{}, err
	}
	defer ec.Close()

	// One key at a time, and no send takes a nonce while this one is replaced
	w.keyMu.Lock()
	defer w.keyMu.Unlock()

	_, tx, err := w.waitingTx(req.From, req.Hash)
	if err != nil {
		return SentTx{}, err
	}
	if price.Cmp(bumpedPrice(tx.GasPrice(), w.priceBump())) < 0 {
		return SentTx{}, ErrFeeTooLow
	}
	next, err := replacement(req.Kind, acc.Address, tx, price)
	if err != nil {
		return SentTx{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	balance, err := ec.BalanceAt(ctx, acc.Address, nil)
	if err != nil {
		return SentTx{}, err
	}
	if balance.Cmp(next.Cost()) < 0 {
		return SentTx{}, ErrInsufficientFee
	}
	signed, err := w.sign(acc, req.Password, next, chainID)
	if err != nil {
		return SentTx{}, err
	}
	if err := ec.SendTransaction(ctx, signed); err != nil {
		// Mined, or replaced elsewhere, between the read above and now
		if strings.Contains(err.Error(), validation.ErrNonceTooLow.Error()) {
			return SentTx{}, ErrTxNotWaiting
		}
		return SentTx{}, fmt.Errorf("wallet: the node refused the transaction: %w", err)
	}
	logging.Info("Replaced a wallet transaction", "kind", req.Kind, "old", tx.Hash(), "hash", signed.Hash(), "from", acc.Address, "nonce", tx.Nonce())
	return SentTx{Hash: signed.Hash().Hex(), Nonce: tx.Nonce()}, nil
}
