// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	aliceAddr = "0x809934Fd0543aCe5621082125162e6899544aF46"
	bobAddr   = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"
	carolAddr = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359"
)

// bookFor opens the contacts in dir as the app does: with w, as it
// unlocks, and forgotten as it locks.
func bookFor(t *testing.T, w *Wallet, dir string) *Contacts {
	t.Helper()
	c, err := OpenContacts(dir)
	if err != nil {
		t.Fatal(err)
	}
	w.SetOpenHooks(func() {
		if err := c.Open(w); err != nil {
			t.Errorf("Open: %v", err)
		}
	}, c.Close)
	if w.opened() {
		if err := c.Open(w); err != nil {
			t.Fatal(err)
		}
	}
	return c
}

func openTestContacts(t *testing.T) (*Contacts, string) {
	t.Helper()
	w, dir := newTestWallet(t)
	testWallets[dir] = w
	return bookFor(t, w, dir), dir
}

// testWallets are the wallets openTestContacts opened, by folder, for a
// test to open the same book again.
var testWallets = map[string]*Wallet{}

func TestContactsAddValidatesAndPersists(t *testing.T) {
	c, dir := openTestContacts(t)

	// An empty book reaches the frontend as [], which it reads as loaded
	if data, _ := json.Marshal(c.List()); string(data) != "[]" {
		t.Fatalf("an empty book encodes as %s, want []", data)
	}

	k, err := c.Add(ContactInput{Name: "  Alice \t Smith ", Address: strings.ToLower(aliceAddr), Note: " rent\r\nmonthly "})
	if err != nil {
		t.Fatal(err)
	}
	if k.Name != "Alice Smith" || k.Address != aliceAddr || k.Note != "rent\nmonthly" || k.ID == "" || k.CreatedAt == 0 {
		t.Fatalf("added %+v, want the name tidied, the address checksummed and the note trimmed", k)
	}

	for name, in := range map[string]struct {
		in   ContactInput
		want error
	}{
		"no name":          {ContactInput{Name: "  ", Address: bobAddr}, ErrContactName},
		"long name":        {ContactInput{Name: strings.Repeat("x", 65), Address: bobAddr}, ErrContactName},
		"control in name":  {ContactInput{Name: "Bob\x00", Address: bobAddr}, ErrContactName},
		"long note":        {ContactInput{Name: "Bob", Address: bobAddr, Note: strings.Repeat("x", 501)}, ErrContactNote},
		"not an address":   {ContactInput{Name: "Bob", Address: "0x1234"}, ErrBadRecipient},
		"zero address":     {ContactInput{Name: "Bob", Address: "0x0000000000000000000000000000000000000000"}, ErrBadRecipient},
		"bad checksum":     {ContactInput{Name: "Bob", Address: "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"}, ErrBadChecksum},
		"same address":     {ContactInput{Name: "Alice again", Address: aliceAddr}, ErrContactExists},
		"same name, cased": {ContactInput{Name: "alice smith", Address: bobAddr}, ErrContactNameUsed},
	} {
		if _, err := c.Add(in.in); !errors.Is(err, in.want) {
			t.Errorf("%s: err = %v, want %v", name, err, in.want)
		}
	}

	again := bookFor(t, testWallets[dir], dir)
	if got := again.List(); len(got) != 1 || got[0] != k {
		t.Fatalf("reopened = %+v, want just %+v", got, k)
	}
	if fi, err := os.Stat(filepath.Join(dir, sealedContacts)); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("%s = %v, %v; want it private to the user", sealedContacts, fi, err)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, sealedContacts)); strings.Contains(string(data), "Alice") || strings.Contains(string(data), aliceAddr[2:]) {
		t.Fatal("the contacts are kept in the clear")
	}
	// Locked, the book can't be read or changed
	testWallets[dir].Lock()
	if got := again.List(); len(got) != 0 {
		t.Fatalf("locked, the book lists %+v", got)
	}
	if _, err := again.Add(ContactInput{Name: "Mallory", Address: bobAddr}); !errors.Is(err, ErrLocked) {
		t.Fatalf("Add while locked = %v, want ErrLocked", err)
	}
}

func TestContactsUpdateFavoriteRemoveAndOrder(t *testing.T) {
	c, _ := openTestContacts(t)
	alice, _ := c.Add(ContactInput{Name: "alice", Address: aliceAddr})
	bob, _ := c.Add(ContactInput{Name: "Bob", Address: bobAddr})
	carol, _ := c.Add(ContactInput{Name: "Carol", Address: carolAddr})

	// An edit may keep its own name and address, not take another's
	if _, err := c.Update(alice.ID, ContactInput{Name: "Alice", Address: aliceAddr, Note: "n"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Update(alice.ID, ContactInput{Name: "Alice", Address: bobAddr}); !errors.Is(err, ErrContactExists) {
		t.Fatalf("taking Bob's address: %v", err)
	}
	if _, err := c.Update(alice.ID, ContactInput{Name: "bob", Address: aliceAddr}); !errors.Is(err, ErrContactNameUsed) {
		t.Fatalf("taking Bob's name: %v", err)
	}
	if _, err := c.Update("nope", ContactInput{Name: "X", Address: aliceAddr}); !errors.Is(err, ErrContactUnknown) {
		t.Fatalf("editing no one: %v", err)
	}

	if err := c.SetFavorite(carol.ID, true); err != nil {
		t.Fatal(err)
	}
	names := func() string {
		var n []string
		for _, k := range c.List() {
			n = append(n, k.Name)
		}
		return strings.Join(n, ",")
	}
	if got := names(); got != "Carol,Alice,Bob" {
		t.Fatalf("order = %s, want the favourite first, then by name", got)
	}

	if err := c.Remove(bob.ID); err != nil {
		t.Fatal(err)
	}
	if err := c.Remove(bob.ID); !errors.Is(err, ErrContactUnknown) {
		t.Fatalf("removing twice: %v", err)
	}
	if got := names(); got != "Carol,Alice" {
		t.Fatalf("after removing Bob: %s", got)
	}

	c.SentTo(strings.ToLower(carolAddr))
	for _, k := range c.List() {
		if (k.LastSentAt != 0) != (k.ID == carol.ID) {
			t.Fatalf("%s last sent at %d; only Carol was sent to", k.Name, k.LastSentAt)
		}
	}
}

func TestContactsExportImportRoundTrip(t *testing.T) {
	c, _ := openTestContacts(t)
	c.Add(ContactInput{Name: "Alice", Address: aliceAddr, Note: "line one\nline two"})
	bob, _ := c.Add(ContactInput{Name: "=cmd|' /C calc'!A0", Address: bobAddr, Note: "@risky"})
	c.SetFavorite(bob.ID, true)

	for _, format := range []string{"json", "csv"} {
		data, err := c.Export(format)
		if err != nil {
			t.Fatal(err)
		}
		if format == "csv" && strings.Contains(data, "\n=cmd") {
			t.Fatalf("csv export starts a field with a formula:\n%s", data)
		}
		other, _ := openTestContacts(t)
		res, err := other.Import(data)
		if err != nil {
			t.Fatalf("%s: %v", format, err)
		}
		if res.Added != 2 || res.Skipped != 0 || res.Invalid != 0 {
			t.Fatalf("%s import = %+v, want both added", format, res)
		}
		for i, k := range other.List() {
			want := c.List()[i]
			if k.Name != want.Name || k.Address != want.Address || k.Note != want.Note || k.Favorite != want.Favorite {
				t.Fatalf("%s round trip: %+v, want %+v", format, k, want)
			}
		}
		// Importing the same file again adds nothing
		if res, _ := other.Import(data); res.Added != 0 || res.Skipped != 2 {
			t.Fatalf("%s re-import = %+v, want both skipped", format, res)
		}
	}
}

func TestContactsImportReportsBadEntries(t *testing.T) {
	c, _ := openTestContacts(t)
	csv := "\ufeffName,Address,Note\n" +
		"Alice," + aliceAddr + ",ok\n" +
		"Nobody,0x123,\n" +
		",\"" + bobAddr + "\",no name\n" +
		"Carol," + carolAddr + "\n"
	res, err := c.Import(csv)
	if err != nil {
		t.Fatal(err)
	}
	if res.Added != 2 || res.Invalid != 2 || len(res.Errors) != 2 {
		t.Fatalf("import = %+v, want Alice and Carol added and two invalid entries reported", res)
	}
	for _, bad := range []string{"", "   ", "not a book", "{}", "[1,2]", "name,email\nx,y\n"} {
		if _, err := c.Import(bad); !errors.Is(err, ErrContactsFile) {
			t.Errorf("Import(%q) = %v, want ErrContactsFile", bad, err)
		}
	}
	if _, err := c.Import(strings.Repeat(" ", maxContactsImport+1)); !errors.Is(err, ErrContactsFile) {
		t.Fatalf("an oversized import: %v", err)
	}
}

func TestContactsSetsAsideAnUnreadableFile(t *testing.T) {
	w, dir := newTestWallet(t)
	path := filepath.Join(dir, sealedContacts)
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	c := bookFor(t, w, dir)
	if len(c.List()) != 0 {
		t.Fatal("an unreadable book loaded entries")
	}
	aside, _ := filepath.Glob(path + ".damaged-*")
	if len(aside) != 1 {
		t.Fatalf("set aside = %v, want the damaged file kept", aside)
	}
	if data, _ := os.ReadFile(aside[0]); string(data) != "{not json" {
		t.Fatalf("the damaged file changed: %q", data)
	}

	// A hand-edited file's invalid and duplicate entries are dropped on load
	book := `{"version":1,"contacts":[
		{"id":"a","name":"Alice","address":"` + aliceAddr + `"},
		{"id":"b","name":"Alice","address":"` + bobAddr + `"},
		{"id":"c","name":"Bad","address":"0x12"},
		{"name":"Carol","address":"` + strings.ToLower(carolAddr) + `"}]}`
	// An earlier version's book, in the clear, is sealed as it's opened
	legacy := filepath.Join(dir, "contacts.json")
	if err := os.WriteFile(legacy, []byte(book), 0o600); err != nil {
		t.Fatal(err)
	}
	c = bookFor(t, w, dir)
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("the clear book is still there: %v", err)
	}
	got := c.List()
	if len(got) != 2 || got[0].Name != "Alice" || got[1].Address != carolAddr || got[1].ID == "" {
		t.Fatalf("loaded %+v, want Alice and Carol, Carol given an id", got)
	}
}
