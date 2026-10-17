package backend

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// TestApplyTorRoute checks that the Tor switch puts the node behind Tor:
// its peers through the SOCKS port, its onion service through the control
// port, no NAT mapping, and its listener on the loopback interface only.
func TestApplyTorRoute(t *testing.T) {
	g := defaultGUIConfig()
	g.DataDir = t.TempDir()
	g.Tor = true
	g.OnionProxy = "127.0.0.1:9999"
	nodeCfg, _, err := buildConfigs(g)
	if err != nil {
		t.Fatal(err)
	}
	route := torRoute{SOCKS: "127.0.0.1:40001", Control: "127.0.0.1:40002"}
	if err := applyTorRoute(g, route, &nodeCfg.P2P); err != nil {
		t.Fatal(err)
	}
	p := nodeCfg.P2P
	if p.ProxyAddr != route.SOCKS || p.OnionProxyAddr != "" || p.TorControlAddr != route.Control || p.TorPassword != "" {
		t.Errorf("route not applied: proxy %q onion %q control %q", p.ProxyAddr, p.OnionProxyAddr, p.TorControlAddr)
	}
	if p.NAT != nil {
		t.Errorf("NAT mapping left on: %v", p.NAT)
	}
	if p.ListenAddr != "127.0.0.1:32110" {
		t.Errorf("listener on %q, want the loopback interface", p.ListenAddr)
	}
	if !p.ListenOnion || len(p.OnlyNet) != 0 {
		t.Errorf("onion service %v, only %v: want the service, every network", p.ListenOnion, p.OnlyNet)
	}

	g.TorOnionOnly = true
	if err := applyTorRoute(g, route, &nodeCfg.P2P); err != nil {
		t.Fatal(err)
	}
	if strings.Join(nodeCfg.P2P.OnlyNet, ",") != "onion" {
		t.Errorf("onion only dials %v", nodeCfg.P2P.OnlyNet)
	}
}

// fakeSOCKS answers a SOCKS5 greeting as Tor does, then closes; it returns
// its address.
func fakeSOCKS(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			var hello [3]byte
			if _, err := io.ReadFull(c, hello[:]); err == nil {
				c.Write([]byte{5, 0})
			}
			c.Close()
		}
	}()
	return l.Addr().String()
}

// closedPort is a loopback address nothing listens on.
func closedPort(t *testing.T) string {
	t.Helper()
	addr, err := torPort()
	if err != nil {
		t.Fatal(err)
	}
	return addr
}

// TestTorSystem checks the Tor on this computer: found at the SOCKS port
// the settings name, with the control port they name, and failed, at
// once, where none answers.
func TestTorSystem(t *testing.T) {
	socks := fakeSOCKS(t)
	tc := NewTorController(t.TempDir())
	defer tc.Close()
	tc.Apply(GUIConfig{Tor: true, TorSystem: true, Proxy: socks, TorControl: "127.0.0.1:9", TorPassword: "pw"})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	route, err := tc.Route(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if route != (torRoute{SOCKS: socks, Control: "127.0.0.1:9", Password: "pw"}) {
		t.Errorf("route %+v", route)
	}
	if st := tc.Status(); st.State != "ready" || !st.Enabled || !st.System || st.SOCKS != socks {
		t.Errorf("status %+v", st)
	}

	tc.Apply(GUIConfig{Tor: true, TorSystem: true, Proxy: closedPort(t)})
	if _, err := tc.Route(ctx); err == nil {
		t.Fatal("route to a Tor that isn't there")
	}
	if st := tc.Status(); st.State != "failed" || st.Reason != "notFound" {
		t.Errorf("status %+v, want failed, not found", st)
	}

	tc.Apply(GUIConfig{})
	if _, err := tc.Route(ctx); err != errTorOff {
		t.Errorf("route with the switch off: %v", err)
	}
	if st := tc.Status(); st.State != "off" || st.Enabled {
		t.Errorf("status %+v, want off", st)
	}
}

// TestTorHTTPFailsClosed checks that with the switch on and Tor not
// there, the app's requests fail rather than go out directly, and go
// directly again with it off.
func TestTorHTTPFailsClosed(t *testing.T) {
	var direct int
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { direct++ })}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(l)
	defer srv.Close()
	url := "http://" + l.Addr().String() + "/"

	tc := NewTorController(t.TempDir())
	defer tc.Close()
	hc := tc.HTTPClient()
	tc.Apply(GUIConfig{Tor: true, TorSystem: true, Proxy: closedPort(t)})
	// The first look for Tor runs in the background: wait for its answer
	deadline := time.Now().Add(5 * time.Second)
	for tc.Status().State == "starting" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if resp, err := hc.Get(url); err == nil {
		resp.Body.Close()
		t.Fatal("request went out with Tor on and not there")
	}
	if direct != 0 {
		t.Fatalf("%d requests reached the server directly", direct)
	}

	tc.Apply(GUIConfig{})
	resp, err := hc.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if direct != 1 {
		t.Errorf("%d requests with Tor off, want 1", direct)
	}
}

// TestTorChangedStatus checks that the peers setting shows with the switch off.
func TestTorChangedStatus(t *testing.T) {
	tc := NewTorController(t.TempDir())
	defer tc.Close()
	tc.Apply(GUIConfig{TorOnionOnly: true})
	if st := tc.Status(); st.State != "off" || !st.OnionOnly {
		t.Errorf("status %+v, want off and onion only", st)
	}
}

// TestTorBundled runs a real Tor, PARALLAX_TOR_BIN (make tor puts one in
// build/backend/<os>-<arch>/tor), and asks the Tor Project through it
// whether the request came over Tor. It needs the network, so it runs only
// when given one.
func TestTorBundled(t *testing.T) {
	bin := os.Getenv("PARALLAX_TOR_BIN")
	if bin == "" {
		t.Skip("PARALLAX_TOR_BIN not set")
	}
	tc := NewTorController(t.TempDir())
	tc.bin = bin
	defer tc.Close()
	tc.Apply(GUIConfig{Tor: true})
	ctx, cancel := context.WithTimeout(context.Background(), torReadyTimeout)
	defer cancel()
	if _, err := tc.Route(ctx); err != nil {
		t.Fatal(err)
	}
	resp, err := tc.HTTPClient().Get("https://check.torproject.org/api/ip")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"IsTor":true`) {
		t.Errorf("not over Tor: %s", body)
	}
	if st := tc.Status(); st.State != "ready" || st.System || st.Progress != 100 {
		t.Errorf("status %+v", st)
	}
	// Stopped, its process is gone and the switch reads off
	tc.Apply(GUIConfig{})
	if st := tc.Status(); st.State != "off" {
		t.Errorf("status %+v after stopping", st)
	}
}

// TestTorVersion checks that the shipped Tor's version is read from what
// tor --version says, and that a missing Tor or one that won't say gives
// none.
func TestTorVersion(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a shell script stands in for tor")
	}
	dir := t.TempDir()
	fake := filepath.Join(dir, "tor")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho 'Tor version 0.4.9.14.'\necho 'This build of Tor is covered by the GNU General Public License'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := torVersion(fake); got != "0.4.9.14" {
		t.Fatalf("torVersion = %q, want 0.4.9.14", got)
	}
	if got := torVersion(""); got != "" {
		t.Fatalf("torVersion(none) = %q", got)
	}
	mute := filepath.Join(dir, "mute")
	if err := os.WriteFile(mute, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := torVersion(mute); got != "" {
		t.Fatalf("torVersion(failing) = %q", got)
	}
}
