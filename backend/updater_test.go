package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

// TestVerifySHA256 checks that an update is installed only against the
// release's hashes: a matching one passes, and a wrong hash, an asset the
// list leaves out, or no list at all fails it.
func TestVerifySHA256(t *testing.T) {
	file := filepath.Join(t.TempDir(), "update")
	if err := os.WriteFile(file, []byte("the update"), 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("the update"))
	good := hex.EncodeToString(sum[:])

	sums := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sums == "" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(sums))
	}))
	defer srv.Close()
	u := NewUpdater(srv.Client())
	info := &UpdateInfo{AssetName: "Parallax-Wallet-9.9.9-linux-x86_64.AppImage"}
	info.AssetURL = srv.URL + "/download/v9.9.9/" + info.AssetName

	for _, c := range []struct {
		name, sums string
		ok         bool
	}{
		{"matching", good + "  " + info.AssetName + "\n", true},
		{"wrong hash", hex.EncodeToString(make([]byte, 32)) + "  " + info.AssetName + "\n", false},
		{"asset left out", good + "  Parallax-Wallet-9.9.9-windows-x86_64.exe\n", false},
		{"no list", "", false},
	} {
		sums = c.sums
		if err := u.verifySHA256(info, file); (err == nil) != c.ok {
			t.Errorf("%s: err %v, want ok %v", c.name, err, c.ok)
		}
	}

	// Nothing reachable at all fails it too
	srv.Close()
	if err := u.verifySHA256(info, file); err == nil {
		t.Error("verified with the release unreachable")
	}
}

// TestClipNotes checks that long release notes are cut short, at a whole
// character, and short ones kept as they are.
func TestClipNotes(t *testing.T) {
	if got := clipNotes("## Fixes\n- one"); got != "## Fixes\n- one" {
		t.Fatalf("clipNotes(short) = %q", got)
	}
	long := "a" + strings.Repeat("é", maxNotes) // two bytes each after one: the cut lands mid-rune
	got := clipNotes(long)
	if !utf8.ValidString(got) || !strings.HasSuffix(got, "…") || len(got) > maxNotes+len("…") {
		t.Fatalf("clipNotes(long) = %d bytes, valid %v", len(got), utf8.ValidString(got))
	}
}

// TestReleasesBetween checks that the notes shown are every published
// release after the one running, up to the latest, newest first: not the
// running one or older, not drafts or prereleases, not one past the latest.
func TestReleasesBetween(t *testing.T) {
	list := []githubRelease{
		{TagName: "v1.4.0", Body: "too new"},
		{TagName: "v1.3.0", Body: "latest, from the list"},
		{TagName: "v1.2.1", Body: "fix"},
		{TagName: "v1.2.1-rc1", Prerelease: true},
		{TagName: "v1.2.5", Draft: true},
		{TagName: "v1.1.0", Body: "minor"},
		{TagName: "v1.2.0", Body: "feature"},
		{TagName: "v1.0.1", Body: "running"},
		{TagName: "v0.9.0", Body: "old"},
	}
	latest := ReleaseNotes{Version: "1.3.0", Notes: "latest"}
	got := releasesBetween(list, "1.0.1", latest)
	var versions []string
	for _, r := range got {
		versions = append(versions, r.Version)
	}
	want := []string{"1.3.0", "1.2.1", "1.2.0", "1.1.0"}
	if strings.Join(versions, " ") != strings.Join(want, " ") {
		t.Fatalf("releasesBetween = %v, want %v", versions, want)
	}
	if got[0].Notes != "latest" {
		t.Fatalf("latest's notes = %q, want the release it was found by", got[0].Notes)
	}
	if got := releasesBetween(nil, "1.0.1", latest); len(got) != 1 || got[0].Version != "1.3.0" {
		t.Fatalf("releasesBetween(no list) = %v, want the latest alone", got)
	}
}

// TestReleasesUpTo checks that About's notes are every published release
// up to the one running, newest first: not one past it, nor drafts or
// prereleases.
func TestReleasesUpTo(t *testing.T) {
	list := []githubRelease{
		{TagName: "v1.3.0"},
		{TagName: "v1.0.1"},
		{TagName: "v1.1.0-rc1", Prerelease: true},
		{TagName: "v0.9.0"},
		{TagName: "v1.1.0", Draft: true},
		{TagName: "v1.0.0"},
	}
	var versions []string
	for _, r := range releasesUpTo(list, "1.0.1") {
		versions = append(versions, r.Version)
	}
	if got, want := strings.Join(versions, " "), "1.0.1 1.0.0 0.9.0"; got != want {
		t.Fatalf("releasesUpTo = %s, want %s", got, want)
	}
}
