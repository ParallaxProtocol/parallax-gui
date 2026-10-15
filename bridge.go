// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"reflect"
	"sync"
	"time"
	"unicode"
)

// The bridge is how the Electron shell talks to the backend: a loopback
// HTTP server, guarded by a random token only the shell knows.
//
//   POST /call    {"method": "NodeStatus", "args": [...]}
//                 → {"result": ...} or {"error": "..."}
//   GET  /events  server-sent events, one per backend event:
//                 "event: <name>\ndata: <json>\n\n"
//
// Calls dispatch by reflection to the exported methods of *App, so the
// frontend's api.ts keeps calling the same method names it always has.

// event is one backend event on its way to the shell.
type event struct {
	Name string
	Data []byte
}

// hub fans events out to every connected /events stream.
type hub struct {
	mu   sync.Mutex
	subs map[chan event]struct{}
}

func newHub() *hub { return &hub{subs: make(map[chan event]struct{})} }

// emit sends an event to every subscriber. A subscriber that has fallen
// behind loses the event rather than blocking the backend.
func (h *hub) emit(name string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- event{Name: name, Data: data}:
		default:
		}
	}
}

func (h *hub) subscribe() chan event {
	ch := make(chan event, 256)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *hub) unsubscribe(ch chan event) {
	h.mu.Lock()
	delete(h.subs, ch)
	h.mu.Unlock()
}

// bridge serves the App to the shell.
type bridge struct {
	app     *App
	hub     *hub
	token   string
	methods map[string]reflect.Value
}

func newBridge(app *App, h *hub) (*bridge, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	b := &bridge{app: app, hub: h, token: hex.EncodeToString(raw), methods: map[string]reflect.Value{}}
	v := reflect.ValueOf(app)
	t := v.Type()
	for i := 0; i < t.NumMethod(); i++ {
		m := t.Method(i)
		if unicode.IsUpper(rune(m.Name[0])) {
			b.methods[m.Name] = v.Method(i)
		}
	}
	return b, nil
}

// listen starts serving on a free loopback port and returns it.
func (b *bridge) listen(ctx context.Context) (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/call", b.authed(b.handleCall))
	mux.HandleFunc("/events", b.authed(b.handleEvents))
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	go func() { _ = srv.Serve(ln) }()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func (b *bridge) authed(next http.HandlerFunc) http.HandlerFunc {
	want := []byte("Bearer " + b.token)
	return func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), want) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

type callRequest struct {
	Method string            `json:"method"`
	Args   []json.RawMessage `json:"args"`
}

// Result is never omitted: false, 0 and "" are answers too.
type callResponse struct {
	Result interface{} `json:"result"`
	Error  string      `json:"error,omitempty"`
}

var errorType = reflect.TypeOf((*error)(nil)).Elem()

// secretMethods are the calls that carry a password, a recovery phrase or a
// key, in their arguments or their result. Each is decoded, run and its
// response encoded under erasing, which wipes what it leaves in memory
// (secret_erase.go).
var secretMethods = map[string]bool{
	"AssistantApprove":       true,
	"MessageSign":            true,
	"MessageSignRequest":     true,
	"OfflineSignRequest":     true,
	"WalletAddSeedAccounts":  true,
	"WalletBackup":           true,
	"WalletChangePassword":   true,
	"WalletCreate":           true,
	"WalletCreateSeed":       true,
	"WalletCreateSeedWords":  true,
	"WalletDeriveAccount":    true,
	"WalletImportKeyfile":    true,
	"WalletImportPrivateKey": true,
	"WalletImportSeed":       true,
	"WalletNewSeedWords":     true,
	"WalletRemove":           true,
	"WalletRemoveSeed":       true,
	"WalletReplace":          true,
	"WalletRevealSeed":       true,
	"WalletScanSeed":         true,
	"WalletScanWalletSeed":   true,
	"WalletSend":             true,
	"WalletSetupPassword":    true,
}

func (b *bridge) handleCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := readBody(http.MaxBytesReader(w, r.Body, maxCallBytes), r.ContentLength)
	// Passwords and phrases arrive in it
	defer clear(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, callResponse{Error: "bad request: " + err.Error()})
		return
	}
	// The method alone first, to tell whether the call is a secret one
	var head struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal(body, &head); err != nil {
		writeJSON(w, http.StatusBadRequest, callResponse{Error: "bad request: " + err.Error()})
		return
	}
	var status int
	var out []byte
	respond := func() { status, out = b.respond(body) }
	if secretMethods[head.Method] {
		erasing(respond)
	} else {
		respond()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(out)
}

// maxCallBytes bounds a call's request body.
const maxCallBytes = 1 << 20

// readBody reads a request body into one buffer, sized up front from its
// Content-Length when it has one, so that no smaller copy is left behind
// unwiped as the buffer grows.
func readBody(r io.Reader, length int64) ([]byte, error) {
	if length < 0 || length > maxCallBytes {
		return io.ReadAll(r)
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		clear(buf)
		return nil, err
	}
	return buf, nil
}

// respond decodes a call, runs it and encodes its response.
func (b *bridge) respond(body []byte) (int, []byte) {
	var req callRequest
	resp := callResponse{}
	status := http.StatusOK
	if err := json.Unmarshal(body, &req); err != nil {
		status, resp.Error = http.StatusBadRequest, "bad request: "+err.Error()
	} else if result, err := b.call(req.Method, req.Args); err != nil {
		resp.Error = err.Error()
	} else {
		resp.Result = result
	}
	out, err := json.Marshal(resp)
	if err != nil {
		return http.StatusInternalServerError, []byte(`{"result":null,"error":"unencodable result"}`)
	}
	return status, append(out, '\n')
}

// call invokes App.<method> with JSON-decoded arguments. Methods return
// nothing, a value, an error, or a value and an error.
func (b *bridge) call(name string, rawArgs []json.RawMessage) (result interface{}, err error) {
	m, ok := b.methods[name]
	if !ok {
		return nil, fmt.Errorf("unknown method %q", name)
	}
	mt := m.Type()
	if len(rawArgs) != mt.NumIn() {
		return nil, fmt.Errorf("%s takes %d arguments, got %d", name, mt.NumIn(), len(rawArgs))
	}
	args := make([]reflect.Value, mt.NumIn())
	for i := range args {
		p := reflect.New(mt.In(i))
		if err := json.Unmarshal(rawArgs[i], p.Interface()); err != nil {
			return nil, fmt.Errorf("%s argument %d: %w", name, i, err)
		}
		args[i] = p.Elem()
	}
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("%s panicked: %v", name, r)
		}
	}()
	out := m.Call(args)
	for _, v := range out {
		if v.Type().Implements(errorType) {
			if !v.IsNil() {
				return nil, v.Interface().(error)
			}
			continue
		}
		result = v.Interface()
	}
	return result, nil
}

func (b *bridge) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	ch := b.hub.subscribe()
	defer b.hub.unsubscribe(ch)
	// A comment line at once, so the shell knows the stream is open
	fmt.Fprint(w, ": open\n\n")
	flusher.Flush()
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case ev := <-ch:
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data)
			flusher.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
