package backend

import (
	"encoding/hex"
	"errors"
	"math/big"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/kernel/xhash"
	"github.com/ParallaxProtocol/parallax/v2/node"
	protocol "github.com/ParallaxProtocol/parallax/v2/node/fullnode"
	"github.com/ParallaxProtocol/parallax/v2/node/nodeconfig"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/validation"
)

// TestWalletSendThroughNode quotes and sends a transfer from a wallet
// account through a real in-process node on a private chain, as the app
// does on mainnet, and checks the node's pool holds exactly what the user
// confirmed, signed by that account for that chain.
func TestWalletSendThroughNode(t *testing.T) {
	w, _ := newTestWallet(t)
	priv, _ := crypto.GenerateKey()
	from := crypto.PubkeyToAddress(priv.PublicKey)
	acc, err := w.ImportPrivateKey("", hex.EncodeToString(crypto.FromECDSA(priv)), testPassword)
	if err != nil {
		t.Fatal(err)
	}

	lax := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	genesis := &validation.Genesis{
		Config:   chainparams.AllXHashProtocolChanges,
		Alloc:    validation.GenesisAlloc{from: {Balance: new(big.Int).Mul(big.NewInt(10), lax)}},
		GasLimit: 8_000_000,
		BaseFee:  big.NewInt(chainparams.InitialBaseFee),
	}
	stack, err := node.New(&node.Config{DataDir: t.TempDir(), P2P: node.DefaultConfig.P2P})
	if err != nil {
		t.Fatal(err)
	}
	defer stack.Close()
	stack.Config().P2P.NoDiscovery = true
	stack.Config().P2P.ListenAddr = "127.0.0.1:0"
	cfg := nodeconfig.Defaults
	cfg.Genesis = genesis
	cfg.XHash.PowMode = xhash.ModeFake
	prl, err := protocol.New(stack, &cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := stack.Start(); err != nil {
		t.Fatal(err)
	}
	w.node = &NodeController{cfg: &ConfigStore{cfg: defaultGUIConfig()}, stack: stack, parallax: prl}
	w.ready = func() error { return nil } // a private chain has no peers

	to := util.HexToAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")
	value := new(big.Int).Div(lax, big.NewInt(4)) // 0.25 LAX

	q, err := w.Quote(acc.Address, to.Hex(), value.String(), "")
	if err != nil {
		t.Fatalf("Quote: %v", err)
	}
	price, _ := new(big.Int).SetString(q.GasPriceWei, 10)
	if q.GasLimit != chainparams.TxGas || q.ToContract || q.ToSelf || !q.Sufficient || price.Sign() <= 0 {
		t.Fatalf("Quote = %+v", q)
	}
	wantFee := new(big.Int).Mul(price, big.NewInt(int64(chainparams.TxGas)))
	if q.FeeWei != wantFee.String() || q.ChainID != genesis.Config.ChainID.Uint64() {
		t.Fatalf("Quote fee %s chain %d, want %s and %v", q.FeeWei, q.ChainID, wantFee, genesis.Config.ChainID)
	}

	req := SendRequest{From: q.From, To: q.To, ValueWei: q.ValueWei, GasPriceWei: q.GasPriceWei, GasLimit: q.GasLimit}
	req.Password = "wrong password"
	if _, err := w.Send(req); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("Send(wrong password) = %v", err)
	}
	over := req
	over.Password = testPassword
	over.ValueWei = new(big.Int).Mul(big.NewInt(11), lax).String()
	if _, err := w.Send(over); !errors.Is(err, ErrInsufficientFee) {
		t.Fatalf("Send(more than the balance) = %v", err)
	}
	if prl.TxPool().Nonce(from) != 0 {
		t.Fatal("a refused send reached the pool")
	}

	req.Password = testPassword
	sent, err := w.Send(req)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	tx := prl.TxPool().Get(util.HexToHash(sent.Hash))
	if tx == nil {
		t.Fatal("the sent transaction is not in the pool")
	}
	sender, err := types.Sender(types.LatestSignerForChainID(genesis.Config.ChainID), tx)
	if err != nil || sender != from {
		t.Fatalf("pool transaction from %v (%v), want %v", sender, err, from)
	}
	if *tx.To() != to || tx.Value().Cmp(value) != 0 || tx.GasPrice().Cmp(price) != 0 || tx.Gas() != q.GasLimit || tx.Nonce() != 0 || len(tx.Data()) != 0 {
		t.Fatal("the pool's transaction differs from the one confirmed")
	}
	if !tx.Protected() || tx.ChainId().Cmp(genesis.Config.ChainID) != 0 {
		t.Fatal("the transaction is not replay-protected for the chain")
	}

	// The next send takes the next nonce, and the account's summary shows
	// both as waiting
	second, err := w.Send(req)
	if err != nil || second.Nonce != 1 {
		t.Fatalf("second Send = %+v, %v; want nonce 1", second, err)
	}
	view, err := w.Summary(acc.Address)
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if len(view.Pending) != 2 {
		t.Fatalf("Summary lists %d pending, want 2", len(view.Pending))
	}

	// A custom fee may only pay more than the node suggests
	if _, err := w.Quote(acc.Address, to.Hex(), value.String(), new(big.Int).Sub(price, big.NewInt(1)).String()); !errors.Is(err, ErrFeeTooLow) {
		t.Fatalf("Quote(below the suggestion) = %v, want ErrFeeTooLow", err)
	}
	dear, err := w.Quote(acc.Address, to.Hex(), value.String(), new(big.Int).Mul(price, big.NewInt(2)).String())
	if err != nil || dear.SuggestedPriceWei != q.GasPriceWei {
		t.Fatalf("Quote(above the suggestion) = %+v, %v", dear, err)
	}
	// And a send below the pool's floor never reaches it
	prl.TxPool().SetGasPrice(new(big.Int).Mul(price, big.NewInt(3)))
	if _, err := w.Send(req); !errors.Is(err, ErrFeeTooLow) {
		t.Fatalf("Send(below the pool's floor) = %v, want ErrFeeTooLow", err)
	}
}
