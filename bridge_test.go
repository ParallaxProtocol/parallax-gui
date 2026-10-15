// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Every secret method names a method the bridge serves: a renamed one
// would quietly lose its erasing.
func TestSecretMethodsExist(t *testing.T) {
	b, err := newBridge(&App{}, newHub())
	if err != nil {
		t.Fatal(err)
	}
	for name := range secretMethods {
		if _, ok := b.methods[name]; !ok {
			t.Errorf("secretMethods names %s, which App doesn't have", name)
		}
	}
}

func TestHandleCall(t *testing.T) {
	b, err := newBridge(&App{}, newHub())
	if err != nil {
		t.Fatal(err)
	}
	call := func(body string) (int, string) {
		rec := httptest.NewRecorder()
		b.handleCall(rec, httptest.NewRequest(http.MethodPost, "/call", strings.NewReader(body)))
		return rec.Code, strings.TrimSpace(rec.Body.String())
	}
	if code, out := call(`{"method":"Profile","args":[]}`); code != http.StatusOK || !strings.HasPrefix(out, `{"result":`) {
		t.Errorf("Profile: %d %s", code, out)
	}
	// A secret method runs too, under erasing; with no wallet it says so
	if code, out := call(`{"method":"WalletSetupPassword","args":["correct horse battery"]}`); code != http.StatusOK || !strings.Contains(out, `"error":`) {
		t.Errorf("WalletSetupPassword: %d %s", code, out)
	}
	if code, out := call(`{"method":`); code != http.StatusBadRequest {
		t.Errorf("malformed: %d %s", code, out)
	}
	if code, out := call(`{"method":"Nope","args":[]}`); code != http.StatusOK || !strings.Contains(out, "unknown method") {
		t.Errorf("unknown: %d %s", code, out)
	}
}
