// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestMessageRules(t *testing.T) {
	for _, ok := range []string{"hello", "line one\nline two", "tab\tseparated", "ünïcödé ✓", strings.Repeat("a", 1024)} {
		if err := checkMessage(ok); err != nil {
			t.Errorf("%q: %v", ok, err)
		}
	}
	for _, bad := range []string{"", strings.Repeat("a", 1025), "carriage\rreturn", "nul\x00", "esc\x1b[31m", "c1\u0085", "bad utf8 \xff"} {
		if err := checkMessage(bad); !errors.Is(err, ErrMessageText) {
			t.Errorf("%q: %v, want ErrMessageText", bad, err)
		}
	}
}

// TestSignAndVerifyMessage signs with a hot key and verifies in both
// signature forms, and the offline round trip through a watch-only account.
func TestSignAndVerifyMessage(t *testing.T) {
	w, _ := newTestWallet(t)
	acc, err := w.Create("", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	msg := "I control this address.\n2026-10-14"
	signed, err := w.SignMessage(acc.Address, msg, testPassword)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(signed.Signature, "0x") || len(signed.Signature) != 132 {
		t.Fatalf("signature %q", signed.Signature)
	}
	if v := signed.Signature[130:]; v != "1b" && v != "1c" {
		t.Fatalf("v = %s, want 27 or 28", v)
	}
	if _, err := w.SignMessage(acc.Address, msg, "wrong password"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password: %v", err)
	}

	check, err := VerifyMessage(strings.ToLower(acc.Address), msg, signed.Signature)
	if err != nil || !check.Valid || check.Recovered != acc.Address {
		t.Fatalf("verify: %+v, %v", check, err)
	}
	// The older form: no 0x, v 0/1
	raw := []byte(signed.Signature[2:])
	old := string(raw[:128]) + map[string]string{"1b": "00", "1c": "01"}[signed.Signature[130:]]
	if check, err := VerifyMessage(acc.Address, msg, old); err != nil || !check.Valid {
		t.Fatalf("verify the 0/1 form: %+v, %v", check, err)
	}
	// Another message, or another address, doesn't verify
	if check, _ := VerifyMessage(acc.Address, msg+".", signed.Signature); check.Valid {
		t.Fatal("a changed message verified")
	}
	if check, _ := VerifyMessage(aliceAddr, msg, signed.Signature); check.Valid || check.Recovered != acc.Address {
		t.Fatalf("another address: %+v", check)
	}
	if _, err := VerifyMessage(acc.Address, msg, "0x1234"); !errors.Is(err, ErrBadSignature) {
		t.Fatalf("short signature: %v", err)
	}

	// Offline: a watch-only wallet asks, the signer signs, the wallet checks
	online, _ := newTestWallet(t)
	if _, err := online.AddWatchOnly("", acc.Address); err != nil {
		t.Fatal(err)
	}
	if _, err := w.BuildMessageRequest(acc.Address, msg); !errors.Is(err, ErrNotWatchOnly) {
		t.Fatalf("a request for a hot account: %v", err)
	}
	if _, err := online.SignMessage(acc.Address, msg, testPassword); !errors.Is(err, ErrWatchOnly) {
		t.Fatalf("signing with a watch-only account: %v", err)
	}
	req, err := online.BuildMessageRequest(acc.Address, msg)
	if err != nil {
		t.Fatal(err)
	}
	rev, err := w.ReviewMessageRequest(req.Doc)
	if err != nil || rev.Message != msg || rev.Fingerprint != req.Fingerprint {
		t.Fatalf("review %+v, %v", rev, err)
	}
	var tampered map[string]interface{}
	json.Unmarshal([]byte(req.Doc), &tampered)
	tampered["message"] = msg + "!"
	b, _ := json.Marshal(tampered)
	if _, err := w.ReviewMessageRequest(string(b)); !errors.Is(err, ErrMessageTampered) {
		t.Fatalf("a changed message: %v", err)
	}
	stranger, _ := newTestWallet(t)
	if _, err := stranger.ReviewMessageRequest(req.Doc); !errors.Is(err, ErrRequestAccount) {
		t.Fatalf("a signer without the key: %v", err)
	}
	back, err := w.SignMessageRequest(req.Doc, testPassword)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ReviewSignedMessage(back.Doc)
	if err != nil || !got.Valid || got.ID != req.ID || got.Message != msg || got.Signature != signed.Signature {
		t.Fatalf("signed message %+v, %v", got, err)
	}
	var forged map[string]interface{}
	json.Unmarshal([]byte(back.Doc), &forged)
	forged["address"] = aliceAddr
	b, _ = json.Marshal(forged)
	if got, err := ReviewSignedMessage(string(b)); err != nil || got.Valid {
		t.Fatalf("a signature claimed for another address: %+v, %v", got, err)
	}

	// The real CLI, when built: it verifies the GUI's signature, signs the
	// GUI's request to the same signature, and the GUI verifies its output
	if bin := os.Getenv("PARALLAX_WALLET_BIN"); bin != "" {
		if out, err := exec.Command(bin, "verifymessage", acc.Address, signed.Signature, msg).CombinedOutput(); err != nil || !strings.Contains(string(out), "successful") {
			t.Fatalf("parallax-wallet verifymessage: %s, %v", out, err)
		}
		keyfile := filepath.Join(w.dir, mustKeyfile(t, w.dir))
		reqFile := filepath.Join(t.TempDir(), "request.json")
		os.WriteFile(reqFile, []byte(req.Doc), 0o600)
		pw := filepath.Join(t.TempDir(), "pw")
		os.WriteFile(pw, []byte(testPassword), 0o600)
		out, err := exec.Command(bin, "signrequest", "--yes", "--passwordfile", pw, keyfile, reqFile).Output()
		if err != nil {
			t.Fatalf("parallax-wallet signrequest: %v", err)
		}
		cli, err := ReviewSignedMessage(string(out))
		if err != nil || !cli.Valid || cli.Signature != signed.Signature {
			t.Fatalf("the CLI's signed message %+v, %v", cli, err)
		}
		sigOut, err := exec.Command(bin, "signmessage", "--passwordfile", pw, keyfile, msg).Output()
		if err != nil {
			t.Fatalf("parallax-wallet signmessage: %v", err)
		}
		sig := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(sigOut)), "Signature:"))
		if check, err := VerifyMessage(acc.Address, msg, sig); err != nil || !check.Valid {
			t.Fatalf("the CLI's signmessage output %q: %+v, %v", sig, check, err)
		}
	}
}
