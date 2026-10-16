// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/dbstore"
	"github.com/ParallaxProtocol/parallax/v2/dbstore/leveldb"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/validation"
	"github.com/ParallaxProtocol/parallax/v2/validation/rawdb"
)

// The history index lists, for every address on the chain, the
// transactions sent from or to it and the blocks it mined, so an account's
// whole history reads in a few lookups instead of a walk of the chain. It
// indexes every address, not only the wallet's: it says nothing of which
// accounts are the user's, it builds while the wallet is locked, and an
// account added or imported has its history at once, with no rescan.
//
// It is the node's, kept in its own database in the node's data folder
// (the chain is what it's built from), and follows the chain head: blocks
// as they arrive, the blocks a snap sync downloads, and back again over a
// reorg, by the undo record each recent block leaves. Its tip is written
// in the same batch as the entries it covers, so a crash loses at most
// the last batch, never the index's consistency.
//
// Keys:
//
//	"v"                         → version (uint64)
//	"g"                         → the genesis hash it was built on
//	"t"                         → tip: number (8) + hash (32), the last block indexed
//	"a" + addr + ^num + ^pos    → roles (1 byte, failed among them), newest first in key order
//	"u" + num                   → undo: hash (32) + parent (32) + (addr + pos)…
//
// pos is the transaction's index in the block, or posMined for the
// block's reward.

// historyDir is the index's folder in the node's instance directory,
// beside its chaindata.
const historyDir = "history"

const (
	// historyVersion is the index's format: one built by another is built
	// again. 2 marks the transactions that failed.
	historyVersion = 2

	// historyStepBlocks is how many blocks one step reads and commits,
	// between which the indexer sees the head move and its stop.
	historyStepBlocks = 512

	// historyPoll is how often the indexer looks for blocks no head event
	// announces (a snap sync's)
	historyPoll = 5 * time.Second

	// historyRetry is how long it waits after a failure before trying again
	historyRetry = 30 * time.Second
)

// historyUndoDepth is how deep a reorg the index unwinds; a deeper one
// (far past what proof of work ever sees) has it built again. Tests
// lower it.
var historyUndoDepth uint64 = 4096

// historyLiveBlocks bounds the blocks a query reads straight from the
// chain, beyond the index's tip: while the index is built from scratch
// the newest are shown from these. Tests lower it.
var historyLiveBlocks uint64 = 1008

// posMined is the position of a block's reward among its entries: after
// every transaction, so first in the newest-first order.
const posMined = math.MaxUint32

// The roles an address plays in an entry, and whether its transaction
// failed.
const (
	roleFrom byte = 1 << iota
	roleTo
	roleMiner
	roleFailed
)

var (
	histKeyVersion = []byte("v")
	histKeyGenesis = []byte("g")
	histKeyTip     = []byte("t")
	histPrefixAddr = []byte("a")
	histPrefixUndo = []byte("u")
)

// errHistoryClosed answers a call on an index that was closed.
var errHistoryClosed = errors.New("history: the index is closed")

// histTip is the last block indexed.
type histTip struct {
	num  uint64
	hash util.Hash
}

// histEntry is one address's part in one block.
type histEntry struct {
	addr  util.Address
	pos   uint32
	roles byte
}

// blockEntries lists the addresses block involves: each transaction's
// sender and recipient, and the miner its reward goes to. An address
// that both sent and received a transaction has one entry for it. With
// the block's receipts, a failed transaction's entries say so.
func blockEntries(block *types.Block, signer types.Signer, receipts types.Receipts) []histEntry {
	var out []histEntry
	add := func(addr util.Address, pos uint32, role byte) {
		for i := len(out) - 1; i >= 0 && out[i].pos == pos; i-- {
			if out[i].addr == addr {
				out[i].roles |= role
				return
			}
		}
		out = append(out, histEntry{addr: addr, pos: pos, roles: role})
	}
	txs := block.Transactions()
	if len(receipts) != len(txs) {
		receipts = nil
	}
	for i, tx := range txs {
		var failed byte
		if receipts != nil && receipts[i].Status == types.ReceiptStatusFailed {
			failed = roleFailed
		}
		if from, err := types.Sender(signer, tx); err == nil {
			add(from, uint32(i), roleFrom|failed)
		}
		if to := tx.To(); to != nil {
			add(*to, uint32(i), roleTo|failed)
		}
	}
	if block.NumberU64() > 0 {
		add(block.Coinbase(), posMined, roleMiner)
	}
	return out
}

func histAddrPrefix(addr util.Address) []byte {
	return append(append([]byte{}, histPrefixAddr...), addr.Bytes()...)
}

// histPosition is where an entry sorts: inverted, so the newest come first.
func histPosition(num uint64, pos uint32) []byte {
	b := make([]byte, 12)
	binary.BigEndian.PutUint64(b, ^num)
	binary.BigEndian.PutUint32(b[8:], ^pos)
	return b
}

func histEntryKey(addr util.Address, num uint64, pos uint32) []byte {
	return append(histAddrPrefix(addr), histPosition(num, pos)...)
}

// parseHistEntryKey reads the block and position back from an entry's key.
func parseHistEntryKey(key []byte) (num uint64, pos uint32, ok bool) {
	if len(key) != 1+util.AddressLength+12 {
		return 0, 0, false
	}
	p := key[1+util.AddressLength:]
	return ^binary.BigEndian.Uint64(p), ^binary.BigEndian.Uint32(p[8:]), true
}

func histUndoKey(num uint64) []byte {
	k := append([]byte{}, histPrefixUndo...)
	return binary.BigEndian.AppendUint64(k, num)
}

func encodeHistTip(t histTip) []byte {
	return append(binary.BigEndian.AppendUint64(nil, t.num), t.hash.Bytes()...)
}

func decodeHistTip(b []byte) (histTip, bool) {
	if len(b) != 8+util.HashLength {
		return histTip{}, false
	}
	return histTip{num: binary.BigEndian.Uint64(b), hash: util.BytesToHash(b[8:])}, true
}

// histUndo is what a block added, to take it out again over a reorg.
type histUndo struct {
	hash, parent util.Hash
	entries      []histEntry // roles aren't kept
}

const histUndoEntryLen = util.AddressLength + 4

func encodeHistUndo(u histUndo) []byte {
	b := make([]byte, 0, 2*util.HashLength+len(u.entries)*histUndoEntryLen)
	b = append(b, u.hash.Bytes()...)
	b = append(b, u.parent.Bytes()...)
	for _, e := range u.entries {
		b = append(b, e.addr.Bytes()...)
		b = binary.BigEndian.AppendUint32(b, e.pos)
	}
	return b
}

func decodeHistUndo(b []byte) (histUndo, bool) {
	if len(b) < 2*util.HashLength || (len(b)-2*util.HashLength)%histUndoEntryLen != 0 {
		return histUndo{}, false
	}
	u := histUndo{hash: util.BytesToHash(b[:32]), parent: util.BytesToHash(b[32:64])}
	for p := b[64:]; len(p) > 0; p = p[histUndoEntryLen:] {
		u.entries = append(u.entries, histEntry{
			addr: util.BytesToAddress(p[:util.AddressLength]),
			pos:  binary.BigEndian.Uint32(p[util.AddressLength:histUndoEntryLen]),
		})
	}
	return u, true
}

// historyHead is the newest block whose body the chain holds: the head, or
// further on while a snap sync downloads the blocks ahead of its state.
func historyHead(bc interface {
	CurrentBlock() *types.Block
	CurrentFastBlock() *types.Block
}) uint64 {
	var n uint64
	if b := bc.CurrentBlock(); b != nil {
		n = b.NumberU64()
	}
	if b := bc.CurrentFastBlock(); b != nil && b.NumberU64() > n {
		n = b.NumberU64()
	}
	return n
}

// historyIndex is the index: its database, the chain it follows, and the
// goroutine that keeps it up to date (run, from start to Close).
type historyIndex struct {
	db      dbstore.KeyValueStore
	chain   dbstore.Reader // the chain's database, read directly
	bc      *validation.BlockChain
	genesis util.Hash

	mu      sync.RWMutex
	tip     histTip
	started bool // run was started
	closing bool // Close was called: run won't be

	quit      chan struct{}
	done      chan struct{} // closed as run returns
	closeOnce sync.Once
}

// openHistoryIndex opens the index kept in dir for the chain bc reads
// from chainDB, making it afresh when it's missing, damaged beyond
// repair, of another format or another chain's. It doesn't start
// following the chain: start does.
func openHistoryIndex(dir string, bc *validation.BlockChain, chainDB dbstore.Reader) (*historyIndex, error) {
	genesis := bc.Genesis().Hash()
	db, err := openHistoryDB(dir)
	if err != nil {
		// Damaged beyond leveldb's own recovery: it's only derived data
		logging.Warn("Rebuilding the history index", "reason", err)
		if rerr := os.RemoveAll(dir); rerr != nil {
			return nil, fmt.Errorf("history: %w", err)
		}
		if db, err = openHistoryDB(dir); err != nil {
			return nil, fmt.Errorf("history: %w", err)
		}
	}
	h := &historyIndex{db: db, chain: chainDB, bc: bc, genesis: genesis, quit: make(chan struct{}), done: make(chan struct{})}
	if reason := h.mismatch(); reason != "" {
		logging.Info("Building the history index", "reason", reason)
		if err := h.clear(); err != nil {
			db.Close()
			return nil, fmt.Errorf("history: %w", err)
		}
	}
	raw, _ := db.Get(histKeyTip)
	tip, ok := decodeHistTip(raw)
	if !ok {
		db.Close()
		return nil, errors.New("history: the index has no tip")
	}
	h.tip = tip
	return h, nil
}

func openHistoryDB(dir string) (dbstore.KeyValueStore, error) {
	return leveldb.New(dir, 16, 16, "gui/history/", false)
}

// mismatch says why the index can't be used as it is, empty when it can.
func (h *historyIndex) mismatch() string {
	v, err := h.db.Get(histKeyVersion)
	if err != nil {
		return "new"
	}
	if len(v) != 8 || binary.BigEndian.Uint64(v) != historyVersion {
		return "format"
	}
	if g, err := h.db.Get(histKeyGenesis); err != nil || !bytes.Equal(g, h.genesis.Bytes()) {
		return "chain"
	}
	if raw, err := h.db.Get(histKeyTip); err != nil {
		return "tip"
	} else if _, ok := decodeHistTip(raw); !ok {
		return "tip"
	}
	return ""
}

// clear empties the index down to the genesis block, to build it again.
func (h *historyIndex) clear() error {
	it := h.db.NewIterator(nil, nil)
	defer it.Release()
	batch := h.db.NewBatch()
	for it.Next() {
		if err := batch.Delete(append([]byte{}, it.Key()...)); err != nil {
			return err
		}
		if batch.ValueSize() >= dbstore.IdealBatchSize {
			if err := batch.Write(); err != nil {
				return err
			}
			batch.Reset()
		}
	}
	if err := it.Error(); err != nil {
		return err
	}
	tip := histTip{num: 0, hash: h.genesis}
	if err := batch.Put(histKeyVersion, binary.BigEndian.AppendUint64(nil, historyVersion)); err != nil {
		return err
	}
	if err := batch.Put(histKeyGenesis, h.genesis.Bytes()); err != nil {
		return err
	}
	if err := batch.Put(histKeyTip, encodeHistTip(tip)); err != nil {
		return err
	}
	if err := batch.Write(); err != nil {
		return err
	}
	h.setTip(tip)
	return nil
}

// Tip is the last block indexed.
func (h *historyIndex) Tip() histTip {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.tip
}

func (h *historyIndex) setTip(t histTip) {
	h.mu.Lock()
	h.tip = t
	h.mu.Unlock()
}

// start has the index follow the chain until Close.
func (h *historyIndex) start() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.started || h.closing {
		return
	}
	h.started = true
	go h.run()
}

// Close stops the indexer, waiting for the step it's in, and closes the
// index. It must be called before the chain's database is closed.
func (h *historyIndex) Close() {
	h.closeOnce.Do(func() {
		h.mu.Lock()
		h.closing = true
		started := h.started
		h.mu.Unlock()
		close(h.quit)
		if started {
			<-h.done
		}
		if err := h.db.Close(); err != nil {
			logging.Warn("Failed to close the history index", "err", err)
		}
	})
}

func (h *historyIndex) closed() bool {
	select {
	case <-h.quit:
		return true
	default:
		return false
	}
}

// run follows the chain: a step at a time while there are blocks to
// index, then waiting for the next head, or a poll's worth of time for
// the blocks a snap sync adds without one.
func (h *historyIndex) run() {
	defer close(h.done)

	heads := make(chan validation.ChainHeadEvent, 16)
	sub := h.bc.SubscribeChainHeadEvent(heads)
	defer sub.Unsubscribe()
	poll := time.NewTicker(historyPoll)
	defer poll.Stop()

	// Building from far behind, it says so as it starts and as it's done
	building := false
	for {
		from := h.Tip().num
		more, err := h.step()
		wait := time.Duration(0)
		switch {
		case errors.Is(err, errHistoryClosed):
			return
		case err != nil:
			logging.Warn("Failed to update the history index", "err", err)
			wait = historyRetry
		case more:
			if !building {
				building = true
				logging.Info("Building the history index", "from", from, "head", historyHead(h.bc))
			}
			continue
		}
		if building && err == nil {
			building = false
			logging.Info("History index up to date", "block", h.Tip().num)
		}
		var retry <-chan time.Time
		if wait > 0 {
			retry = time.After(wait)
		}
		select {
		case <-h.quit:
			return
		case <-retry:
		case <-heads:
		case <-poll.C:
		}
	}
}

// step brings the index one step closer to the chain: unwinding the
// blocks a reorg (or a rewind of the head) took off it, or indexing up to
// historyStepBlocks more. It reports whether there's more to do.
func (h *historyIndex) step() (bool, error) {
	if h.closed() {
		return false, errHistoryClosed
	}
	target := historyHead(h.bc)
	tip := h.Tip()
	if tip.num > target || rawdb.ReadCanonicalHash(h.chain, tip.num) != tip.hash {
		return true, h.unwind(target)
	}
	if tip.num == target {
		return false, nil
	}
	end := min(target, tip.num+historyStepBlocks)
	blocks := h.load(tip.num+1, end, h.bc.CurrentBlock().NumberU64())

	batch := h.db.NewBatch()
	cur := tip
	flush := func() error {
		if err := batch.Put(histKeyTip, encodeHistTip(cur)); err != nil {
			return err
		}
		if err := batch.Write(); err != nil {
			return err
		}
		batch.Reset()
		h.setTip(cur)
		return nil
	}
	for _, b := range blocks {
		// A block not there yet, or one off another branch than the tip's
		// (a reorg as it was read): the next step sees to them
		if b.block == nil || b.block.ParentHash() != cur.hash {
			break
		}
		num := b.block.NumberU64()
		for _, e := range b.entries {
			if err := batch.Put(histEntryKey(e.addr, num, e.pos), []byte{e.roles}); err != nil {
				return false, err
			}
		}
		// Only the blocks a reorg could still take off keep an undo record
		if num+historyUndoDepth > target {
			undo := histUndo{hash: b.block.Hash(), parent: cur.hash, entries: b.entries}
			if err := batch.Put(histUndoKey(num), encodeHistUndo(undo)); err != nil {
				return false, err
			}
		}
		if num > historyUndoDepth {
			if err := batch.Delete(histUndoKey(num - historyUndoDepth)); err != nil {
				return false, err
			}
		}
		cur = histTip{num: num, hash: b.block.Hash()}
		if batch.ValueSize() >= 10*dbstore.IdealBatchSize {
			if err := flush(); err != nil {
				return false, err
			}
		}
	}
	if err := flush(); err != nil {
		return false, err
	}
	return cur.num < target, nil
}

// loadedBlock is a block read for indexing, with its entries.
type loadedBlock struct {
	block   *types.Block
	entries []histEntry
}

// load reads the canonical blocks from..to and works out their entries,
// several at a time: recovering each sender is most of the work. A block
// the chain doesn't hold (yet) is left nil, and so is one whose receipts
// it doesn't, unless it's at or below the head, imported, which has them:
// one there that hasn't is indexed without its failures, not waited for.
func (h *historyIndex) load(from, to, imported uint64) []loadedBlock {
	out := make([]loadedBlock, to-from+1)
	config := h.bc.Config()
	workers := max(1, min(runtime.NumCPU()/2, len(out)))
	next := make(chan int)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				num := from + uint64(i)
				hash := rawdb.ReadCanonicalHash(h.chain, num)
				if hash == (util.Hash{}) {
					continue
				}
				block := rawdb.ReadBlock(h.chain, hash, num)
				if block == nil {
					continue
				}
				receipts := rawdb.ReadRawReceipts(h.chain, hash, num)
				if len(receipts) != len(block.Transactions()) {
					if num > imported {
						continue
					}
					logging.Warn("Indexing a block without its receipts", "block", num, "hash", hash)
					receipts = nil
				}
				out[i] = loadedBlock{block: block, entries: blockEntries(block, types.MakeSigner(config, block.Number()), receipts)}
			}
		}()
	}
	for i := range out {
		if h.closed() {
			break
		}
		next <- i
	}
	close(next)
	wg.Wait()
	return out
}

// unwind takes off the index the blocks no longer on the canonical chain,
// and those past target, down to where the index and the chain agree.
// Past the undo records it can't: the index is built again.
func (h *historyIndex) unwind(target uint64) error {
	cur := h.Tip()
	from := cur.num
	batch := h.db.NewBatch()
	for cur.num > 0 && (cur.num > target || rawdb.ReadCanonicalHash(h.chain, cur.num) != cur.hash) {
		raw, err := h.db.Get(histUndoKey(cur.num))
		undo, ok := decodeHistUndo(raw)
		if err != nil || !ok || undo.hash != cur.hash {
			logging.Warn("Rebuilding the history index after a deep reorg", "block", cur.num)
			return h.clear()
		}
		for _, e := range undo.entries {
			if err := batch.Delete(histEntryKey(e.addr, cur.num, e.pos)); err != nil {
				return err
			}
		}
		if err := batch.Delete(histUndoKey(cur.num)); err != nil {
			return err
		}
		cur = histTip{num: cur.num - 1, hash: undo.parent}
		if batch.ValueSize() >= 10*dbstore.IdealBatchSize {
			if err := batch.Put(histKeyTip, encodeHistTip(cur)); err != nil {
				return err
			}
			if err := batch.Write(); err != nil {
				return err
			}
			batch.Reset()
			h.setTip(cur)
		}
	}
	if cur.num == 0 && cur.hash != h.genesis {
		return h.clear()
	}
	if err := batch.Put(histKeyTip, encodeHistTip(cur)); err != nil {
		return err
	}
	if err := batch.Write(); err != nil {
		return err
	}
	h.setTip(cur)
	logging.Info("Unwound the history index", "from", from, "to", cur.num)
	return nil
}
