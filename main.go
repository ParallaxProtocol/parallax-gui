// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.
//
// prlx-gui is a desktop application that embeds a Parallax full node and
// exposes a friendly user interface for running the node, managing a wallet,
// sending transactions and (optionally) mining.
package main

import (
	_ "embed"
	"log"
	"os"
	"runtime"
	"strings"

	// Side-effect imports — register the JS and native tracer factories
	// so debug_traceTransaction / debug_traceCall and friends actually
	// have tracers available over RPC. cmd/parallaxd does the same thing in
	// cmd/parallaxd/main.go; without these the tracer namespace registers but
	// every call returns "tracer not found".
	_ "github.com/ParallaxProtocol/parallax/v2/node/fullnode/tracers/js"
	_ "github.com/ParallaxProtocol/parallax/v2/node/fullnode/tracers/native"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

// isBrokenWaylandCompositor reports whether the current session runs on
// a compositor that's known to crash WebKitGTK in compositing mode. The
// list is intentionally narrow — every entry here costs the user GPU
// acceleration on the dashboard, so we only add a compositor when we
// have an actual reproduction.
// webkitAtLeast reports whether the linked WebKitGTK is at least
// major.minor. Unknown (non-Linux builds, or version probe unavailable)
// counts as "older" so conservative workarounds stay in place.
func webkitAtLeast(major, minor uint) bool {
	gotMajor, gotMinor := webkitVersion()
	if gotMajor == 0 {
		return false
	}
	return gotMajor > major || (gotMajor == major && gotMinor >= minor)
}

func isBrokenWaylandCompositor() bool {
	if os.Getenv("HYPRLAND_INSTANCE_SIGNATURE") != "" {
		return true
	}
	desktop := strings.ToLower(os.Getenv("XDG_CURRENT_DESKTOP"))
	if strings.Contains(desktop, "hyprland") {
		return true
	}
	return false
}

// isWayland reports whether GTK will talk to a Wayland display (the
// default when WAYLAND_DISPLAY is set, unless GDK_BACKEND pins another
// backend such as x11).
func isWayland() bool {
	if os.Getenv("WAYLAND_DISPLAY") == "" {
		return false
	}
	backend := os.Getenv("GDK_BACKEND")
	return backend == "" || strings.HasPrefix(backend, "wayland")
}

// nvidiaDriverLoaded reports whether the NVIDIA proprietary kernel driver
// is loaded. Nouveau does not create /proc/driver/nvidia.
func nvidiaDriverLoaded() bool {
	_, err := os.Stat("/proc/driver/nvidia/version")
	return err == nil
}

// appIcon is the master PNG used as the window/taskbar icon on Linux at
// runtime. On Windows the icon is supplied by build/windows/icon.ico (which
// wails embeds into the .exe via rsrc) and on macOS wails auto-generates
// build/darwin/icons.icns from this same file during `wails build`, so this
// embed only matters for the Linux side of the build.
//
//go:embed build/appicon.png
var appIcon []byte

func main() {
	// GPU rendering tuning. WebKitGTK supports a hardware-accelerated
	// compositor that can lift CSS animations / transforms / SVG paint
	// onto the GPU; without it everything is software-rasterised on the
	// CPU and complex pages cap at well under
	// 60fps. Defaults below assume the GPU path is wanted.
	//
	// The exception is a small set of Wayland compositors that hit
	// known WebKitGTK protocol bugs (Hyprland in particular) and crash
	// the renderer when compositing is on. The crash we reproduced was
	// on WebKitGTK < 2.52; 2.52.5 was verified to start and composite
	// fine on Hyprland (2026-08), so the workaround only applies to
	// older library versions. Users can override either way by setting
	// WEBKIT_DISABLE_COMPOSITING_MODE explicitly.
	if runtime.GOOS == "linux" {
		if _, ok := os.LookupEnv("WEBKIT_DISABLE_COMPOSITING_MODE"); !ok {
			if isBrokenWaylandCompositor() && !webkitAtLeast(2, 52) {
				os.Setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
			}
		}
		// Force-enable the DMA-BUF renderer when available — it's the
		// fastest path on modern WebKitGTK because it lets the
		// compositor share GPU buffers with the host display server
		// without an intermediate copy. Skip if the user already
		// chose a value.
		//
		// The exception is Wayland on the NVIDIA proprietary driver:
		// there the DMA-BUF renderer dies with "Error 71 (Protocol
		// error) dispatching to Wayland display" right after the
		// window maps (reproduced 2026-10 on Hyprland + RTX 4090 +
		// WebKitGTK 2.54.1, with or without the force flag), so turn
		// it off and let WebKit fall back to its shared-memory path.
		_, forceSet := os.LookupEnv("WEBKIT_FORCE_DMABUF_RENDERER")
		_, disableSet := os.LookupEnv("WEBKIT_DISABLE_DMABUF_RENDERER")
		if !forceSet && !disableSet {
			if isWayland() && nvidiaDriverLoaded() {
				os.Setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
			} else {
				os.Setenv("WEBKIT_FORCE_DMABUF_RENDERER", "1")
			}
		}
		// Skip the complex-text shaper for plain Latin glyphs. Tiny
		// per-frame win, but free.
		if _, ok := os.LookupEnv("WEBKIT_FORCE_COMPLEX_TEXT"); !ok {
			os.Setenv("WEBKIT_FORCE_COMPLEX_TEXT", "0")
		}
	}

	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Parallax Desktop",
		Width:     1280,
		Height:    820,
		MinWidth:  1024,
		MinHeight: 700,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 16, G: 14, B: 24, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Linux: &linux.Options{
			Icon:                appIcon,
			WindowIsTranslucent: false,
			ProgramName:         "Parallax Desktop",
		},
	})
	if err != nil {
		log.Fatalf("prlx-gui: %v", err)
	}
}
