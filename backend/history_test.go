// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"crypto/ecdsa"
	"errors"
	"fmt"
	"math/big"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/dbstore"
	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/kernel/xhash"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/script"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/validation"
	"github.com/ParallaxProtocol/parallax/v2/validation/rawdb"
)

// historyChain is a private chain for the history index's tests: two
// funded keys sending each other LAX, to themselves, and to a contract
// that always fails, with blocks mined by either or by a third address.
type historyChain struct {
	t       *testing.T
	genesis *validation.Genesis
	db      dbstore.Database
	bc      *validation.BlockChain
	keyA    *ecdsa.PrivateKey
	keyB    *ecdsa.PrivateKey
	a, b    util.Address
	miner   util.Address
	failing util.Address
}

func newHistoryChain(t *testing.T) *historyChain {
	t.Helper()
	keyA, _ := crypto.GenerateKey()
	keyB, _ := crypto.GenerateKey()
	c := &historyChain{
		t:       t,
		keyA:    keyA,
		keyB:    keyB,
		a:       crypto.PubkeyToAddress(keyA.PublicKey),
		b:       crypto.PubkeyToAddress(keyB.PublicKey),
		miner:   util.HexToAddress("0x00000000000000000000000000000000000000aa"),
		failing: util.HexToAddress("0x00000000000000000000000000000000000000fe"),
	}
	lax := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	c.genesis = &validation.Genesis{
		Config:   chainparams.AllXHashProtocolChanges,
		GasLimit: 8_000_000,
		BaseFee:  big.NewInt(chainparams.InitialBaseFee),
		Alloc: validation.GenesisAlloc{
			c.a: {Balance: new(big.Int).Mul(big.NewInt(1000), lax)},
			c.b: {Balance: new(big.Int).Mul(big.NewInt(1000), lax)},
			// INVALID: every call to it fails
			c.failing: {Balance: new(big.Int), Code: []byte{0xfe}},
		},
	}
	c.db = rawdb.NewMemoryDatabase()
	c.genesis.MustCommit(c.db)
	bc, err := validation.NewBlockChain(c.db, nil, c.genesis.Config, xhash.NewFaker(), script.Config{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(bc.Stop)
	c.bc = bc
	return c
}

// extend makes n blocks on parent, seed varying what's in them so a fork
// differs from the chain it leaves, and inserts them.
func (c *historyChain) extend(parent *types.Block, n int, seed int64) []*types.Block {
	c.t.Helper()
	gendb := rawdb.NewMemoryDatabase()
	c.genesis.MustCommit(gendb)
	// GenerateChain needs parent's state: make the blocks before it again
	var prefix []*types.Block
	if parent.NumberU64() > 0 {
		for num := uint64(1); num <= parent.NumberU64(); num++ {
			prefix = append(prefix, c.bc.GetBlockByNumber(num))
		}
	}
	blocks, _ := validation.GenerateChain(c.genesis.Config, c.bc.Genesis(), xhash.NewFaker(), gendb, len(prefix)+n, func(i int, g *validation.BlockGen) {
		if i < len(prefix) {
			old := prefix[i]
			g.SetCoinbase(old.Coinbase())
			g.SetExtra(old.Extra())
			for _, tx := range old.Transactions() {
				g.AddTx(tx)
			}
			return
		}
		k := int64(i) + seed
		signer := types.MakeSigner(c.genesis.Config, g.Number())
		price := new(big.Int).Mul(g.BaseFee(), big.NewInt(2))
		send := func(key *ecdsa.PrivateKey, to util.Address, value int64, gas uint64) {
			from := crypto.PubkeyToAddress(key.PublicKey)
			tx, err := types.SignTx(types.NewTransaction(g.TxNonce(from), to, big.NewInt(value), gas, price, nil), signer, key)
			if err != nil {
				c.t.Fatal(err)
			}
			g.AddTx(tx)
		}
		g.SetExtra([]byte(fmt.Sprintf("seed %d", seed)))
		switch k % 3 {
		case 0:
			g.SetCoinbase(c.a)
		case 1:
			g.SetCoinbase(c.miner)
		default:
			g.SetCoinbase(c.b)
		}
		switch k % 5 {
		case 0:
			send(c.keyA, c.b, 1000+k, chainparams.TxGas)
		case 1:
			send(c.keyB, c.a, 2000+k, chainparams.TxGas)
			send(c.keyA, c.a, 0, chainparams.TxGas) // to itself
		case 2:
			send(c.keyA, c.failing, 0, 50_000)
		case 3:
			send(c.keyA, c.b, 1, chainparams.TxGas)
			send(c.keyB, c.a, 2, chainparams.TxGas)
			send(c.keyA, c.b, 3, chainparams.TxGas)
		}
	})
	for i, old := range prefix {
		if blocks[i].Hash() != old.Hash() {
			c.t.Fatalf("block %d made again differs", old.NumberU64())
		}
	}
	blocks = blocks[len(prefix):]
	if _, err := c.bc.InsertChain(blocks); err != nil {
		c.t.Fatalf("insert: %v", err)
	}
	return blocks
}

// expected is addr's history as a walk of the whole canonical chain has it.
func (c *historyChain) expected(addr util.Address) []HistoryTx {
	out := []HistoryTx{}
	for num := c.bc.CurrentBlock().NumberU64(); num >= 1; num-- {
		block := c.bc.GetBlockByNumber(num)
		var refs []histRef
		for _, e := range blockEntries(block, types.MakeSigner(c.genesis.Config, block.Number()), c.bc.GetReceiptsByHash(block.Hash())) {
			if e.addr == addr {
				refs = append(refs, histRef{num: num, pos: e.pos})
			}
		}
		sortRefs(refs)
		for _, r := range refs {
			item, ok := historyItem(c.bc, block, r.pos, addr)
			if !ok {
				c.t.Fatalf("no item at %d.%d", r.num, r.pos)
			}
			out = append(out, item)
		}
	}
	return out
}

// catchUp steps idx until it has nothing more to do.
func catchUp(t *testing.T, idx *historyIndex) {
	t.Helper()
	for range 10_000 {
		more, err := idx.step()
		if err != nil {
			t.Fatal(err)
		}
		if !more {
			return
		}
	}
	t.Fatal("the index never caught up")
}

// readAll reads addr's whole history page by page.
func readAll(t *testing.T, bc *validation.BlockChain, idx *historyIndex, addr util.Address, limit int) (items []HistoryTx, last HistoryPage) {
	t.Helper()
	return readQuery(t, bc, idx, histQuery{addr: addr}, limit)
}

// readQuery reads all of what q asks for, page by page.
func readQuery(t *testing.T, bc *validation.BlockChain, idx *historyIndex, q histQuery, limit int) (items []HistoryTx, last HistoryPage) {
	t.Helper()
	items = []HistoryTx{}
	for pages := 0; ; pages++ {
		if pages > 10_000 {
			t.Fatal("the pages never end")
		}
		page, err := readHistory(bc, idx, q, limit)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Transactions) > limit {
			t.Fatalf("a page of %d holds %d", limit, len(page.Transactions))
		}
		items = append(items, page.Transactions...)
		if page.Next == "" {
			return items, page
		}
		if q.before, err = parseHistCursor(page.Next); err != nil {
			t.Fatal(err)
		}
	}
}

func (c *historyChain) check(idx *historyIndex, limit int) {
	c.t.Helper()
	for _, addr := range []util.Address{c.a, c.b, c.miner, c.failing} {
		got, last := readAll(c.t, c.bc, idx, addr, limit)
		want := c.expected(addr)
		if !last.Complete {
			c.t.Errorf("%s: the history isn't complete", addr.Hex())
		}
		if !reflect.DeepEqual(got, want) {
			c.t.Errorf("%s: history differs from the chain's\n got %d items: %+v\nwant %d items: %+v", addr.Hex(), len(got), got, len(want), want)
		}
	}
}

func openTestHistory(t *testing.T, c *historyChain, dir string) *historyIndex {
	t.Helper()
	idx, err := openHistoryIndex(dir, c.bc, c.db)
	if err != nil {
		t.Fatal(err)
	}
	return idx
}

// TestHistoryIndex builds the index over a chain and reads every
// address's history from it, in pages of several sizes, against a walk of
// the chain; then follows the chain as it grows.
func TestHistoryIndex(t *testing.T) {
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), 40, 0)
	idx := openTestHistory(t, c, t.TempDir())
	defer idx.Close()
	catchUp(t, idx)
	if tip := idx.Tip(); tip.num != 40 || tip.hash != c.bc.CurrentBlock().Hash() {
		t.Fatalf("tip %d %x, want the head", tip.num, tip.hash)
	}
	for _, limit := range []int{1, 3, 25, 100} {
		c.check(idx, limit)
	}

	// What the history says of a transaction and a mined block
	items, _ := readAll(t, c.bc, idx, c.a, 100)
	var failed, self, mined, received bool
	for _, it := range items {
		switch {
		case it.Kind == "mined":
			mined = true
			if it.Hash != "" || it.RewardWei != blockRewardAt(it.Block).String() || it.MaturesAt != it.Block || it.FeesWei == "" {
				t.Errorf("mined item %+v", it)
			}
			reward, _ := new(big.Int).SetString(it.RewardWei, 10)
			fees, _ := new(big.Int).SetString(it.FeesWei, 10)
			if new(big.Int).Add(reward, fees).String() != it.ValueWei {
				t.Errorf("mined value %s isn't its reward and fees", it.ValueWei)
			}
		case it.To == c.failing.Hex():
			failed = true
			if !it.Failed || it.GasUsed != 50_000 || it.Kind != "transfer" {
				t.Errorf("failed call %+v", it)
			}
		case it.From == it.To:
			self = true
		case it.To == c.a.Hex():
			received = true
			if it.Failed || it.GasUsed != chainparams.TxGas || it.FeeWei == "0" || it.FeeWei == "" {
				t.Errorf("received item %+v", it)
			}
		}
	}
	if !failed || !self || !mined || !received {
		t.Fatalf("history of A lacks an item: failed %v self %v mined %v received %v", failed, self, mined, received)
	}

	// New blocks are read from the chain until the index has them, then
	// from the index
	c.extend(c.bc.CurrentBlock(), 7, 0)
	c.check(idx, 4)
	catchUp(t, idx)
	if idx.Tip().num != 47 {
		t.Fatalf("tip %d, want 47", idx.Tip().num)
	}
	c.check(idx, 4)
}

// TestHistoryReorg follows the chain over a reorg within the undo
// records, and over one deeper, which builds the index again.
func TestHistoryReorg(t *testing.T) {
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), 30, 0)
	idx := openTestHistory(t, c, t.TempDir())
	defer idx.Close()
	catchUp(t, idx)

	// A heavier fork from block 22
	c.extend(c.bc.GetBlockByNumber(22), 12, 1)
	if c.bc.CurrentBlock().NumberU64() != 34 {
		t.Fatalf("head %d, want the fork's 34", c.bc.CurrentBlock().NumberU64())
	}
	catchUp(t, idx)
	if tip := idx.Tip(); tip.hash != c.bc.CurrentBlock().Hash() {
		t.Fatalf("tip %d isn't the fork's head", tip.num)
	}
	c.check(idx, 5)
	// Nothing of the old branch's is left in the index
	assertIndexMatchesChain(t, c, idx)

	// Deeper than the undo records reach
	historyUndoDepth = 4
	t.Cleanup(func() { historyUndoDepth = 4096 })
	c.extend(c.bc.GetBlockByNumber(10), 30, 2)
	catchUp(t, idx)
	if tip := idx.Tip(); tip.hash != c.bc.CurrentBlock().Hash() {
		t.Fatalf("tip %d isn't the new head", tip.num)
	}
	c.check(idx, 5)
	assertIndexMatchesChain(t, c, idx)
}

// TestHistoryRewind takes off the index the blocks above a head set back.
func TestHistoryRewind(t *testing.T) {
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), 20, 0)
	idx := openTestHistory(t, c, t.TempDir())
	defer idx.Close()
	catchUp(t, idx)
	if err := c.bc.SetHead(12); err != nil {
		t.Fatal(err)
	}
	catchUp(t, idx)
	if tip := idx.Tip(); tip.num != 12 || tip.hash != c.bc.CurrentBlock().Hash() {
		t.Fatalf("tip %d, want 12", tip.num)
	}
	c.check(idx, 3)
	assertIndexMatchesChain(t, c, idx)
}

// assertIndexMatchesChain checks every entry in the index is one of the
// canonical chain's, and every one of those is in it.
func assertIndexMatchesChain(t *testing.T, c *historyChain, idx *historyIndex) {
	t.Helper()
	want := map[string]byte{}
	for num := uint64(1); num <= idx.Tip().num; num++ {
		block := c.bc.GetBlockByNumber(num)
		for _, e := range blockEntries(block, types.MakeSigner(c.genesis.Config, block.Number()), c.bc.GetReceiptsByHash(block.Hash())) {
			want[string(histEntryKey(e.addr, num, e.pos))] = e.roles
		}
	}
	it := idx.db.NewIterator(histPrefixAddr, nil)
	defer it.Release()
	got := map[string]byte{}
	for it.Next() {
		got[string(it.Key())] = it.Value()[0]
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("index holds %d entries, the chain %d", len(got), len(want))
	}
}

// TestHistoryReopen keeps the index across a close, and builds it again
// for another chain.
func TestHistoryReopen(t *testing.T) {
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), 15, 0)
	dir := filepath.Join(t.TempDir(), historyDir)
	idx := openTestHistory(t, c, dir)
	idx.start()
	idx.Close()
	idx.Close() // twice is fine

	idx = openTestHistory(t, c, dir)
	catchUp(t, idx)
	if idx.Tip().num != 15 {
		t.Fatalf("tip %d after reopening, want 15", idx.Tip().num)
	}
	idx.Close()

	// Another chain, another genesis: built afresh
	other := newHistoryChain(t)
	other.extend(other.bc.Genesis(), 5, 0)
	idx = openTestHistory(t, other, dir)
	defer idx.Close()
	if tip := idx.Tip(); tip.num != 0 || tip.hash != other.bc.Genesis().Hash() {
		t.Fatalf("tip %d on another chain, want its genesis", tip.num)
	}
	catchUp(t, idx)
	other.check(idx, 2)
}

// TestHistoryWithoutIndex reads the newest blocks from the chain when
// there's no index, or while one is built from scratch, and says the
// history isn't complete.
func TestHistoryWithoutIndex(t *testing.T) {
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), 12, 0)
	got, last := readAll(t, c.bc, nil, c.a, 4)
	if !reflect.DeepEqual(got, c.expected(c.a)) {
		t.Fatalf("without an index: %d items, want %d", len(got), len(c.expected(c.a)))
	}
	if last.Complete || last.Indexing {
		t.Fatal("a history without an index says it's complete, or being indexed")
	}

	// An index behind by more than a query reads of the chain
	idx := openTestHistory(t, c, t.TempDir())
	defer idx.Close()
	saved := historyLiveBlocks
	historyLiveBlocks = 5
	t.Cleanup(func() { historyLiveBlocks = saved })
	page, err := readHistory(c.bc, idx, histQuery{addr: c.a}, 100)
	if err != nil {
		t.Fatal(err)
	}
	if page.Complete || !page.Indexing || page.Next != "" || page.IndexedTo != 0 {
		t.Fatalf("page of a history being built: %+v", page)
	}
	for _, it := range page.Transactions {
		if it.Block <= 12-5 {
			t.Fatalf("block %d is older than the blocks read", it.Block)
		}
	}
	catchUp(t, idx)
	c.check(idx, 4)
	if page, _ := readHistory(c.bc, idx, histQuery{addr: c.a}, 4); page.Indexing {
		t.Fatal("an index caught up says it's being built")
	}
}

// TestHistoryCursor reads cursors back, and refuses what isn't one.
func TestHistoryCursor(t *testing.T) {
	r, err := parseHistCursor(formatHistCursor(histRef{num: 123, pos: posMined}))
	if err != nil || r.num != 123 || r.pos != posMined {
		t.Fatalf("cursor read back as %+v, %v", r, err)
	}
	if r, err := parseHistCursor(""); r != nil || err != nil {
		t.Fatal("an empty cursor isn't the newest")
	}
	for _, bad := range []string{"12", "a.b", "1.-1", "1.4294967296", ".1", "1."} {
		if _, err := parseHistCursor(bad); err == nil {
			t.Errorf("cursor %q accepted", bad)
		}
	}
}

// TestHistoryFollows has the running index follow the head as blocks
// arrive, and stop when closed.
func TestHistoryFollows(t *testing.T) {
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), 10, 0)
	idx := openTestHistory(t, c, t.TempDir())
	idx.start()
	waitTip := func(num uint64) {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for idx.Tip().num != num {
			if time.Now().After(deadline) {
				t.Fatalf("tip %d, want %d", idx.Tip().num, num)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	waitTip(10)
	c.extend(c.bc.CurrentBlock(), 3, 0)
	waitTip(13)
	c.check(idx, 3)
	idx.Close()
	if _, err := idx.step(); !errors.Is(err, errHistoryClosed) {
		t.Fatalf("a closed index stepped: %v", err)
	}
}

// TestFindTxPastLookupIndex reads a transaction the node's transaction
// index no longer holds (it keeps TxLookupLimit blocks') where the history
// has it, and only there: a position holding another transaction falls
// back to the index.
func TestFindTxPastLookupIndex(t *testing.T) {
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), 5, 0)
	var (
		block *types.Block
		tx    *types.Transaction
		index uint64
	)
	for num := uint64(1); num <= 5 && tx == nil; num++ {
		if b := c.bc.GetBlockByNumber(num); len(b.Transactions()) > 1 {
			block, tx, index = b, b.Transactions()[1], 1
		}
	}
	if tx == nil {
		t.Fatal("no block with two transactions")
	}
	rawdb.DeleteTxLookupEntry(c.db, tx.Hash())
	if got, _, _, _ := rawdb.ReadTransaction(c.db, tx.Hash()); got != nil {
		t.Fatal("the lookup entry is still there")
	}

	got, hash, num, at := findTx(c.bc, c.db, tx.Hash(), block.NumberU64(), index)
	if got == nil || got.Hash() != tx.Hash() || hash != block.Hash() || num != block.NumberU64() || at != index {
		t.Fatalf("at its position: %v %x %d %d", got, hash, num, at)
	}
	if got, _, _, _ := findTx(c.bc, c.db, tx.Hash(), block.NumberU64(), 0); got != nil {
		t.Fatal("found at a position holding another transaction")
	}
	if got, _, _, _ := findTx(c.bc, c.db, tx.Hash(), 0, 0); got != nil {
		t.Fatal("found with no position and no lookup entry")
	}
	// One the index still has reads by it, whatever the position says
	other := block.Transactions()[0]
	if got, _, _, at := findTx(c.bc, c.db, other.Hash(), block.NumberU64(), 7); got == nil || at != 0 {
		t.Fatal("a transaction in the lookup index wasn't found by it")
	}
}
