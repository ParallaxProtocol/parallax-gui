.PHONY: prlx-gui prlx-gui-cross prlx-gui-package clean

LDFLAGS   ?= -s -w
VERSION   ?= $(shell git describe --tags --always --dirty 2>/dev/null)

# Build tags applied to every Parallax Desktop build:
#
#   * embedfrontend — compiles the real go:embed of frontend/dist (see
#     embed.go). Without this tag the build falls back to an empty
#     embed.FS stub so plain `go test ./...` from CI doesn't fail on a
#     fresh checkout where frontend/dist hasn't been populated yet.
#   * webkit2_41   — selects the modern WebKit2GTK ABI on Linux. Wails
#     2.x defaults to 4.0 but Arch and recent Debian/Ubuntu only ship
#     4.1. Harmless on macOS / Windows.
#
# Override with `make prlx-gui WAILS_TAGS=` to opt out of either.
WAILS_TAGS ?= embedfrontend webkit2_41
HASHWARP_BIN ?= $(shell which hashwarp 2>/dev/null)
HASHWARP_DIR ?=

SHELL := /bin/bash

# Wails generates JS bindings BEFORE running `npm run build`, and the
# binding generator compiles every Go file in the package — including
# embed.go's `//go:embed all:frontend/dist`. On a fresh checkout (or
# after `make clean`) frontend/dist is empty and the embed directive
# errors out before vite ever gets a chance to populate it. Touching a
# placeholder file satisfies the embed pattern for the binding step;
# vite then wipes the dir and writes the real assets in time for the
# final Go compile.
GUI_DIST_PLACEHOLDER := frontend/dist/.gitkeep

$(GUI_DIST_PLACEHOLDER):
	@mkdir -p $(dir $@)
	@touch $@

prlx-gui: $(GUI_DIST_PLACEHOLDER)
	@command -v wails >/dev/null 2>&1 || { \
	  echo "wails CLI not found. Install with:"; \
	  echo "  go install github.com/wailsapp/wails/v2/cmd/wails@latest"; \
	  exit 1; \
	}
	wails build -clean -tags "$(WAILS_TAGS)" -ldflags "$(LDFLAGS) -X github.com/ParallaxProtocol/parallax-gui/backend.GUIVersion=$(VERSION)"
	@if [ -n "$(HASHWARP_BIN)" ] && [ -f "$(HASHWARP_BIN)" ]; then \
	  cp "$(HASHWARP_BIN)" build/bin/hashwarp; \
	  echo "  Bundled hashwarp from $(HASHWARP_BIN)"; \
	fi
	@echo "Done building Parallax Desktop."
	@echo "Binary in build/bin/"

prlx-gui-cross: $(GUI_DIST_PLACEHOLDER)
	@command -v wails >/dev/null 2>&1 || { \
	  echo "wails CLI not found. Install with:"; \
	  echo "  go install github.com/wailsapp/wails/v2/cmd/wails@latest"; \
	  exit 1; \
	}
	wails build -clean -tags "$(WAILS_TAGS)" -platform linux/amd64,linux/arm64,darwin/amd64,darwin/arm64,windows/amd64 -ldflags "$(LDFLAGS) -X github.com/ParallaxProtocol/parallax-gui/backend.GUIVersion=$(VERSION)"
	@echo "Done cross-building Parallax Desktop."

# prlx-gui-package builds the desktop GUI for every entry in GUI_TARGETS
# and stages the platform artifact (portable .exe on Windows; the AppImage
# and DMG are built separately by CI) into PACKAGEDIR.
GUI_TARGETS ?= linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

REPO_ROOT  := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
PACKAGEDIR ?= $(REPO_ROOT)build/package

prlx-gui-package:
	@command -v wails >/dev/null 2>&1 || { \
	  echo "wails CLI not found. Install with:"; \
	  echo "  go install github.com/wailsapp/wails/v2/cmd/wails@latest"; \
	  exit 1; \
	}
	@set -euo pipefail; \
	REPO_ROOT="$(REPO_ROOT)"; \
	PACKAGEDIR="$(PACKAGEDIR)"; \
	GUI_BIN="$$REPO_ROOT/build/bin"; \
	mkdir -p "$$PACKAGEDIR"; \
	for t in $(GUI_TARGETS); do \
	  os="$${t%/*}"; \
	  arch="$${t#*/}"; \
	  echo "==> wails build for $$os/$$arch"; \
	  rm -rf "$$GUI_BIN"; \
	  mkdir -p "$$REPO_ROOT/frontend/dist"; \
	  touch  "$$REPO_ROOT/frontend/dist/.gitkeep"; \
	  if ! ( cd "$$REPO_ROOT" && wails build -clean -tags "$(WAILS_TAGS)" -platform "$$t" -ldflags "$(LDFLAGS) -X github.com/ParallaxProtocol/parallax-gui/backend.GUIVersion=$(VERSION)" ); then \
	    echo "   !! skipped $$os/$$arch (wails build failed — usually missing native toolchain)"; \
	    continue; \
	  fi; \
	  if [ -n "$(HASHWARP_DIR)" ]; then \
	    hwbin="$(HASHWARP_DIR)/hashwarp-$$os-$$arch"; \
	    [ "$$os" = "windows" ] && hwbin="$$hwbin.exe"; \
	    if [ -f "$$hwbin" ]; then \
	      hwdst="$$GUI_BIN/hashwarp"; \
	      [ "$$os" = "windows" ] && hwdst="$$hwdst.exe"; \
	      cp "$$hwbin" "$$hwdst"; \
	      echo "   Bundled hashwarp for $$os/$$arch"; \
	    else \
	      echo "   WARNING: hashwarp not found at $$hwbin — GPU mining unavailable"; \
	    fi; \
	  fi; \
	  if [ ! -d "$$GUI_BIN" ] || [ -z "$$(ls -A "$$GUI_BIN" 2>/dev/null)" ]; then \
	    echo "   !! skipped $$os/$$arch (no output in build/bin)"; \
	    continue; \
	  fi; \
	  disparch="$$arch"; \
	  [ "$$disparch" = "amd64" ] && disparch="x86_64"; \
	  dispos="$$os"; \
	  [ "$$dispos" = "darwin" ] && dispos="macos"; \
	  bundle="Parallax-Client-$(VERSION)-$$dispos-$$disparch"; \
	  if [ "$$os" = "windows" ]; then \
	    cp "$$GUI_BIN/Parallax Client.exe" "$$PACKAGEDIR/$${bundle}.exe"; \
	    echo "-> Copied portable $${bundle}.exe"; \
	  fi; \
	done; \
	echo "GUI bundles in $$PACKAGEDIR/"

clean:
	rm -fr build/bin build/package
