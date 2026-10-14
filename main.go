// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.
//
// parallax-backend is the engine of Parallax Desktop: it embeds a Parallax
// full node and the updater, and serves them to the Electron shell
// (desktop/) over a token-guarded loopback bridge (bridge.go). The shell starts it, reads the handshake line it prints, and
// stops it on quit.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	// Side-effect imports — register the JS and native tracer factories
	// so debug_traceTransaction / debug_traceCall and friends actually
	// have tracers available over RPC. cmd/parallaxd does the same thing in
	// cmd/parallaxd/main.go; without these the tracer namespace registers but
	// every call returns "tracer not found".
	_ "github.com/ParallaxProtocol/parallax/v2/node/fullnode/tracers/js"
	_ "github.com/ParallaxProtocol/parallax/v2/node/fullnode/tracers/native"
)

// handshakePrefix starts the one line the backend writes to stdout, which
// tells the shell where the bridge listens and the token it takes. Logs go
// to stderr, so nothing else is written to stdout.
const handshakePrefix = "PARALLAX_BACKEND "

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Stop on a signal, or when the shell goes away: it holds our stdin
	// open, so EOF means it has exited (even if it crashed and sent no
	// signal), and the node must not run on without a window.
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		select {
		case <-sigs:
		case <-ctx.Done():
		}
		cancel()
	}()
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		cancel()
	}()

	events := newHub()
	app := NewApp(events)
	app.startup(ctx)

	br, err := newBridge(app, events)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parallax-backend: %v\n", err)
		os.Exit(1)
	}
	port, err := br.listen(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parallax-backend: listen: %v\n", err)
		os.Exit(1)
	}
	hello, _ := json.Marshal(map[string]interface{}{"port": port, "token": br.token})
	fmt.Fprintf(os.Stdout, "%s%s\n", handshakePrefix, hello)

	<-ctx.Done()
	// Stops the node, flushing the chain database
	app.shutdown(context.Background())
}
