package backend

import (
	"encoding/hex"
	"errors"
	"math/big"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/validation"
)

// TestWalletReplaceThroughNode speeds up a waiting send and then cancels
// it, through a real in-process node, and checks the pool holds one
// transaction at the nonce each time, as confirmed.
func TestWalletReplaceThroughNode(t *testing.T) {
	w, _ := newTestWallet(t)
	priv, _ := crypto.GenerateKey()
	from := crypto.PubkeyToAddress(priv.PublicKey)
	acc, err := w.ImportPrivateKey("", hex.EncodeToString(crypto.FromECDSA(priv)), testPassword)
	if err != nil {
		t.Fatal(err)
	}
	lax := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	prl, _ := startTestNode(t, w, validation.GenesisAlloc{from: {Balance: new(big.Int).Mul(big.NewInt(10), lax)}})

	to := util.HexToAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")
	value := new(big.Int).Div(lax, big.NewInt(4))
	q, err := w.Quote(acc.Address, to.Hex(), value.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	sent, err := w.Send(SendRequest{From: q.From, To: q.To, ValueWei: q.ValueWei, GasPriceWei: q.GasPriceWei, GasLimit: q.GasLimit, Password: testPassword})
	if err != nil {
		t.Fatal(err)
	}
	oldPrice, _ := new(big.Int).SetString(q.GasPriceWei, 10)

	// Speed up: the same transfer at no less than the pool's bump
	sq, err := w.QuoteReplace(acc.Address, sent.Hash, ReplaceSpeedUp)
	if err != nil {
		t.Fatalf("QuoteReplace(speedUp): %v", err)
	}
	price, _ := new(big.Int).SetString(sq.GasPriceWei, 10)
	if price.Cmp(bumpedPrice(oldPrice, priceBumpPercent)) < 0 || sq.Nonce != 0 || sq.To != to.Hex() || sq.ValueWei != value.String() || !sq.Sufficient {
		t.Fatalf("QuoteReplace(speedUp) = %+v", sq)
	}
	under := ReplaceRequest{From: acc.Address, Hash: sent.Hash, Kind: ReplaceSpeedUp, GasPriceWei: oldPrice.String(), Password: testPassword}
	if _, err := w.Replace(under); !errors.Is(err, ErrFeeTooLow) {
		t.Fatalf("Replace(at the old price) = %v, want ErrFeeTooLow", err)
	}
	fast, err := w.Replace(ReplaceRequest{From: acc.Address, Hash: sent.Hash, Kind: ReplaceSpeedUp, GasPriceWei: sq.GasPriceWei, Password: testPassword})
	if err != nil {
		t.Fatalf("Replace(speedUp): %v", err)
	}
	if prl.TxPool().Has(util.HexToHash(sent.Hash)) {
		t.Fatal("the sped-up transaction is still in the pool")
	}
	tx := prl.TxPool().Get(util.HexToHash(fast.Hash))
	if tx == nil || tx.Nonce() != 0 || *tx.To() != to || tx.Value().Cmp(value) != 0 || tx.GasPrice().Cmp(price) != 0 {
		t.Fatalf("pool holds %v after the speed-up", tx)
	}
	// The replaced one can't be replaced again
	if _, err := w.QuoteReplace(acc.Address, sent.Hash, ReplaceCancel); !errors.Is(err, ErrTxNotWaiting) {
		t.Fatalf("QuoteReplace(replaced) = %v, want ErrTxNotWaiting", err)
	}

	// Cancel: nothing to the account itself, at the same nonce
	cq, err := w.QuoteReplace(acc.Address, fast.Hash, ReplaceCancel)
	if err != nil {
		t.Fatalf("QuoteReplace(cancel): %v", err)
	}
	if cq.To != from.Hex() || cq.ValueWei != "0" || cq.GasLimit != chainparams.TxGas {
		t.Fatalf("QuoteReplace(cancel) = %+v", cq)
	}
	if _, err := w.Replace(ReplaceRequest{From: acc.Address, Hash: fast.Hash, Kind: ReplaceCancel, GasPriceWei: cq.GasPriceWei, Password: "wrong password"}); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Replace(wrong password) = %v", err)
	}
	cancelled, err := w.Replace(ReplaceRequest{From: acc.Address, Hash: fast.Hash, Kind: ReplaceCancel, GasPriceWei: cq.GasPriceWei, Password: testPassword})
	if err != nil {
		t.Fatalf("Replace(cancel): %v", err)
	}
	tx = prl.TxPool().Get(util.HexToHash(cancelled.Hash))
	if tx == nil || tx.Nonce() != 0 || *tx.To() != from || tx.Value().Sign() != 0 || prl.TxPool().Has(util.HexToHash(fast.Hash)) {
		t.Fatalf("pool holds %v after the cancel", tx)
	}
	if pending, queued := prl.TxPool().Stats(); pending+queued != 1 {
		t.Fatalf("pool holds %d transactions, want 1", pending+queued)
	}

	// Another account's transaction is not this one's to replace
	other, err := w.Create("", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.QuoteReplace(other.Address, cancelled.Hash, ReplaceSpeedUp); !errors.Is(err, ErrNotYourTx) {
		t.Fatalf("QuoteReplace(another account's) = %v, want ErrNotYourTx", err)
	}
}
