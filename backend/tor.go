// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/logging"
)

// This file runs Tor for the app's Tor switch (GUIConfig.Tor): the Tor the
// app ships (desktop/scripts/fetch-tor.mjs puts it beside the backend),
// started and kept running while the switch is on, or one already running
// on this computer. The node dials its peers through Tor's SOCKS port
// (applyTorRoute, flags.go), and the app's own requests, the update check
// and the assistants' explorer and status page, go through it too
// (HTTPClient). Nothing falls back to a direct connection: while Tor isn't
// ready, the node doesn't start and requests fail.

// TorStatus is the Tor switch and how Tor is doing, for Settings and the
// Tor bar along the top of the window.
type TorStatus struct {
	Enabled   bool `json:"enabled"`
	OnionOnly bool `json:"onionOnly"`
	// Bundled says this build ships a Tor of its own; System that the Tor
	// running on this computer is used instead (chosen, or without one)
	Bundled bool `json:"bundled"`
	System  bool `json:"system"`
	// Version is the version of the Tor the app ships ("0.4.9.14"), empty
	// without one: the Tor on this computer's isn't known
	Version string `json:"version"`
	// State is "off", "starting", "ready" or "failed"
	State string `json:"state"`
	// Progress is Tor's bootstrap, 0 to 100, and Summary what it is doing
	// in its own words: the app's own Tor only
	Progress int    `json:"progress"`
	Summary  string `json:"summary"`
	// Reason says why it failed: "notFound" (no Tor running on this
	// computer), "exited" (the app's Tor stopped) or "start" (it couldn't
	// be started); Error the detail, Tor's last complaint
	Reason string `json:"reason"`
	Error  string `json:"error"`
	// SOCKS is Tor's SOCKS port while it's ready
	SOCKS string `json:"socks"`
	// Onion is the node's onion service, while it has one, and NodeRunning
	// and NodeBehind whether the node runs, and behind Tor: one started
	// before the switch was turned on goes behind it as it restarts
	// (App.TorStatus)
	Onion       string `json:"onion"`
	NodeRunning bool   `json:"nodeRunning"`
	NodeBehind  bool   `json:"nodeBehind"`
}

// torRoute is where a ready Tor is reached: its SOCKS port, and its control
// port with the password for it (empty for the app's own Tor, which the
// node opens with its cookie).
type torRoute struct {
	SOCKS, Control, Password string
}

const (
	// How long the node's start and the app's requests wait for Tor to be
	// ready; it takes seconds, minutes on a slow or filtered network
	torReadyTimeout = 3 * time.Minute
	// How often a missing Tor on this computer is looked for again
	torProbeInterval = 5 * time.Second
	// The app's own Tor, started again after it stops, after this at
	// first, doubling up to torRetryMax
	torRetryMin = 2 * time.Second
	torRetryMax = time.Minute
)

var (
	errTorOff      = errors.New("Tor is off")
	errTorNotFound = errors.New("no Tor is running on this computer (looked on 127.0.0.1:9050 and 127.0.0.1:9150)")
)

// torWant is what the config asks of Tor: whether it runs, and which.
type torWant struct {
	on     bool
	system bool
	// The SOCKS and control ports of the Tor on this computer, empty to
	// look for one on the usual ports, and its control password
	proxy, control, password string
}

// TorController runs Tor as the config asks. It is safe for concurrent use.
type TorController struct {
	dir string // Tor's own data, in the app's folder
	bin string // the Tor the app ships, "" in a build without one
	// version is that Tor's, asked once as the app starts
	version string

	applyMu sync.Mutex // one Apply at a time

	mu        sync.Mutex
	want      torWant
	onionOnly bool
	st        TorStatus
	route     torRoute
	run       *torRun       // what runs or looks for Tor; nil while off
	changed   chan struct{} // closed and replaced on every change of st
	emitter   func(TorStatus)
	onRoute   func() // Tor ready on a new route (rerouteNode, app.go)
	// The transports the app's requests go by, one per SOCKS port
	transports map[string]*http.Transport
}

// torRun is one spell of running or looking for Tor, ended by stop.
type torRun struct {
	quit chan struct{}
	done chan struct{}
}

func (r *torRun) stop() {
	close(r.quit)
	<-r.done
}

// NewTorController returns a controller keeping Tor's data under dir (the
// app's folder). Nothing runs until Apply turns it on.
func NewTorController(dir string) *TorController {
	t := &TorController{
		dir:        filepath.Join(dir, "tor"),
		bin:        bundledTor(),
		changed:    make(chan struct{}),
		transports: make(map[string]*http.Transport),
	}
	t.version = torVersion(t.bin)
	t.st = TorStatus{State: "off", Bundled: t.bin != "", Version: t.version}
	return t
}

// torVersionLine is how tor --version names itself: "Tor version 0.4.9.14."
var torVersionLine = regexp.MustCompile(`Tor version ([0-9][0-9A-Za-z.\-]*[0-9A-Za-z])`)

// torVersion asks a Tor its version, "" if there's none or it won't say.
func torVersion(bin string) string {
	if bin == "" {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--version")
	cmd.Dir = filepath.Dir(bin)
	cmd.Env = torEnv(bin)
	prepareTorCmd(cmd)
	out, err := cmd.Output()
	if err != nil {
		logging.Warn("Failed to read the bundled Tor's version", "err", err)
		return ""
	}
	if m := torVersionLine.FindSubmatch(out); m != nil {
		return string(m[1])
	}
	return ""
}

// bundledTor is the Tor the app ships, in a tor folder beside the backend,
// or "" if this build has none.
func bundledTor() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	name := "tor"
	if runtime.GOOS == "windows" {
		name = "tor.exe"
	}
	bin := filepath.Join(filepath.Dir(exe), "tor", name)
	if _, err := os.Stat(bin); err != nil {
		return ""
	}
	return bin
}

// SetEmitter installs the sink for status changes.
func (t *TorController) SetEmitter(fn func(TorStatus)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.emitter = fn
}

// SetRouteListener installs what runs when Tor is ready again on another
// port than before (the app's Tor started again on new ports, or another
// Tor found on this computer): the node, still dialing the old one, starts
// again on the new.
func (t *TorController) SetRouteListener(fn func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.onRoute = fn
}

// Apply starts, stops or switches Tor for the config g. An offline signer
// never goes online, so Tor doesn't run there either.
func (t *TorController) Apply(g GUIConfig) {
	t.applyMu.Lock()
	defer t.applyMu.Unlock()

	want := torWant{on: g.Tor && !g.OfflineSigner}
	if want.on {
		want.system = g.TorSystem || t.bin == ""
		if want.system {
			want.proxy = strings.TrimSpace(g.Proxy)
			want.control = strings.TrimSpace(g.TorControl)
			want.password = g.TorPassword
		}
	}

	t.mu.Lock()
	t.onionOnly = g.TorOnionOnly
	t.st.OnionOnly = g.TorOnionOnly
	if want == t.want {
		t.changedLocked()
		t.mu.Unlock()
		t.emit()
		return
	}
	old := t.run
	t.run = nil
	t.want = want
	t.mu.Unlock()
	if old != nil {
		old.stop()
	}

	t.mu.Lock()
	t.route = torRoute{}
	t.st = TorStatus{
		Enabled:   want.on,
		OnionOnly: t.onionOnly,
		Bundled:   t.bin != "",
		System:    want.system,
		Version:   t.version,
		State:     "off",
	}
	if want.on {
		t.st.State = "starting"
		r := &torRun{quit: make(chan struct{}), done: make(chan struct{})}
		t.run = r
		if want.system {
			go t.findSystem(r, want)
		} else {
			go t.runBundled(r)
		}
	}
	t.changedLocked()
	t.mu.Unlock()
	t.emit()
}

// Close stops Tor.
func (t *TorController) Close() {
	t.Apply(GUIConfig{})
}

// Enabled reports whether the Tor switch is on.
func (t *TorController) Enabled() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.want.on
}

// Status reports the switch and how Tor is doing.
func (t *TorController) Status() TorStatus {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.st
}

// Route waits for Tor to be ready, as long as ctx allows and at most
// torReadyTimeout, and returns where it is. It fails at once with the
// switch off, or Tor failed.
func (t *TorController) Route(ctx context.Context) (torRoute, error) {
	ctx, cancel := context.WithTimeout(ctx, torReadyTimeout)
	defer cancel()
	for {
		t.mu.Lock()
		st, route, changed := t.st, t.route, t.changed
		t.mu.Unlock()
		switch st.State {
		case "off":
			return torRoute{}, errTorOff
		case "ready":
			return route, nil
		case "failed":
			return torRoute{}, fmt.Errorf("Tor isn't connected: %s", st.Error)
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return torRoute{}, fmt.Errorf("Tor isn't connected yet (%d%%)", st.Progress)
		}
	}
}

// HTTPClient is the client the app's own requests go by: through Tor
// while the switch is on, waiting for Tor to be ready and failing if it
// isn't, never going out directly; directly while it's off.
func (t *TorController) HTTPClient() *http.Client {
	return &http.Client{Transport: torTransport{t}}
}

type torTransport struct{ t *TorController }

func (tt torTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if !tt.t.Enabled() {
		return http.DefaultTransport.RoundTrip(req)
	}
	route, err := tt.t.Route(req.Context())
	if err != nil {
		if req.Body != nil {
			req.Body.Close()
		}
		return nil, err
	}
	return tt.t.transport(route.SOCKS).RoundTrip(req)
}

// transport is the HTTP transport through the SOCKS port socks. Its
// credentials set the app's requests apart from the node's peers, onto
// circuits of their own (Tor isolates streams by SOCKS credentials); names
// are resolved by Tor, at the exit.
func (t *TorController) transport(socks string) *http.Transport {
	t.mu.Lock()
	defer t.mu.Unlock()
	if tr, ok := t.transports[socks]; ok {
		return tr
	}
	tr := &http.Transport{
		Proxy: http.ProxyURL(&url.URL{
			Scheme: "socks5h",
			Host:   socks,
			User:   url.UserPassword("parallax-wallet", "app"),
		}),
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        10,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 30 * time.Second,
	}
	t.transports[socks] = tr
	return tr
}

// emit sends the status to the emitter.
func (t *TorController) emit() {
	t.mu.Lock()
	fn, st := t.emitter, t.st
	t.mu.Unlock()
	if fn != nil {
		fn(st)
	}
}

// changedLocked wakes what waits on a change of the status. t.mu held.
func (t *TorController) changedLocked() {
	close(t.changed)
	t.changed = make(chan struct{})
}

// update changes the status with fn, if r still runs, and emits it.
func (t *TorController) update(r *torRun, fn func(st *TorStatus)) {
	t.mu.Lock()
	if t.run != r {
		t.mu.Unlock()
		return
	}
	fn(&t.st)
	t.changedLocked()
	t.mu.Unlock()
	t.emit()
}

// ready marks Tor ready on route, for r. A route other than the last one
// Tor was ready on tells the route listener.
func (t *TorController) ready(r *torRun, route torRoute, summary string) {
	t.mu.Lock()
	if t.run != r {
		t.mu.Unlock()
		return
	}
	moved := t.route.SOCKS != "" && t.route != route
	t.route = route
	t.st.State, t.st.Progress, t.st.Summary = "ready", 100, summary
	t.st.Reason, t.st.Error = "", ""
	t.st.SOCKS = route.SOCKS
	onRoute := t.onRoute
	t.changedLocked()
	t.mu.Unlock()
	t.emit()
	if moved && onRoute != nil {
		onRoute()
	}
}

// fail marks Tor failed for reason, for r.
func (t *TorController) fail(r *torRun, reason string, err error) {
	t.update(r, func(st *TorStatus) {
		st.State, st.Reason, st.Error, st.SOCKS = "failed", reason, err.Error(), ""
	})
}

// findSystem looks for the Tor running on this computer until r stops,
// again every torProbeInterval: ready while it answers, failed while not.
func (t *TorController) findSystem(r *torRun, want torWant) {
	defer close(r.done)
	for {
		route, err := systemTor(want)
		if err != nil {
			t.fail(r, "notFound", err)
		} else {
			t.ready(r, route, "")
		}
		select {
		case <-r.quit:
			return
		case <-time.After(torProbeInterval):
		}
	}
}

// systemTor finds the Tor running on this computer: at the SOCKS port the
// settings name, or else Tor's (9050) or Tor Browser's (9150), each with
// its control port beside it unless the settings name one.
func systemTor(want torWant) (torRoute, error) {
	candidates := []torRoute{{SOCKS: want.proxy, Control: want.control}}
	if want.proxy == "" {
		candidates = []torRoute{
			{SOCKS: "127.0.0.1:9050", Control: "127.0.0.1:9051"},
			{SOCKS: "127.0.0.1:9150", Control: "127.0.0.1:9151"},
		}
	}
	for _, c := range candidates {
		if err := probeSOCKS(c.SOCKS); err != nil {
			if want.proxy != "" {
				return torRoute{}, fmt.Errorf("no Tor answers on %s: %w", want.proxy, err)
			}
			continue
		}
		if want.control != "" {
			c.Control = want.control
		}
		c.Password = want.password
		return c, nil
	}
	return torRoute{}, errTorNotFound
}

// probeSOCKS checks that a SOCKS5 proxy answers at addr: it greets it,
// offering no authentication, and expects that accepted.
func probeSOCKS(addr string) error {
	conn, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write([]byte{5, 1, 0}); err != nil {
		return err
	}
	var rep [2]byte
	if _, err := io.ReadFull(conn, rep[:]); err != nil {
		return err
	}
	if rep[0] != 5 || rep[1] != 0 {
		return errors.New("not a SOCKS5 proxy")
	}
	return nil
}

// runBundled runs the app's Tor until r stops, starting it again whenever
// it stops by itself.
func (t *TorController) runBundled(r *torRun) {
	defer close(r.done)
	retry := torRetryMin
	for {
		reason, err := t.runTorOnce(r)
		select {
		case <-r.quit:
			return
		default:
		}
		logging.Warn("Tor stopped, starting it again", "err", err, "in", retry)
		t.fail(r, reason, err)
		select {
		case <-r.quit:
			return
		case <-time.After(retry):
		}
		retry = min(2*retry, torRetryMax)
	}
}

var (
	torLogLine   = regexp.MustCompile(`\[(debug|info|notice|warn|err)\] (.*)$`)
	torBootstrap = regexp.MustCompile(`^Bootstrapped (\d+)%(?: \([^)]*\))?: (.*)$`)
)

// runTorOnce starts the app's Tor on two free ports and follows its log
// until it exits or r stops. It returns why it ended: the reason for the
// status and what Tor last complained of.
func (t *TorController) runTorOnce(r *torRun) (string, error) {
	data := filepath.Join(t.dir, "data")
	if err := os.MkdirAll(data, 0o700); err != nil {
		return "start", err
	}
	socks, err := torPort()
	if err != nil {
		return "start", err
	}
	control, err := torPort()
	if err != nil {
		return "start", err
	}
	// No torrc: everything is on the command line, the files named
	// left missing so that none on this computer is read
	args := []string{
		"-f", filepath.Join(t.dir, "torrc"),
		"--defaults-torrc", filepath.Join(t.dir, "torrc-defaults"),
		"--ignore-missing-torrc",
		"--DataDirectory", data,
		"--SocksPort", socks,
		"--ControlPort", control,
		"--CookieAuthentication", "1",
		"--ClientOnly", "1",
		"--AvoidDiskWrites", "1",
		"--DormantCanceledByStartup", "1",
		"--Log", "notice stdout",
		// Tor exits on its own if the backend does, never left behind
		"--__OwningControllerProcess", strconv.Itoa(os.Getpid()),
	}
	cmd := exec.Command(t.bin, args...)
	cmd.Dir = filepath.Dir(t.bin)
	cmd.Env = torEnv(t.bin)
	prepareTorCmd(cmd)
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	if err := cmd.Start(); err != nil {
		return "start", fmt.Errorf("start Tor: %w", err)
	}
	logging.Info("Started Tor", "pid", cmd.Process.Pid, "socks", socks)
	t.update(r, func(st *TorStatus) {
		st.State, st.Progress, st.Summary, st.Reason, st.Error, st.SOCKS = "starting", 0, "", "", "", ""
	})

	var waitErr error
	exited := make(chan struct{})
	go func() {
		waitErr = cmd.Wait()
		pw.Close()
		close(exited)
	}()
	go func() {
		select {
		case <-r.quit:
			stopTor(cmd.Process, exited)
		case <-exited:
		}
	}()

	// Tor's log, line by line: its bootstrap into the status, its warnings
	// and errors into the app's log
	route := torRoute{SOCKS: socks, Control: control}
	var complaint string
	sc := bufio.NewScanner(pr)
	for sc.Scan() {
		m := torLogLine.FindStringSubmatch(sc.Text())
		if m == nil {
			continue
		}
		level, msg := m[1], m[2]
		switch level {
		case "warn":
			logging.Warn("Tor: " + msg)
			complaint = msg
		case "err":
			logging.Error("Tor: " + msg)
			complaint = msg
		default:
			logging.Debug("Tor: " + msg)
		}
		if b := torBootstrap.FindStringSubmatch(msg); b != nil {
			pct, _ := strconv.Atoi(b[1])
			if pct >= 100 {
				logging.Info("Tor is ready", "socks", socks)
				t.ready(r, route, b[2])
				continue
			}
			t.update(r, func(st *TorStatus) {
				st.State, st.Progress, st.Summary = "starting", pct, b[2]
			})
		}
	}
	io.Copy(io.Discard, pr)
	<-exited
	if complaint != "" {
		return "exited", errors.New(complaint)
	}
	if waitErr != nil {
		return "exited", fmt.Errorf("Tor exited: %w", waitErr)
	}
	return "exited", errors.New("Tor exited")
}

// torPort is a free port on the loopback interface, for Tor to listen on.
func torPort() (string, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	defer l.Close()
	return l.Addr().String(), nil
}

// torEnv is the environment Tor runs in: Linux finds its libraries, which
// the bundle keeps beside it, by LD_LIBRARY_PATH (macOS's name their
// folder, and Windows' are linked in).
func torEnv(bin string) []string {
	env := os.Environ()
	if runtime.GOOS != "linux" {
		return env
	}
	libs := filepath.Dir(bin)
	for i, kv := range env {
		if v, ok := strings.CutPrefix(kv, "LD_LIBRARY_PATH="); ok {
			env[i] = "LD_LIBRARY_PATH=" + libs + string(os.PathListSeparator) + v
			return env
		}
	}
	return append(env, "LD_LIBRARY_PATH="+libs)
}
