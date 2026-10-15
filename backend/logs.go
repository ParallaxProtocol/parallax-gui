// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/logging"
)

// LogTail captures a ring buffer of recent log entries and (optionally)
// streams them live to a frontend emitter. It is installed as the global
// log handler so it picks up everything written by both the GUI binary and
// the embedded node.
type LogTail struct {
	cap int

	mu      sync.RWMutex
	buf     []LogLine
	emitter func([]LogLine)
	glogger *logging.GlogHandler

	// Lines waiting for the next batched emit, and the timer that sends
	// them. A syncing node logs many lines a second; one frontend event
	// per line kept the webview busy whether or not the logs were open.
	pending []LogLine
	flush   *time.Timer

	// Where the lines are kept across restarts: the folder, once Persist
	// is called, and the sealed file, once SealTo is (logfile.go)
	dir  string
	file *logFile
}

// logFlushInterval is how often buffered lines are pushed to the frontend.
const logFlushInterval = 250 * time.Millisecond

// logMaxBatch caps one batch: past it only the newest lines are sent, as
// the frontend keeps a bounded tail anyway.
const logMaxBatch = 500

// NewLogTail constructs a tail with the given capacity.
func NewLogTail(capacity int) *LogTail {
	if capacity <= 0 {
		capacity = 1024
	}
	return &LogTail{cap: capacity, buf: make([]LogLine, 0, capacity)}
}

// Install replaces the root log handler with a GlogHandler that fans out to
// (a) stderr in the standard terminal format and (b) this ring buffer for
// the in-app Logs pane. Verbosity defaults to Info (level 3) — matching the
// CLI's default — and can be changed at runtime with SetVerbosity.
func (l *LogTail) Install() {
	tail := logging.FuncHandler(func(r *logging.Record) error {
		l.append(LogLine{
			Timestamp: r.Time.Unix(),
			Level:     r.Lvl.AlignedString(),
			Message:   formatRecord(r),
			Source:    recordSource(r),
		})
		return nil
	})
	stream := logging.StreamHandler(os.Stderr, logging.TerminalFormat(false))

	glogger := logging.NewGlogHandler(logging.MultiHandler(stream, tail))
	glogger.Verbosity(logging.LvlInfo)

	l.mu.Lock()
	l.glogger = glogger
	l.mu.Unlock()

	logging.Root().SetHandler(glogger)
}

// SetVerbosity changes the active log level. Valid values are 0 (silent)
// through 5 (trace); 3 is Info.
func (l *LogTail) SetVerbosity(level int) {
	l.mu.RLock()
	g := l.glogger
	l.mu.RUnlock()
	if g != nil {
		g.Verbosity(logging.Lvl(level))
	}
}

// Close releases the emitter so future log records aren't pushed to a dead
// frontend channel. The ring buffer continues to capture for any subsequent
// frontend reconnect.
func (l *LogTail) Close() {
	l.mu.Lock()
	if l.file != nil {
		l.file.close()
	}
	l.emitter = nil
	if l.flush != nil {
		l.flush.Stop()
		l.flush = nil
	}
	l.pending = nil
	l.mu.Unlock()
}

// SetEmitter installs a live-stream callback, called with batches of new
// lines at most every logFlushInterval. Pass nil to disable streaming.
func (l *LogTail) SetEmitter(fn func([]LogLine)) {
	l.mu.Lock()
	l.emitter = fn
	l.mu.Unlock()
}

// Clear forgets every line: the in-memory tail, any not yet sent to the
// frontend, and the file.
func (l *LogTail) Clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.buf = l.buf[:0]
	l.pending = nil
	if l.file != nil {
		l.file.clear()
	}
}

// Tail returns the most recent up to n log lines, oldest first. If n <= 0
// the entire buffer is returned.
func (l *LogTail) Tail(n int) []LogLine {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if n <= 0 || n > len(l.buf) {
		n = len(l.buf)
	}
	out := make([]LogLine, n)
	copy(out, l.buf[len(l.buf)-n:])
	return out
}

// appPackages is the prefix of this app's own Go packages, as a call
// site's function names them; anything else logged is the node's.
const appPackages = "github.com/ParallaxProtocol/parallax-gui"

// recordSource tells the app's own lines from the node's, by where the
// record was logged.
func recordSource(r *logging.Record) string {
	if strings.HasPrefix(r.Call.Frame().Function, appPackages) {
		return "app"
	}
	return "node"
}

// formatRecord renders a log record as "msg key=value key=value …", matching
// the layout the geth terminal handler uses (minus the timestamp and level,
// which travel as separate fields on LogLine). Without this, the in-app log
// pane would show "Imported new chain segment" with all the structured
// context — block numbers, tx counts, gas, etc. — silently dropped.
func formatRecord(r *logging.Record) string {
	if len(r.Ctx) == 0 {
		return r.Msg
	}
	var b strings.Builder
	// Pad the message a little so the key=value tail aligns the way the
	// terminal handler does. 40 columns matches geth's default.
	b.WriteString(r.Msg)
	for i := len(r.Msg); i < 40; i++ {
		b.WriteByte(' ')
	}
	for i := 0; i+1 < len(r.Ctx); i += 2 {
		if i > 0 {
			b.WriteByte(' ')
		}
		key, _ := r.Ctx[i].(string)
		if key == "" {
			key = "?"
		}
		b.WriteString(key)
		b.WriteByte('=')
		b.WriteString(formatValue(r.Ctx[i+1]))
	}
	return b.String()
}

// formatValue stringifies a context value, quoting it if it contains spaces
// or quotes — same heuristic the geth logfmt formatter uses, simplified.
func formatValue(v interface{}) string {
	if v == nil {
		return "nil"
	}
	if s, ok := v.(string); ok {
		if strings.ContainsAny(s, ` "=`) {
			return fmt.Sprintf("%q", s)
		}
		return s
	}
	if e, ok := v.(error); ok {
		return e.Error()
	}
	if s, ok := v.(fmt.Stringer); ok {
		return s.String()
	}
	return fmt.Sprintf("%v", v)
}

func (l *LogTail) append(line LogLine) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.buf) == l.cap {
		copy(l.buf, l.buf[1:])
		l.buf[l.cap-1] = line
	} else {
		l.buf = append(l.buf, line)
	}
	if l.file != nil {
		l.file.write(line)
	}
	if l.emitter == nil {
		return
	}
	l.pending = append(l.pending, line)
	if len(l.pending) > logMaxBatch {
		l.pending = l.pending[len(l.pending)-logMaxBatch:]
	}
	if l.flush == nil {
		l.flush = time.AfterFunc(logFlushInterval, l.emitPending)
	}
}

// emitPending sends the buffered lines as one batch.
func (l *LogTail) emitPending() {
	l.mu.Lock()
	lines, emitter := l.pending, l.emitter
	l.pending, l.flush = nil, nil
	l.mu.Unlock()
	if emitter != nil && len(lines) > 0 {
		emitter(lines)
	}
}
