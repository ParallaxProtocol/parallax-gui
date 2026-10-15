// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

// The two stores the app keeps on disk, and what Settings' Storage does
// with them: the node's data folder, moved to another folder or its chain
// data cleared for a fresh sync; and the wallet's files, moved to another
// folder or deleted altogether.

// Errors the frontend recognises, by message, to say them in the user's
// language. Keep them in step with WALLET_ERRORS in frontend/src/lib/api.ts.
var (
	ErrStorageNotAbs   = errors.New("storage: choose a folder by its full path")
	ErrStorageInside   = errors.New("storage: choose a folder outside the one being moved")
	ErrStorageNotEmpty = errors.New("storage: the folder chosen already holds other files")
	ErrStorageBusy     = errors.New("storage: the data is being moved or cleared")
	ErrWalletDirGone   = errors.New("wallet: the wallet's folder is missing")
)

// The folders a move makes inside the one chosen, when that one already
// holds other things.
const (
	nodeFolderName   = "Parallax Node"
	walletFolderName = "Parallax Wallet"
)

// walletFiles are what the wallet keeps in its folder: the keystore, the
// labels, the vault (its password check and recovery phrases), and the
// signing requests it follows and those it signed (offline.go).
var walletFiles = []string{"keystore", "wallet.json", vaultFileName, "requests.json", "signed.json"}

// StorageProgress is a move's progress, for the frontend's
// "storage-progress" event: the bytes copied of the total. A move within
// one disk is a rename, and shows as done at once.
type StorageProgress struct {
	Store string `json:"store"` // "node" | "wallet"
	Done  int64  `json:"done"`
	Total int64  `json:"total"`
}

// WalletDir is the folder the wallet keeps its files in: the one it was
// moved to, else the app's config folder.
func WalletDir(configDir string, g GUIConfig) string {
	if g.WalletDir != "" {
		return g.WalletDir
	}
	return configDir
}

// within reports whether path is dir or inside it.
func within(path, dir string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !startsWithParent(rel)
}

func startsWithParent(rel string) bool {
	return len(rel) >= 3 && rel[:2] == ".." && os.IsPathSeparator(rel[2])
}

// emptyDir reports whether dir has nothing in it; a missing dir counts.
func emptyDir(dir string) (bool, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return len(entries) == 0, nil
}

// storageDest is where a move of src into the folder chosen puts it: the
// folder itself while it's empty (or not there yet), else a folder named
// name inside it, which must be empty in turn. Neither may be inside src,
// nor hold it.
func storageDest(chosen, name, src string) (string, error) {
	if !filepath.IsAbs(chosen) {
		return "", ErrStorageNotAbs
	}
	dest := filepath.Clean(chosen)
	empty, err := emptyDir(dest)
	if err != nil {
		return "", err
	}
	if !empty {
		dest = filepath.Join(dest, name)
		if empty, err = emptyDir(dest); err != nil {
			return "", err
		} else if !empty {
			return "", ErrStorageNotEmpty
		}
	}
	if within(dest, src) || within(src, dest) {
		return "", ErrStorageInside
	}
	return dest, nil
}

// copyTree copies the folder src to dst, which mustn't exist yet, keeping
// each file's permissions and its links as links. Every file is synced to
// the disk before the copy counts as done. progress hears the bytes copied
// so far.
func copyTree(src, dst string, progress func(done int64)) error {
	var done int64
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, info.Mode().Perm()|0o700)
		case info.Mode()&fs.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		case info.Mode().IsRegular():
			return copyCounted(path, target, info.Mode().Perm(), func(n int64) {
				done += n
				if progress != nil {
					progress(done)
				}
			})
		default:
			// A socket or a device: nothing a store keeps
			return nil
		}
	})
}

// copyCounted copies one file, telling counted the bytes as they're written.
func copyCounted(src, dst string, perm fs.FileMode, counted func(n int64)) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, perm)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, &countingReader{r: in, counted: counted}); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// countingReader reports what it reads, in chunks of at least 4 MB so a
// multi-gigabyte file shows its progress without an event per read.
type countingReader struct {
	r       io.Reader
	counted func(n int64)
	pending int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.pending += int64(n)
	if c.pending >= 4<<20 || (err != nil && c.pending > 0) {
		c.counted(c.pending)
		c.pending = 0
	}
	return n, err
}

// moveTree moves the folder src to dst (missing, or an empty folder): a
// rename where both are on one disk, else a copy, checked against the
// original by size, after which the original is removed. A copy that
// fails is removed again, leaving src as it was.
func moveTree(src, dst string, progress func(done, total int64)) error {
	if _, err := os.Stat(src); os.IsNotExist(err) {
		// Nothing there yet (a node never started): nothing to carry over
		return nil
	} else if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	// Empty, as storageDest saw to: out of the way of the rename
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	total := int64(directorySize(src))
	if err := os.Rename(src, dst); err == nil {
		if progress != nil {
			progress(total, total)
		}
		return nil
	}
	if err := copyTree(src, dst, func(done int64) {
		if progress != nil {
			progress(done, total)
		}
	}); err != nil {
		_ = os.RemoveAll(dst)
		return err
	}
	if copied := int64(directorySize(dst)); copied != total {
		_ = os.RemoveAll(dst)
		return fmt.Errorf("storage: the copy holds %d bytes of the %d moved", copied, total)
	}
	return os.RemoveAll(src)
}

// freezerFile matches what a chain freezer keeps in its folder: its lock,
// and each table's index, metadata and numbered data files.
var freezerFile = regexp.MustCompile(`^(FLOCK|[a-z_.]+\.(cidx|ridx|meta)|[a-z_.]+\.\d{4}\.(cdat|rdat))$`)

// clearFreezer deletes a chain freezer's files from dir, a folder the user
// chose for it, leaving anything else there (and the folder) alone.
func clearFreezer(dir string) error {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.Type().IsRegular() && freezerFile.MatchString(e.Name()) {
			if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// The node's data
// ---------------------------------------------------------------------------

// whileStopped runs f, given the config, with the node stopped and kept
// from starting, starting it again afterwards if it was running.
func (n *NodeController) whileStopped(ctx context.Context, f func(g GUIConfig) error) error {
	n.mu.Lock()
	if n.busy {
		n.mu.Unlock()
		return ErrStorageBusy
	}
	n.busy = true
	running := n.stack != nil
	n.mu.Unlock()

	err := func() error {
		if running {
			if err := n.Stop(); err != nil {
				return err
			}
		}
		return f(n.cfg.Get())
	}()

	n.mu.Lock()
	n.busy = false
	n.mu.Unlock()
	// The size the dashboard shows is measured again
	n.diskMu.Lock()
	n.diskReadAt = time.Time{}
	n.diskMu.Unlock()
	if running {
		if serr := n.Start(ctx); serr != nil && err == nil {
			err = serr
		}
	}
	return err
}

// ClearChainData deletes the chain the node downloaded (its database and
// its ancient store, wherever that was put, and the trie cache's journal),
// for it to sync again from scratch. Its identity, peers, ban list, onion
// key and own keystore stay.
func (n *NodeController) ClearChainData(ctx context.Context) error {
	return n.whileStopped(ctx, func(g GUIConfig) error {
		nodeCfg, prlCfg, err := buildConfigs(g)
		if err != nil {
			return err
		}
		root := filepath.Clean(g.DataDir)
		var paths []string
		chain := nodeCfg.ResolvePath("chaindata")
		paths = append(paths, chain)
		if prlCfg.TrieCleanCacheJournal != "" {
			paths = append(paths, nodeCfg.ResolvePath(prlCfg.TrieCleanCacheJournal))
		}
		for _, p := range paths {
			// Never the data folder itself, nor anything outside it
			if p == "" || filepath.Clean(p) == root || !within(p, root) {
				return fmt.Errorf("storage: refusing to delete %s", p)
			}
			if err := os.RemoveAll(p); err != nil {
				return err
			}
		}
		// The ancient store sits in the chain database unless it was put
		// elsewhere, in a folder that may hold other things too
		if anc := prlCfg.DatabaseFreezer; anc != "" {
			if !filepath.IsAbs(anc) {
				anc = nodeCfg.ResolvePath(anc)
			}
			if !within(anc, chain) {
				if err := clearFreezer(anc); err != nil {
					return err
				}
			}
		}
		logging.Info("Cleared the node's chain data", "datadir", g.DataDir)
		return nil
	})
}

// MoveDataDir moves the node's data folder into the folder chosen (see
// storageDest), and points the config at it: an ancient store kept inside
// the old one by its full path moves with it. It returns where the data
// went.
func (n *NodeController) MoveDataDir(ctx context.Context, chosen string, progress func(done, total int64)) (string, error) {
	var dest string
	err := n.whileStopped(ctx, func(g GUIConfig) error {
		src := filepath.Clean(g.DataDir)
		d, err := storageDest(chosen, nodeFolderName, src)
		if err != nil {
			return err
		}
		if err := moveTree(src, d, progress); err != nil {
			return err
		}
		if filepath.IsAbs(g.AncientDir) && within(g.AncientDir, src) {
			rel, _ := filepath.Rel(src, g.AncientDir)
			g.AncientDir = filepath.Join(d, rel)
		}
		g.DataDir = d
		if err := n.cfg.Save(g); err != nil {
			return err
		}
		logging.Info("Moved the node's data", "from", src, "to", d)
		dest = d
		return nil
	})
	return dest, err
}

// ---------------------------------------------------------------------------
// The wallet's files
// ---------------------------------------------------------------------------

// CopyTo copies the wallet's files into the folder chosen (see
// storageDest), checked byte for byte, holding off every change to them
// while it does. The wallet goes on using its own folder: the app,
// restarted onto the copy, deletes the original (FinishWalletMove).
func (w *Wallet) CopyTo(chosen string) (string, error) {
	src := filepath.Dir(w.dir)
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	w.mu.Lock()
	defer w.mu.Unlock()

	dest, err := storageDest(chosen, walletFolderName, src)
	if err != nil {
		return "", err
	}
	// The app's config folder holds more than the wallet: only the
	// wallet's own files go
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return "", err
	}
	undo := func() {
		for _, name := range walletFiles {
			_ = os.RemoveAll(filepath.Join(dest, name))
		}
	}
	for _, name := range walletFiles {
		from := filepath.Join(src, name)
		if _, err := os.Lstat(from); os.IsNotExist(err) {
			continue
		}
		to := filepath.Join(dest, name)
		if err := copyTree(from, to, nil); err != nil {
			undo()
			return "", err
		}
		if err := sameTree(from, to); err != nil {
			undo()
			return "", err
		}
	}
	logging.Info("Copied the wallet", "from", src, "to", dest)
	return dest, nil
}

// sameTree checks that every file in a holds the same bytes in b: the
// wallet's files are small, and a key that copied wrong is a key lost.
func sameTree(a, b string) error {
	return filepath.WalkDir(a, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.Type().IsRegular() {
			return err
		}
		rel, _ := filepath.Rel(a, path)
		x, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		y, err := os.ReadFile(filepath.Join(b, rel))
		if err != nil {
			return err
		}
		if !bytes.Equal(x, y) {
			return fmt.Errorf("storage: %s did not copy intact", filepath.Join(filepath.Base(a), rel))
		}
		return nil
	})
}

// FinishWalletMove deletes the wallet's files from the folder it was moved
// from, once the app runs on the copy: only when each file there has its
// copy in the wallet's folder now.
func FinishWalletMove(cfg *ConfigStore) {
	g := cfg.Get()
	from := g.WalletMovedFrom
	if from == "" {
		return
	}
	to := WalletDir(cfg.Dir(), g)
	if filepath.Clean(from) == filepath.Clean(to) {
		g.WalletMovedFrom = ""
		_ = cfg.Save(g)
		return
	}
	for _, name := range walletFiles {
		if _, err := os.Lstat(filepath.Join(from, name)); os.IsNotExist(err) {
			continue
		}
		if err := sameTree(filepath.Join(from, name), filepath.Join(to, name)); err != nil {
			logging.Warn("Kept the wallet's old files: the copy differs", "from", from, "err", err)
			return
		}
	}
	for _, name := range walletFiles {
		if err := os.RemoveAll(filepath.Join(from, name)); err != nil {
			logging.Warn("Failed to remove the wallet's old files", "path", filepath.Join(from, name), "err", err)
			return
		}
	}
	g.WalletMovedFrom = ""
	if err := cfg.Save(g); err != nil {
		logging.Warn("Failed to save the config", "err", err)
	}
	logging.Info("Removed the wallet's files from where it was moved from", "from", from)
}

// Wipe deletes the whole wallet from this computer, once password proves
// to be the wallet's: every key, recovery phrase and label, the password
// itself, and the signing requests. Without a backup, the funds of its
// accounts are lost for good. The wallet is then as on a first launch.
func (w *Wallet) Wipe(password string) error {
	if len(password) > maxPasswordLen {
		return ErrWrongPassword
	}
	w.keyMu.Lock()
	if _, err := w.unlockVault(password); err != nil {
		w.keyMu.Unlock()
		return err
	}
	w.Lock()
	dir := filepath.Dir(w.dir)
	err := func() error {
		w.mu.Lock()
		defer w.mu.Unlock()
		entries, err := os.ReadDir(w.dir)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		for _, e := range entries {
			if !e.IsDir() {
				if err := os.Remove(filepath.Join(w.dir, e.Name())); err != nil {
					return err
				}
			}
		}
		for _, name := range walletFiles[1:] {
			if err := os.Remove(filepath.Join(dir, name)); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		w.meta = walletMeta{Names: map[string]string{}, BackedUp: map[string]bool{}, Seeds: map[string]seedMeta{}, SeedOf: map[string]seedRef{}}
		return nil
	}()
	if err == nil {
		// The keystore would hear of its files going only at its next
		// rescan: opened afresh, it reads the empty folder now
		w.ks.Store(keystore.NewKeyStore(w.dir, walletScryptN, walletScryptP))
	}
	w.keyMu.Unlock()
	if err != nil {
		return err
	}
	logging.Info("Deleted the wallet")
	return nil
}
