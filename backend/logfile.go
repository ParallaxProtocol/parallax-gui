// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"time"
)

// The log file keeps the logs across restarts: one JSON line per log line,
// rotated past logFileMax to a single older file, and read back (its last
// part, up to logReloadBytes) when the app starts.
const (
	logFileName    = "parallax.log"
	logFileMax     = 10 << 20
	logReloadBytes = 2 << 20
	logFileFlush   = time.Second
)

type logFile struct {
	path string
	f    *os.File
	w    *bufio.Writer
	size int64
}

// Persist keeps the logs in dir from now on: it reads back the lines an
// earlier run left (unless clear asks to start afresh, which removes them),
// puts them before this run's, and writes every line from here on to the
// file. The caller is the app, once it knows where its folder is.
func (l *LogTail) Persist(dir string, clear bool) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(dir, logFileName)
	var earlier []LogLine
	if clear {
		os.Remove(path)
		os.Remove(path + ".1")
	} else {
		earlier = readLogFile(path)
	}
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

	l.mu.Lock()
	// This run's lines so far go to the file too, after the earlier ones
	for _, line := range l.buf {
		lf.write(line)
	}
	merged := append(earlier, l.buf...)
	if len(merged) > l.cap {
		merged = merged[len(merged)-l.cap:]
	}
	l.buf = append(make([]LogLine, 0, l.cap), merged...)
	l.file = lf
	lf.w.Flush()
	l.mu.Unlock()

	go l.flushLoop()
	return nil
}

// flushLoop writes the file's buffered lines out every second, so a crash
// loses at most the last moment's.
func (l *LogTail) flushLoop() {
	t := time.NewTicker(logFileFlush)
	defer t.Stop()
	for range t.C {
		l.mu.Lock()
		lf := l.file
		if lf == nil {
			l.mu.Unlock()
			return
		}
		lf.w.Flush()
		l.mu.Unlock()
	}
}

// write appends a line to the file, rotating it once it outgrows logFileMax.
// The caller holds l.mu.
func (lf *logFile) write(line LogLine) {
	data, err := json.Marshal(line)
	if err != nil {
		return
	}
	data = append(data, '\n')
	if lf.size+int64(len(data)) > logFileMax {
		lf.rotate()
	}
	n, _ := lf.w.Write(data)
	lf.size += int64(n)
}

// rotate moves the full file aside, replacing the one moved aside before,
// and starts afresh.
func (lf *logFile) rotate() {
	lf.w.Flush()
	lf.f.Close()
	os.Rename(lf.path, lf.path+".1")
	f, err := os.OpenFile(lf.path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		// Nowhere to write: keep the in-memory tail only
		lf.w.Reset(io.Discard)
		return
	}
	lf.f, lf.size = f, 0
	lf.w.Reset(f)
}

// clear empties the file and drops the one moved aside. The caller holds l.mu.
func (lf *logFile) clear() {
	lf.w.Reset(lf.f)
	lf.f.Truncate(0)
	lf.f.Seek(0, io.SeekStart)
	lf.size = 0
	os.Remove(lf.path + ".1")
}

// readLogFile reads back the lines in the file's last logReloadBytes,
// skipping any it can't read (a line cut short by a crash, or the partial
// first line where the read starts).
func readLogFile(path string) []LogLine {
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
