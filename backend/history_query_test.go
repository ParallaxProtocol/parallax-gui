// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"encoding/csv"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

// noPool is a transaction pool with nothing waiting.
type noPool struct{}

func (noPool) Get(util.Hash) *types.Transaction { return nil }

// filtered is the part of items keep lets by.
func filtered(items []HistoryTx, keep func(HistoryTx) bool) []HistoryTx {
	out := []HistoryTx{}
	for _, it := range items {
		if keep(it) {
			out = append(out, it)
		}
	}
	return out
}

func newIndexedChain(t *testing.T, blocks int) (*historyChain, *historyIndex) {
	t.Helper()
	c := newHistoryChain(t)
	c.extend(c.bc.Genesis(), blocks, 0)
	idx := openTestHistory(t, c, t.TempDir())
	t.Cleanup(idx.Close)
	catchUp(t, idx)
	return c, idx
}

// TestHistoryFilters reads each filter's history, from the index and from
// the chain's newest blocks, against the whole history filtered.
func TestHistoryFilters(t *testing.T) {
	c, idx := newIndexedChain(t, 40)
	// The newest few read from the chain, not yet indexed
	c.extend(c.bc.CurrentBlock(), 6, 0)
	is := func(a util.Address) func(string) bool {
		return func(s string) bool { return s != "" && util.HexToAddress(s) == a }
	}
	for _, addr := range []util.Address{c.a, c.b, c.miner, c.failing} {
		all := c.expected(addr)
		me := is(addr)
		cases := map[string]func(HistoryTx) bool{
			"in":     func(it HistoryTx) bool { return it.Kind != "mined" && me(it.To) && !me(it.From) },
			"out":    func(it HistoryTx) bool { return me(it.From) },
			"mined":  func(it HistoryTx) bool { return it.Kind == "mined" },
			"failed": func(it HistoryTx) bool { return it.Failed },
		}
		for filter, keep := range cases {
			want := filtered(all, keep)
			for _, limit := range []int{1, 4, 100} {
				got, last := readQuery(t, c.bc, idx, histQuery{addr: addr, filter: filter}, limit)
				if !reflect.DeepEqual(got, want) || !last.Complete {
					t.Errorf("%s %s (pages of %d): %d items, want %d", addr.Hex(), filter, limit, len(got), len(want))
				}
			}
		}
	}
	// Each filter has something to show for A, or the test shows nothing
	for _, f := range []string{"in", "out", "mined", "failed"} {
		if got, _ := readQuery(t, c.bc, idx, histQuery{addr: c.a, filter: f}, 100); len(got) == 0 {
			t.Errorf("A has nothing %s", f)
		}
	}
}

// TestHistoryWith reads the transactions between two addresses, and an
// account's to itself, against the whole history.
func TestHistoryWith(t *testing.T) {
	c, idx := newIndexedChain(t, 40)
	c.extend(c.bc.CurrentBlock(), 5, 0)
	between := func(a, b util.Address) func(HistoryTx) bool {
		return func(it HistoryTx) bool {
			if it.Kind == "mined" || it.From == "" || it.To == "" {
				return false
			}
			f, to := util.HexToAddress(it.From), util.HexToAddress(it.To)
			return (f == a && to == b) || (f == b && to == a)
		}
	}
	for _, pair := range [][2]util.Address{{c.a, c.b}, {c.b, c.a}, {c.a, c.a}, {c.a, c.failing}, {c.a, c.miner}} {
		addr, with := pair[0], pair[1]
		want := filtered(c.expected(addr), between(addr, with))
		for _, limit := range []int{1, 3, 100} {
			got, _ := readQuery(t, c.bc, idx, histQuery{addr: addr, with: &with}, limit)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s with %s (pages of %d): %d items, want %d", addr.Hex(), with.Hex(), limit, len(got), len(want))
			}
		}
		// With a filter as well
		out := filtered(want, func(it HistoryTx) bool { return util.HexToAddress(it.From) == addr })
		if got, _ := readQuery(t, c.bc, idx, histQuery{addr: addr, with: &with, filter: "out"}, 2); !reflect.DeepEqual(got, out) {
			t.Errorf("%s sent to %s: %d items, want %d", addr.Hex(), with.Hex(), len(got), len(out))
		}
	}
	if got, _ := readQuery(t, c.bc, idx, histQuery{addr: c.a, with: &c.b}, 100); len(got) == 0 {
		t.Fatal("nothing between A and B")
	}
}

// TestHistoryScanBudget goes on from where a read's budget ran out: the
// pages may come short, but together they're the whole history.
func TestHistoryScanBudget(t *testing.T) {
	c, idx := newIndexedChain(t, 40)
	saved := historyScanBudget
	historyScanBudget = 3
	t.Cleanup(func() { historyScanBudget = saved })
	for _, q := range []histQuery{{addr: c.a}, {addr: c.a, filter: "failed"}, {addr: c.a, with: &c.b}, {addr: c.miner, filter: "mined"}} {
		hq := q
		hq.before = nil
		want, _ := func() ([]HistoryTx, HistoryPage) {
			historyScanBudget = 1 << 30
			defer func() { historyScanBudget = 3 }()
			return readQuery(t, c.bc, idx, hq, 100)
		}()
		got, _ := readQuery(t, c.bc, idx, hq, 5)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%+v under a budget: %d items, want %d", q.filter, len(got), len(want))
		}
	}
}

// TestHistoryAtBlock starts the history at a block, and a cursor at the
// block's reward goes on to its transactions.
func TestHistoryAtBlock(t *testing.T) {
	c, idx := newIndexedChain(t, 30)
	q, err := parseHistQuery(HistoryQuery{Address: c.a.Hex(), AtBlock: 17})
	if err != nil {
		t.Fatal(err)
	}
	want := filtered(c.expected(c.a), func(it HistoryTx) bool { return it.Block <= 17 })
	if got, _ := readQuery(t, c.bc, idx, q, 4); !reflect.DeepEqual(got, want) {
		t.Fatalf("from block 17: %d items, want %d", len(got), len(want))
	}
	// A cursor at a mined entry starts there
	all := c.expected(c.a)
	for i, it := range all {
		if it.Kind != "mined" {
			continue
		}
		r := fromRef(it.Block, posMined)
		got, _ := readQuery(t, c.bc, idx, histQuery{addr: c.a, before: &r}, 100)
		if !reflect.DeepEqual(got, all[i:]) {
			t.Fatalf("from block %d's reward: %d items, want %d", it.Block, len(got), len(all[i:]))
		}
		break
	}
}

// TestHistoryFindTx finds a transaction by hash, and starts a page at it;
// one of another account's isn't found.
func TestHistoryFindTx(t *testing.T) {
	c, idx := newIndexedChain(t, 20)
	all := c.expected(c.a)
	var target HistoryTx
	for _, it := range all {
		if it.Hash != "" {
			target = it
		}
	}
	found, err := findHistoryTx(c.bc, c.db, noPool{}, c.a, target.Hash)
	if err != nil || !found.Found || found.Pending || !reflect.DeepEqual(found.Item, target) {
		t.Fatalf("find %s: %+v, %v", target.Hash, found, err)
	}
	before, err := parseHistCursor(found.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	page, _ := readHistory(c.bc, idx, histQuery{addr: c.a, before: before}, 1)
	if len(page.Transactions) != 1 || page.Transactions[0].Hash != target.Hash {
		t.Fatalf("the page from it starts with %+v", page.Transactions)
	}
	if found, _ := findHistoryTx(c.bc, c.db, noPool{}, c.miner, target.Hash); found.Found {
		t.Fatal("found among an account it isn't of")
	}
	if found, _ := findHistoryTx(c.bc, c.db, noPool{}, c.a, "0x"+string(make([]byte, 0))+"00000000000000000000000000000000000000000000000000000000000000aa"); found.Found {
		t.Fatal("found a transaction there isn't")
	}
	if _, err := findHistoryTx(c.bc, c.db, noPool{}, c.a, "0x1234"); !errors.Is(err, errHistoryHash) {
		t.Fatalf("a short hash: %v", err)
	}
}

// TestHistoryBlockAt finds the newest block at or before a time.
func TestHistoryBlockAt(t *testing.T) {
	c, _ := newIndexedChain(t, 25)
	for _, num := range []uint64{1, 2, 13, 24, 25} {
		at := int64(c.bc.GetHeaderByNumber(num).Time)
		if got := blockAt(c.bc, at); got != num {
			t.Errorf("at block %d's time: %d", num, got)
		}
		if got := blockAt(c.bc, at-1); got != num-1 {
			t.Errorf("just before block %d: %d", num, got)
		}
	}
	if got := blockAt(c.bc, 1<<40); got != 25 {
		t.Errorf("in the future: %d", got)
	}
	if got := blockAt(c.bc, 0); got != 0 {
		t.Errorf("before the chain: %d", got)
	}
}

// TestHistoryExport writes an account's history as CSV: a row per item,
// with what it did to the balance, and nothing at all for a history
// still being indexed.
func TestHistoryExport(t *testing.T) {
	c, idx := newIndexedChain(t, 30)
	dir := t.TempDir()
	path := filepath.Join(dir, "history.csv")
	names := map[string]string{c.b.Hex(): "=Bob"}
	var seen uint64
	rows, err := exportHistory(c.bc, idx, histQuery{addr: c.a}, path, names, func(done, total uint64) { seen = done })
	if err != nil {
		t.Fatal(err)
	}
	all := c.expected(c.a)
	if rows != len(all) || seen != c.bc.CurrentBlock().NumberU64() {
		t.Fatalf("%d rows (progress %d), want %d", rows, seen, len(all))
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if info, _ := f.Stat(); info.Mode().Perm() != 0o600 {
		t.Errorf("the export is %v, want private", info.Mode().Perm())
	}
	recs, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != len(all)+1 || recs[0][0] != "Date (UTC)" {
		t.Fatalf("%d records, header %v", len(recs), recs[0])
	}
	var named, failed bool
	for i, it := range all {
		r := recs[i+1]
		if r[10] != it.Hash || r[11] != it.BlockHash {
			t.Fatalf("row %d is %v, item %+v", i, r, it)
		}
		if r[6] == "'=Bob" {
			named = true
		} else if r[6] != "" {
			t.Errorf("row %d names %q", i, r[6])
		}
		if it.Failed && util.HexToAddress(it.From) == c.a {
			failed = true
			fee, _ := new(big.Int).SetString(it.FeeWei, 10)
			if r[3] != "Failed" || r[9] != formatLaxExact(new(big.Int).Neg(fee)) {
				t.Errorf("failed send's row %v", r)
			}
		}
	}
	if !named || !failed {
		t.Fatalf("named %v failed %v", named, failed)
	}

	// Only a .csv, at an absolute path
	if _, err := exportHistory(c.bc, idx, histQuery{addr: c.a}, "history.csv", nil, nil); !errors.Is(err, errHistoryPath) {
		t.Errorf("relative path: %v", err)
	}
	if _, err := exportHistory(c.bc, idx, histQuery{addr: c.a}, filepath.Join(dir, "h.txt"), nil, nil); !errors.Is(err, errHistoryPath) {
		t.Errorf("not a .csv: %v", err)
	}
	// Not while the index is behind
	if _, err := exportHistory(c.bc, nil, histQuery{addr: c.a}, filepath.Join(dir, "x.csv"), nil, nil); !errors.Is(err, ErrHistoryPartial) {
		t.Errorf("without an index: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "x.csv")); !os.IsNotExist(err) {
		t.Error("a refused export left a file")
	}
	leftovers, _ := filepath.Glob(filepath.Join(dir, ".parallax-history-*"))
	if len(leftovers) != 0 {
		t.Errorf("temporary files left: %v", leftovers)
	}
}

// TestHistoryQueryParse refuses what isn't a query.
func TestHistoryQueryParse(t *testing.T) {
	a := "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
	for _, bad := range []HistoryQuery{
		{Address: "nope"},
		{Address: a, Filter: "sent"},
		{Address: a, With: "0x12"},
		{Address: a, Cursor: "x"},
	} {
		if _, err := parseHistQuery(bad); err == nil {
			t.Errorf("%+v accepted", bad)
		}
	}
	q, err := parseHistQuery(HistoryQuery{Address: a, Filter: "all", AtBlock: 9, Cursor: "5.2"})
	if err != nil || q.filter != "" || q.before.num != 5 || q.before.pos != 2 {
		t.Fatalf("a cursor goes before a block: %+v, %v", q, err)
	}
}

func TestFormatLaxExact(t *testing.T) {
	for wei, want := range map[string]string{
		"0":                    "0",
		"1":                    "0.000000000000000001",
		"1250000000000000000":  "1.25",
		"-1250000000000000000": "-1.25",
		"50000000000000000000": "50",
	} {
		if got := formatLaxExact(decimalWei(wei)); got != want {
			t.Errorf("%s wei = %s, want %s", wei, got, want)
		}
	}
}
