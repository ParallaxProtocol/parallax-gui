package backend

import (
	"math/big"
	"strings"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

func TestListMempool(t *testing.T) {
	signer := types.LatestSignerForChainID(big.NewInt(2110))
	keyA, _ := crypto.GenerateKey()
	keyB, _ := crypto.GenerateKey()
	addrA := crypto.PubkeyToAddress(keyA.PublicKey)
	addrB := crypto.PubkeyToAddress(keyB.PublicKey)
	to := util.HexToAddress("0x00000000000000000000000000000000000000aa")

	tx := func(k any, nonce uint64, gwei int64, recipient *util.Address) *types.Transaction {
		key := keyA
		if k == "b" {
			key = keyB
		}
		return types.MustSignNewTx(key, signer, &types.LegacyTx{
			Nonce:    nonce,
			GasPrice: new(big.Int).Mul(big.NewInt(gwei), big.NewInt(1e9)),
			Gas:      21000,
			To:       recipient,
			Value:    big.NewInt(1),
		})
	}

	pending := map[util.Address]types.Transactions{
		addrA: {tx("a", 0, 2, &to), tx("a", 1, 2, &to)},
		addrB: {tx("b", 0, 10, nil)}, // a contract creation, paying the most
	}
	queued := map[util.Address]types.Transactions{
		addrA: {tx("a", 5, 50, &to)}, // pays most of all, but held back by a nonce gap
	}

	v := listMempool(pending, queued, "", 0)
	if v.Pending != 3 || v.Queued != 1 || v.Matched != 4 || len(v.Txs) != 4 {
		t.Fatalf("totals: pending %d queued %d matched %d listed %d", v.Pending, v.Queued, v.Matched, len(v.Txs))
	}
	// Pending first, best price first, a sender's own in nonce order; queued last
	got := []string{}
	for _, m := range v.Txs {
		got = append(got, m.From[:6]+"/"+big.NewInt(int64(m.Nonce)).String())
	}
	first := v.Txs[0]
	if first.From != strings.ToLower(addrB.Hex()) || first.To != "" {
		t.Errorf("want the creation from B first, got %+v", first)
	}
	if v.Txs[1].Nonce != 0 || v.Txs[2].Nonce != 1 || v.Txs[1].From != strings.ToLower(addrA.Hex()) {
		t.Errorf("want A's pending in nonce order next, got %v", got)
	}
	if last := v.Txs[3]; !last.Queued || last.Nonce != 5 {
		t.Errorf("want the queued tx last, got %+v", last)
	}

	// Search matches any part of a hash, sender or recipient, in any case
	if v := listMempool(pending, queued, strings.ToUpper(addrB.Hex()[2:12]), 0); v.Matched != 1 || v.Txs[0].From != strings.ToLower(addrB.Hex()) {
		t.Errorf("sender search: matched %d", v.Matched)
	}
	if v := listMempool(pending, queued, "00aa", 0); v.Matched != 3 {
		t.Errorf("recipient search: matched %d, want 3", v.Matched)
	}
	h := pending[addrA][1].Hash().Hex()
	if v := listMempool(pending, queued, h[10:30], 0); v.Matched != 1 || v.Txs[0].Hash != h {
		t.Errorf("hash search: matched %d", v.Matched)
	}
	// The details count the pool the same way, and size it
	if n, size := countPool(pending); n != 3 || size == 0 {
		t.Errorf("countPool: %d txs, %d bytes", n, size)
	}

	// The totals stay the pool's; only the listing is paged
	if v := listMempool(pending, queued, "", 2); v.Matched != 4 || len(v.Txs) != 2 || v.Pending != 3 {
		t.Errorf("limit: matched %d listed %d", v.Matched, len(v.Txs))
	}
}
