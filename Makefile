.PHONY: backend frontend desktop-deps prlx-gui prlx-gui-package dev clean

SHELL := /bin/bash

LDFLAGS ?= -s -w
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
BACKEND_EXE := parallax-backend$(if $(filter windows,$(GOOS)),.exe,)

# backend builds the Go engine (the node and updater behind the
# bridge). Pure Go, so it cross-compiles with no C toolchain.
backend:
	@mkdir -p $(BACKEND_DIR)
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -trimpath \
	  -ldflags "$(LDFLAGS) -X github.com/ParallaxProtocol/parallax-gui/backend.GUIVersion=$(VERSION)" \
	  -o $(BACKEND_DIR)/$(BACKEND_EXE) .

frontend:
	cd frontend && npm ci && npm run build

desktop-deps:
	cd desktop && npm ci

# prlx-gui builds an unpacked app for this machine under build/package
# (e.g. build/package/linux-unpacked/parallax-client), quick to try out.
prlx-gui: backend frontend desktop-deps
	cd desktop && npm run build && DISPLAY_ARCH=$(DISPLAY_ARCH) npx electron-builder \
	  $(EB_PLATFORM) --$(EB_ARCH) --dir -c.extraMetadata.version=$(VERSION)
	@echo "Done building Parallax Desktop in build/package/"

# prlx-gui-package builds the release artifacts for GOOS/GOARCH: the
# AppImage on Linux, the DMG on macOS, the installer and the portable
# executable on Windows.
prlx-gui-package: backend frontend desktop-deps
	cd desktop && npm run build && DISPLAY_ARCH=$(DISPLAY_ARCH) npx electron-builder \
	  $(EB_PLATFORM) --$(EB_ARCH) --publish never -c.extraMetadata.version=$(VERSION)
	@ls -lh build/package/Parallax-Client-* 2>/dev/null || true

# dev runs the app against the Vite dev server: frontend edits hot-reload.
dev:
	cd frontend && npm install
	cd desktop && npm install && npm run dev

clean:
	rm -rf build/backend build/package frontend/dist desktop/dist
