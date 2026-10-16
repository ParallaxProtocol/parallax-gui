// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/dbstore"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/util/hexutil"
	"github.com/ParallaxProtocol/parallax/v2/validation"
	"github.com/ParallaxProtocol/parallax/v2/validation/rawdb"
)

const (
	// historyPageSize is how many items a page of history holds
	historyPageSize = 25
	// historyMaxPage bounds the items one read asks for
	historyMaxPage = 100
)

// historyScanBudget bounds the index entries one read looks through for
// what a filter or a counterparty lets by (about 40 ms' worth): a page
// that finds fewer goes on from where the budget ran out, at its Next.
// Tests lower it.
var historyScanBudget = 500_000

var (
	errHistoryCursor  = errors.New("history: not a valid cursor")
	errHistoryFilter  = errors.New("history: not a valid filter")
	errHistoryWith    = errors.New("history: not a valid counterparty address")
	errHistoryHash    = errors.New("history: not a valid transaction hash")
	errHistoryPath    = errors.New("history: the export must be saved as a .csv file")
	ErrHistoryPartial = errors.New("history: the history is still being indexed")
)

// HistoryQuery asks for a page of an account's history: newest first, or
// from Cursor (the Next of the page before), or from block AtBlock down;
// all of it, or only what Filter lets by ("in", "out", "mined" or
// "failed"), or only the transactions with With.
type HistoryQuery struct {
	Address string `json:"address"`
	Cursor  string `json:"cursor"`
	Filter  string `json:"filter"`
	With    string `json:"with"`
	AtBlock uint64 `json:"atBlock"`
}

// histRef is an entry of an address's, by where it is in the chain.
type histRef struct {
	num   uint64
	pos   uint32
	roles byte
}

// histQuery is a HistoryQuery read and checked.
type histQuery struct {
	addr   util.Address
	with   *util.Address
	filter string
	before *histRef // only what's strictly older; nil for from the newest
}

func parseHistQuery(q HistoryQuery) (histQuery, error) {
	addr := strings.TrimSpace(q.Address)
	if !util.IsHexAddress(addr) {
		return histQuery{}, fmt.Errorf("invalid address %q", q.Address)
	}
	out := histQuery{addr: util.HexToAddress(addr)}
	switch q.Filter {
	case "", "all":
	case "in", "out", "mined", "failed":
		out.filter = q.Filter
	default:
		return histQuery{}, errHistoryFilter
	}
	if w := strings.TrimSpace(q.With); w != "" {
		if !util.IsHexAddress(w) {
			return histQuery{}, errHistoryWith
		}
		a := util.HexToAddress(w)
		out.with = &a
	}
	before, err := parseHistCursor(q.Cursor)
	if err != nil {
		return histQuery{}, err
	}
	// From a block down: older than its successor's first transaction
	if before == nil && q.AtBlock > 0 && q.AtBlock < ^uint64(0) {
		before = &histRef{num: q.AtBlock + 1, pos: 0}
	}
	out.before = before
	return out, nil
}

// keep reports whether an entry of the account's, with roles, is one the
// filter lets by; withRoles are the counterparty's at the same place, if
// it has an entry there (with set).
func (q *histQuery) keep(pos uint32, roles byte, withRoles byte, withHere bool) bool {
	switch q.filter {
	case "in":
		if roles&roleTo == 0 || roles&roleFrom != 0 {
			return false
		}
	case "out":
		if roles&roleFrom == 0 {
			return false
		}
	case "mined":
		if roles&roleMiner == 0 {
			return false
		}
	case "failed":
		if roles&roleFailed == 0 {
			return false
		}
	}
	if q.with != nil {
		if pos == posMined {
			return false
		}
		// With itself: what it sent itself
		if *q.with == q.addr {
			return roles&roleFrom != 0 && roles&roleTo != 0
		}
		return withHere
	}
	return true
}

// fromRef is the cursor that starts a page at (num, pos) itself: older
// than the place just before it.
func fromRef(num uint64, pos uint32) histRef {
	if pos == posMined {
		return histRef{num: num + 1, pos: 0}
	}
	return histRef{num: num, pos: pos + 1}
}

// olderThan reports whether (num, pos) comes after before, newest first.
func olderThan(num uint64, pos uint32, before *histRef) bool {
	return before == nil || num < before.num || (num == before.num && pos < before.pos)
}

// formatHistCursor and parseHistCursor write and read where a page of
// history ended, as "block.position", for the next page to go on from.
func formatHistCursor(r histRef) string {
	return strconv.FormatUint(r.num, 10) + "." + strconv.FormatUint(uint64(r.pos), 10)
}

func parseHistCursor(s string) (*histRef, error) {
	if s == "" {
		return nil, nil
	}
	a, b, ok := strings.Cut(s, ".")
	num, err1 := strconv.ParseUint(a, 10, 64)
	pos, err2 := strconv.ParseUint(b, 10, 32)
	if !ok || err1 != nil || err2 != nil {
		return nil, errHistoryCursor
	}
	return &histRef{num: num, pos: uint32(pos)}, nil
}

// sortRefs orders refs newest first, as the index does.
func sortRefs(refs []histRef) {
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].num != refs[j].num {
			return refs[i].num > refs[j].num
		}
		return refs[i].pos > refs[j].pos
	})
}

// scan looks through the index for up to limit of the query's entries
// older than from, newest first, through at most budget entries. resume is
// where a read stopped by the budget goes on from, nil when it didn't.
func (h *historyIndex) scan(q *histQuery, from *histRef, limit, budget int) (refs []histRef, resume *histRef, err error) {
	var start []byte
	if from != nil {
		start = histPosition(from.num, from.pos)
	}
	ia := h.db.NewIterator(histAddrPrefix(q.addr), start)
	defer ia.Release()
	// The counterparty's entries alongside, in the same order: where both
	// have one, it's a transaction between them
	join := q.with != nil && *q.with != q.addr
	var ix dbstore.Iterator
	if join {
		it := h.db.NewIterator(histAddrPrefix(*q.with), start)
		defer it.Release()
		ix = it
	}
	next := func(it dbstore.Iterator) (histRef, bool) {
		for it.Next() {
			num, pos, ok := parseHistEntryKey(it.Key())
			if ok && olderThan(num, pos, from) {
				return histRef{num: num, pos: pos}, true
			}
		}
		return histRef{}, false
	}
	roles := func(v []byte) byte {
		if len(v) == 1 {
			return v[0]
		}
		return 0
	}

	a, aok := next(ia)
	var x histRef
	xok := false
	if join {
		x, xok = next(ix)
	}
	scanned := 0
	for aok && len(refs) < limit {
		if scanned >= budget {
			r := fromRef(a.num, a.pos)
			return refs, &r, ia.Error()
		}
		scanned++
		if !join {
			r := roles(ia.Value())
			if q.keep(a.pos, r, 0, false) {
				refs = append(refs, histRef{num: a.num, pos: a.pos, roles: r})
			}
			a, aok = next(ia)
			continue
		}
		if !xok {
			break // nothing of the counterparty's is older
		}
		switch ca, cx := histPosition(a.num, a.pos), histPosition(x.num, x.pos); bytes.Compare(ca, cx) {
		case 0:
			r := roles(ia.Value())
			if q.keep(a.pos, r, roles(ix.Value()), true) {
				refs = append(refs, histRef{num: a.num, pos: a.pos, roles: r})
			}
			a, aok = next(ia)
			x, xok = next(ix)
		case -1: // the account's is newer
			a, aok = next(ia)
		default:
			x, xok = next(ix)
		}
	}
	return refs, nil, ia.Error()
}

// readHistory reads up to limit of the query's items, newest first: from
// the chain itself for the blocks past the index's tip, which are few once
// it's built, and from the index below it. Without an index (idx nil), or
// while one is built from scratch, only the newest historyLiveBlocks
// blocks are read, and the page says it isn't complete.
func readHistory(bc *validation.BlockChain, idx *historyIndex, q histQuery, limit int) (HistoryPage, error) {
	if limit <= 0 || limit > historyMaxPage {
		limit = historyPageSize
	}
	page := HistoryPage{Transactions: []HistoryTx{}}
	head := historyHead(bc)
	var tip uint64
	if idx != nil {
		tip = idx.Tip().num
	}
	page.IndexedTo = tip
	page.Indexing = idx != nil && tip < head
	// The blocks past the tip, as far back as a query reads the chain:
	// if that doesn't reach the tip, the index can't go on from them
	lo := tip + 1
	page.Complete = idx != nil
	if head >= historyLiveBlocks && head-historyLiveBlocks+1 > lo {
		lo = head - historyLiveBlocks + 1
		page.Complete = false
	}

	// One more than the page, to know whether there's a next
	var refs []histRef
	top := head
	if q.before != nil && q.before.num < top {
		top = q.before.num
	}
	for num := top; num >= lo && len(refs) <= limit; num-- {
		block := bc.GetBlockByNumber(num)
		if block == nil {
			continue
		}
		entries := blockEntries(block, types.MakeSigner(bc.Config(), block.Number()), bc.GetReceiptsByHash(block.Hash()))
		var mine []histRef
		for _, e := range entries {
			if e.addr != q.addr || !olderThan(num, e.pos, q.before) {
				continue
			}
			var withRoles byte
			withHere := false
			if q.with != nil {
				for _, o := range entries {
					if o.addr == *q.with && o.pos == e.pos {
						withRoles, withHere = o.roles, true
					}
				}
			}
			if q.keep(e.pos, e.roles, withRoles, withHere) {
				mine = append(mine, histRef{num: num, pos: e.pos, roles: e.roles})
			}
		}
		sortRefs(mine)
		refs = append(refs, mine...)
	}
	if page.Complete && len(refs) <= limit {
		from := q.before
		if from != nil && from.num > tip {
			from = nil // everything indexed is older
		}
		older, resume, err := idx.scan(&q, from, limit+1-len(refs), historyScanBudget)
		if err != nil {
			return page, fmt.Errorf("history: %w", err)
		}
		refs = append(refs, older...)
		if resume != nil && len(refs) <= limit {
			page.Next = formatHistCursor(*resume)
		}
	}
	if len(refs) > limit {
		refs = refs[:limit]
		page.Next = formatHistCursor(refs[limit-1])
	}

	for _, r := range refs {
		block := bc.GetBlockByNumber(r.num)
		if block == nil {
			continue
		}
		// An entry a reorg is taking off as this reads isn't the block's
		if item, ok := historyItem(bc, block, r.pos, q.addr); ok {
			page.Transactions = append(page.Transactions, item)
		}
	}
	return page, nil
}

// historyItem is addr's item at pos in block, if it has one there.
func historyItem(bc *validation.BlockChain, block *types.Block, pos uint32, addr util.Address) (HistoryTx, bool) {
	txs := block.Transactions()
	receipts := bc.GetReceiptsByHash(block.Hash())
	if len(receipts) != len(txs) {
		receipts = nil // not downloaded yet
	}
	num := block.NumberU64()
	item := HistoryTx{
		Block:     num,
		BlockHash: block.Hash().Hex(),
		Index:     pos,
		Timestamp: int64(block.Time()),
	}
	baseFee := block.BaseFee()

	if pos == posMined {
		if num == 0 || block.Coinbase() != addr {
			return HistoryTx{}, false
		}
		reward := blockRewardAt(num)
		item.Kind = "mined"
		item.Index = 0
		item.To = block.Coinbase().Hex()
		item.RewardWei = reward.String()
		item.FeeWei = "0"
		total := new(big.Int).Set(reward)
		if receipts != nil || len(txs) == 0 {
			fees := new(big.Int)
			for i, tx := range txs {
				tip := tx.EffectiveGasTipValue(baseFee)
				fees.Add(fees, new(big.Int).Mul(tip, new(big.Int).SetUint64(receipts[i].GasUsed)))
			}
			item.FeesWei = fees.String()
			total.Add(total, fees)
		}
		item.ValueWei = total.String()
		if x := bc.Config().XHash; x != nil {
			item.MaturesAt = num + x.CoinbaseMaturityBlocks
		} else {
			item.MaturesAt = num
		}
		return item, true
	}

	if int(pos) >= len(txs) {
		return HistoryTx{}, false
	}
	tx := txs[pos]
	from, err := types.Sender(types.MakeSigner(bc.Config(), block.Number()), tx)
	to := tx.To()
	if !(err == nil && from == addr) && !(to != nil && *to == addr) {
		return HistoryTx{}, false
	}
	item.Hash = tx.Hash().Hex()
	if err == nil {
		item.From = from.Hex()
	}
	item.ValueWei = tx.Value().String()
	item.Kind = "call"
	switch {
	case to == nil:
		item.Kind = "contract"
	case len(tx.Data()) == 0:
		item.Kind = "transfer"
	}
	if to != nil {
		item.To = to.Hex()
	}
	if receipts != nil {
		r := receipts[pos]
		item.Failed = r.Status == types.ReceiptStatusFailed
		item.GasUsed = r.GasUsed
		if r.ContractAddress != (util.Address{}) {
			item.ContractAddress = r.ContractAddress.Hex()
		}
		// What the sender paid per gas: the price, or a base fee and a tip
		price := tx.GasPrice()
		if baseFee != nil {
			price = new(big.Int).Add(baseFee, tx.EffectiveGasTipValue(baseFee))
		}
		item.FeeWei = new(big.Int).Mul(price, new(big.Int).SetUint64(r.GasUsed)).String()
	}
	return item, true
}

// HistoryFind is where a transaction searched for by hash is in an
// account's history: in a block (Cursor starts a page at it), or waiting
// in the pool (Pending), or neither (Found unset).
type HistoryFind struct {
	Found   bool      `json:"found"`
	Pending bool      `json:"pending"`
	Cursor  string    `json:"cursor"`
	Item    HistoryTx `json:"item"`
}

// findHistoryTx finds transaction hash among addr's: in the chain, by the
// node's transaction index (which holds the last TxLookupLimit blocks'),
// or in the pool.
func findHistoryTx(bc *validation.BlockChain, chainDB dbstore.Reader, pool interface {
	Get(util.Hash) *types.Transaction
}, addr util.Address, hash string) (HistoryFind, error) {
	raw, err := hexutil.Decode(strings.TrimSpace(hash))
	if err != nil || len(raw) != util.HashLength {
		return HistoryFind{}, errHistoryHash
	}
	h := util.BytesToHash(raw)
	if tx, blockHash, num, index := rawdb.ReadTransaction(chainDB, h); tx != nil && bc.GetCanonicalHash(num) == blockHash {
		if block := bc.GetBlock(blockHash, num); block != nil {
			if item, ok := historyItem(bc, block, uint32(index), addr); ok {
				return HistoryFind{Found: true, Cursor: formatHistCursor(fromRef(num, uint32(index))), Item: item}, nil
			}
		}
		return HistoryFind{}, nil
	}
	if tx := pool.Get(h); tx != nil {
		from, err := types.Sender(types.LatestSignerForChainID(bc.Config().ChainID), tx)
		if (err == nil && from == addr) || (tx.To() != nil && *tx.To() == addr) {
			return HistoryFind{Found: true, Pending: true}, nil
		}
	}
	return HistoryFind{}, nil
}

// blockAt is the newest block mined at or before t (Unix seconds), 0 for
// one before the first block.
func blockAt(bc *validation.BlockChain, t int64) uint64 {
	lo, hi := uint64(0), historyHead(bc)
	if h := bc.GetHeaderByNumber(hi); h != nil && int64(h.Time) <= t {
		return hi
	}
	// The newest block at or before t lies in [lo, hi)
	for lo+1 < hi {
		mid := lo + (hi-lo)/2
		h := bc.GetHeaderByNumber(mid)
		if h == nil {
			hi = mid
			continue
		}
		if int64(h.Time) <= t {
			lo = mid
		} else {
			hi = mid
		}
	}
	return lo
}

// exportHistory writes the query's whole history to path as CSV, for
// accounting: a row per item, newest first, its counterparty named from
// names (by checksummed address) where it's one. Only a complete history
// is written. progress hears how many blocks of the chain it has gone
// through. It returns the rows written.
func exportHistory(bc *validation.BlockChain, idx *historyIndex, q histQuery, path string, names map[string]string, progress func(done, total uint64)) (int, error) {
	if !filepath.IsAbs(path) || !strings.EqualFold(filepath.Ext(path), ".csv") {
		return 0, errHistoryPath
	}
	q.before = nil
	first, err := readHistory(bc, idx, q, 1)
	if err != nil {
		return 0, err
	}
	if !first.Complete {
		return 0, ErrHistoryPartial
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".parallax-history-*.csv")
	if err != nil {
		return 0, err
	}
	defer os.Remove(tmp.Name()) // gone once renamed
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return 0, err
	}
	w := csv.NewWriter(tmp)
	_ = w.Write([]string{"Date (UTC)", "Block", "Type", "Status", "From", "To", "Counterparty", "Amount (LAX)", "Fee (LAX)", "Net change (LAX)", "Transaction hash", "Block hash"})

	head := historyHead(bc)
	rows := 0
	for {
		page, err := readHistory(bc, idx, q, historyMaxPage)
		if err != nil {
			tmp.Close()
			return 0, err
		}
		for _, it := range page.Transactions {
			if err := w.Write(historyCSVRow(it, q.addr, names)); err != nil {
				tmp.Close()
				return 0, err
			}
			rows++
		}
		if page.Next == "" {
			break
		}
		if q.before, err = parseHistCursor(page.Next); err != nil {
			tmp.Close()
			return 0, err
		}
		if progress != nil && q.before.num <= head {
			progress(head-q.before.num, head)
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		tmp.Close()
		return 0, err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return 0, err
	}
	if err := tmp.Close(); err != nil {
		return 0, err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return 0, err
	}
	if progress != nil {
		progress(head, head)
	}
	return rows, nil
}

// historyCSVRow is an item as a row of the export.
func historyCSVRow(it HistoryTx, addr util.Address, names map[string]string) []string {
	value := decimalWei(it.ValueWei)
	fee := decimalWei(it.FeeWei)
	fromMe := it.From != "" && util.HexToAddress(it.From) == addr
	toMe := it.To != "" && util.HexToAddress(it.To) == addr
	kind, other := "Received", it.From
	net := new(big.Int)
	switch {
	case it.Kind == "mined":
		kind, other = "Mined", ""
		net.Set(value)
	case fromMe && toMe:
		kind, other = "Self", ""
		net.Neg(fee)
	case fromMe:
		kind, other = "Sent", it.To
		if it.Kind == "contract" {
			kind = "Contract creation"
		}
		net.Neg(fee)
		if !it.Failed {
			net.Sub(net, value)
		}
	default:
		if !it.Failed {
			net.Set(value)
		}
	}
	if !fromMe {
		fee = new(big.Int) // the sender paid it
	}
	status := "Confirmed"
	if it.Failed {
		status = "Failed"
	}
	name := ""
	if other != "" {
		name = csvSafe(names[util.HexToAddress(other).Hex()])
	}
	return []string{
		time.Unix(it.Timestamp, 0).UTC().Format(time.RFC3339),
		strconv.FormatUint(it.Block, 10),
		kind,
		status,
		it.From,
		it.To,
		name,
		formatLaxExact(value),
		formatLaxExact(fee),
		formatLaxExact(net),
		it.Hash,
		it.BlockHash,
	}
}

func decimalWei(s string) *big.Int {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return new(big.Int)
	}
	return v
}

// formatLaxExact writes wei as LAX, every digit kept and trailing zeros
// dropped: "-1.25", "0.000000000000000001", "0".
func formatLaxExact(wei *big.Int) string {
	neg := wei.Sign() < 0
	digits := new(big.Int).Abs(wei).String()
	for len(digits) <= 18 {
		digits = "0" + digits
	}
	whole, frac := digits[:len(digits)-18], strings.TrimRight(digits[len(digits)-18:], "0")
	out := whole
	if frac != "" {
		out += "." + frac
	}
	if neg {
		out = "-" + out
	}
	return out
}
