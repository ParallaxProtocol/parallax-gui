package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
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
