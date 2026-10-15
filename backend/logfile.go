// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/nacl/box"
)

// The log file keeps the logs across restarts, sealed: the node's lines,
// and the app's, name addresses, transactions and amounts, and the node
// logs whether or not the wallet is unlocked. So the lines are sealed to
// a public key (NaCl's anonymous box: X25519 and XSalsa20-Poly1305), which
// needs nothing secret to write with, and only its private half, kept in
// the vault under the wallet key, opens them: an earlier run's lines are
// read back once the wallet is unlocked (Unseal). Until the app knows the
// key (the wallet opened, or its password set) the lines stay in memory.
//
// Each second's lines are sealed together, one record per line of the
// file, base64; the file rotates past logFileMax to a single older one.
const (
	logFileName    = "parallax.sealed-log"
	logFileMax     = 10 << 20
	logReloadBytes = 3 << 20
	logFileFlush   = time.Second
	// logBatchMax seals a batch early once it holds this many lines
	logBatchMax = 500

	// The files an earlier version kept the logs in, in the clear
	legacyLogFile = "parallax.log"
)

type logFile struct {
	path string
	f    *os.File
	w    *bufio.Writer
	size int64
	pub  [32]byte
	// Lines waiting to be sealed at the next flush
	batch []LogLine
	// Where the lines of earlier runs end, for Unseal: the first
	// earlierEnd bytes of earlierPath; none once read, or rotated away
	earlierPath string
	earlierEnd  int64
}

// Persist keeps the logs in dir from now on, once SealTo gives the key to
// seal them to. clear asks for each run to start afresh: what earlier runs
// left is removed.
func (l *LogTail) Persist(dir string, clear bool) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if clear {
		for _, name := range []string{logFileName, legacyLogFile} {
			os.Remove(filepath.Join(dir, name))
			os.Remove(filepath.Join(dir, name+".1"))
		}
	}
	l.mu.Lock()
	l.dir = dir
	l.mu.Unlock()
	go l.flushLoop()
	return nil
}

// SealTo starts writing the logs, sealed to pub: this run's lines so far,
// then each one from here. Lines an earlier version kept in the clear are
// sealed into the file first, and their clear files removed.
func (l *LogTail) SealTo(pub []byte) error {
	if len(pub) != 32 {
		return errors.New("logs: not a sealing key")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.dir == "" || l.file != nil {
		return nil
	}
	path := filepath.Join(l.dir, logFileName)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	lf := &logFile{path: path, f: f, w: bufio.NewWriter(f), size: info.Size()}
	copy(lf.pub[:], pub)
	// An earlier version's lines, oldest first, sealed as earlier runs' are
	for _, legacy := range []string{legacyLogFile + ".1", legacyLogFile} {
		p := filepath.Join(l.dir, legacy)
		if lines := readPlainLogFile(p); len(lines) > 0 {
			for _, line := range lines {
				lf.write(line)
			}
			lf.flushBatch()
		}
		os.Remove(p)
	}
	lf.w.Flush()
	lf.earlierPath, lf.earlierEnd = path, lf.size
	for _, line := range l.buf {
		lf.write(line)
	}
	lf.flushBatch()
	lf.w.Flush()
	l.file = lf
	return nil
}

// DropPlain reads back the lines an earlier version kept in the clear,
// for this run to show, and removes their files: for a wallet with no
// password yet, which has no key to seal them to.
func (l *LogTail) DropPlain() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.dir == "" {
		return
	}
	var earlier []LogLine
	for _, legacy := range []string{legacyLogFile + ".1", legacyLogFile} {
		p := filepath.Join(l.dir, legacy)
		earlier = append(earlier, readPlainLogFile(p)...)
		os.Remove(p)
	}
	l.prependLocked(earlier)
}

// Unseal reads back, with the logs' private key, the lines earlier runs
// left, and puts them before this run's. Only once: they are this run's
// from then on.
func (l *LogTail) Unseal(pub, priv *[32]byte) {
	l.mu.Lock()
	defer l.mu.Unlock()
	lf := l.file
	if lf == nil || lf.earlierEnd == 0 {
		return
	}
	earlier := readSealedLogFile(lf.earlierPath, lf.earlierEnd, pub, priv)
	lf.earlierEnd = 0
	l.prependLocked(earlier)
}

// Unpersist stops writing the logs and removes their files, which nothing
// could open any more: the wallet, and the key they were sealed to, are
// gone (Wipe). They stay in memory.
func (l *LogTail) Unpersist() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		l.file.f.Close()
		l.file = nil
	}
	if l.dir != "" {
		os.Remove(filepath.Join(l.dir, logFileName))
		os.Remove(filepath.Join(l.dir, logFileName+".1"))
	}
}

// prependLocked puts earlier lines before the tail's. The caller holds l.mu.
func (l *LogTail) prependLocked(earlier []LogLine) {
	if len(earlier) == 0 {
		return
	}
	merged := append(earlier, l.buf...)
	if len(merged) > l.cap {
		merged = merged[len(merged)-l.cap:]
	}
	l.buf = append(make([]LogLine, 0, l.cap), merged...)
}

// flushLoop seals and writes the file's waiting lines every second, so a
// crash loses at most the last moment's.
func (l *LogTail) flushLoop() {
	t := time.NewTicker(logFileFlush)
	defer t.Stop()
	for range t.C {
		l.mu.Lock()
		if lf := l.file; lf != nil {
			lf.flushBatch()
			lf.w.Flush()
		}
		l.mu.Unlock()
	}
}

// write adds a line to the batch the next flush seals. The caller holds l.mu.
func (lf *logFile) write(line LogLine) {
	lf.batch = append(lf.batch, line)
	if len(lf.batch) >= logBatchMax {
		lf.flushBatch()
	}
}

// flushBatch seals the waiting lines as one record and appends it,
// rotating the file once it outgrows logFileMax. The caller holds l.mu.
func (lf *logFile) flushBatch() {
	if len(lf.batch) == 0 {
		return
	}
	data, err := json.Marshal(lf.batch)
	lf.batch = lf.batch[:0]
	if err != nil {
		return
	}
	sealed, err := box.SealAnonymous(nil, data, &lf.pub, rand.Reader)
	clear(data)
	if err != nil {
		return
	}
	record := make([]byte, base64.StdEncoding.EncodedLen(len(sealed))+1)
	base64.StdEncoding.Encode(record, sealed)
	record[len(record)-1] = '\n'
	if lf.size+int64(len(record)) > logFileMax {
		lf.rotate()
	}
	n, _ := lf.w.Write(record)
	lf.size += int64(n)
}

// rotate moves the full file aside, replacing the one moved aside before,
// and starts afresh. The caller holds l.mu.
func (lf *logFile) rotate() {
	lf.w.Flush()
	lf.f.Close()
	os.Rename(lf.path, lf.path+".1")
	switch lf.earlierPath {
	case lf.path:
		lf.earlierPath = lf.path + ".1"
	default:
		// What earlier runs left was in the file moved aside before
		lf.earlierEnd = 0
	}
	f, err := os.OpenFile(lf.path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		// Nowhere to write: keep the in-memory tail only
		lf.w.Reset(io.Discard)
		return
	}
	lf.f, lf.size = f, 0
	lf.w.Reset(f)
}

// close seals what's waiting and writes it out. The caller holds l.mu.
func (lf *logFile) close() {
	lf.flushBatch()
	lf.w.Flush()
}

// clear empties the file and drops the one moved aside. The caller holds l.mu.
func (lf *logFile) clear() {
	lf.batch = lf.batch[:0]
	lf.w.Reset(lf.f)
	lf.f.Truncate(0)
	lf.f.Seek(0, io.SeekStart)
	lf.size, lf.earlierEnd = 0, 0
	os.Remove(lf.path + ".1")
}

// readSealedLogFile opens the records in the last logReloadBytes of the
// first end bytes of path, skipping any it can't (a record cut short by a
// crash, the partial first one where the read starts, or one sealed to
// another key).
func readSealedLogFile(path string, end int64, pub, priv *[32]byte) []LogLine {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	start := max(0, end-logReloadBytes)
	data := make([]byte, end-start)
	if _, err := f.ReadAt(data, start); err != nil && !errors.Is(err, io.EOF) {
		return nil
	}
	var out []LogLine
	for _, raw := range bytes.Split(data, []byte{'\n'}) {
		sealed := make([]byte, base64.StdEncoding.DecodedLen(len(raw)))
		n, err := base64.StdEncoding.Decode(sealed, raw)
		if err != nil || n == 0 {
			continue
		}
		plain, ok := box.OpenAnonymous(nil, sealed[:n], pub, priv)
		if !ok {
			continue
		}
		var lines []LogLine
		if json.Unmarshal(plain, &lines) == nil {
			out = append(out, lines...)
		}
		clear(plain)
	}
	return out
}

// readPlainLogFile reads back the lines of a log an earlier version kept
// in the clear: its last logReloadBytes, one JSON line per log line.
func readPlainLogFile(path string) []LogLine {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil
	}
	if info.Size() > logReloadBytes {
		f.Seek(info.Size()-logReloadBytes, io.SeekStart)
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil
	}
	var out []LogLine
	for _, raw := range bytes.Split(data, []byte{'\n'}) {
		var line LogLine
		if len(raw) > 0 && json.Unmarshal(raw, &line) == nil && line.Message != "" {
			out = append(out, line)
		}
	}
	return out
}
