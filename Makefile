.PHONY: backend tor frontend desktop-deps prlx-gui prlx-gui-package dev clean

SHELL := /bin/bash

LDFLAGS ?= -s -w
# The commit of the Parallax client the app embeds, from its module's origin,
# for the version the app shows (empty if the module cache can't say)
DAEMON_COMMIT := $(shell go mod download -json $$(go list -m github.com/ParallaxProtocol/parallax/v2 | tr ' ' @) 2>/dev/null | sed -n 's/.*"Hash": "\([0-9a-f]*\)".*/\1/p' | head -n1)
# A plain x.y.z: electron-builder and the in-app updater both compare it
VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo 0.0.0)
ifeq ($(strip $(VERSION)),)
VERSION := 0.0.0
endif

# The platform to build for, in Go's terms; defaults to this machine.
GOOS   ?= $(shell go env GOOS)
GOARCH ?= $(shell go env GOARCH)

# The same platform in electron-builder's terms (${os}-${arch} in
# desktop/electron-builder.yml), and the architecture as release artifact
# names spell it.
EB_OS        := $(if $(filter darwin,$(GOOS)),mac,$(if $(filter windows,$(GOOS)),win,linux))
EB_ARCH      := $(if $(filter amd64,$(GOARCH)),x64,$(GOARCH))
DISPLAY_ARCH := $(if $(filter amd64,$(GOARCH)),x86_64,$(GOARCH))
EB_PLATFORM  := $(if $(filter darwin,$(GOOS)),--mac,$(if $(filter windows,$(GOOS)),--win,--linux))

BACKEND_DIR := build/backend/$(EB_OS)-$(EB_ARCH)
# runtime/secret, which wipes what the bridge's secret calls leave in
# memory (secret_erase.go), is a Go experiment that erases only on Linux
# so far; elsewhere the backend builds without it.
GOEXPERIMENT_FLAGS := $(if $(filter linux,$(GOOS)),runtimesecret,)
BACKEND_EXE := parallax-backend$(if $(filter windows,$(GOOS)),.exe,)

# The backend reaches Ledgers and Trezors through the daemon's USB
# library, C (hidapi and libusb) built with cgo: it needs a C compiler for
# the platform built for, so a build for another one takes CGO=0, without
# hardware wallets.
CGO ?= 1
# On Linux it is linked statically, glibc too, so it runs on systems older
# than the one that built it, as a pure Go build did; netgo and osusergo
# keep the resolver and user lookups out of glibc's NSS, which can't be.
ifeq ($(GOOS)$(CGO),linux1)
BACKEND_TAGS   := -tags netgo,osusergo
BACKEND_LINK   := -linkmode external -extldflags -static
endif
# On macOS the C parts take the oldest system Go itself supports, not the
# one that built them
export MACOSX_DEPLOYMENT_TARGET ?= 12.0

# backend builds the Go engine (the node and updater behind the bridge).
backend:
	@mkdir -p $(BACKEND_DIR)
	CGO_ENABLED=$(CGO) GOOS=$(GOOS) GOARCH=$(GOARCH) GOEXPERIMENT=$(GOEXPERIMENT_FLAGS) go build -trimpath $(BACKEND_TAGS) \
	  -ldflags "$(LDFLAGS) $(BACKEND_LINK) -X github.com/ParallaxProtocol/parallax-gui/backend.GUIVersion=$(VERSION) -X github.com/ParallaxProtocol/parallax-gui/backend.DaemonCommit=$(DAEMON_COMMIT)" \
	  -o $(BACKEND_DIR)/$(BACKEND_EXE) .

# tor puts the Tor the app ships beside the backend (backend/tor.go,
# desktop/scripts/fetch-tor.mjs): the Tor Project's build for the platform,
# checked against its pinned hash
tor:
	node desktop/scripts/fetch-tor.mjs $(GOOS) $(GOARCH) $(BACKEND_DIR)/tor

frontend:
	cd frontend && npm ci && npm run build

desktop-deps:
	cd desktop && npm ci

# prlx-gui builds an unpacked app for this machine under build/package
# (e.g. build/package/linux-unpacked/parallax-wallet-app), quick to try out.
prlx-gui: backend tor frontend desktop-deps
	cd desktop && npm run build && DISPLAY_ARCH=$(DISPLAY_ARCH) npx electron-builder \
	  $(EB_PLATFORM) --$(EB_ARCH) --dir -c.extraMetadata.version=$(VERSION)
	@echo "Done building Parallax Wallet in build/package/"

# prlx-gui-package builds the release artifacts for GOOS/GOARCH: the
# AppImage on Linux, the DMG on macOS, the installer and the portable
# executable on Windows.
prlx-gui-package: backend tor frontend desktop-deps
	cd desktop && npm run build && DISPLAY_ARCH=$(DISPLAY_ARCH) npx electron-builder \
	  $(EB_PLATFORM) --$(EB_ARCH) --publish never -c.extraMetadata.version=$(VERSION)
	@ls -lh build/package/Parallax-Wallet-* 2>/dev/null || true

# dev runs the app against the Vite dev server: frontend edits hot-reload.
# PROFILE=<name> runs a separate copy beside it, with its own config,
# wallet and logs (make dev PROFILE=signer, for an offline signer)
dev:
	cd frontend && npm install
	cd desktop && npm install && PROFILE=$(PROFILE) npm run dev

clean:
	rm -rf build/backend build/package build/tor frontend/dist desktop/dist
