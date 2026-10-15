// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"crypto/ecdsa"
	"errors"
	"os"
	"sort"
	"strings"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

// The wallet's accounts are of three kinds, and only one has a key file:
//
//   - a single key, imported or made on its own, is a keystore file, its
//     own backup (Backup);
//   - an account of a recovery phrase has no file: the phrase, written down,
//     is its backup, and the vault keeps it, encrypted. The account is only
//     where it is along the phrase's path (seedRef, sealed with the
//     labels): its key is derived from the phrase each time it signs, and
//     zeroed once it has. Its address is nowhere on disk in the clear;
//   - a watch-only account has no key here at all (offline.go).
//
// An address both a phrase makes and a key file holds (the key imported on
// its own too) is the phrase's, and signs with the file.

// phraseScheme marks an account of a recovery phrase in find's result.
const phraseScheme = "phrase"

// find returns the account that signs for a checksummed or plain address:
// a key file's, or a phrase's. A watch-only account isn't one.
func (w *Wallet) find(address string) (wallet.Account, error) {
	address = strings.TrimSpace(address)
	if !util.IsHexAddress(address) {
		return wallet.Account{}, ErrUnknownAccount
	}
	addr := util.HexToAddress(address)
	if acc, err := w.keys().Find(wallet.Account{Address: addr}); err == nil {
		return acc, nil
	}
	w.mu.Lock()
	_, ok := w.meta.SeedOf[addr.Hex()]
	w.mu.Unlock()
	if ok {
		return wallet.Account{Address: addr, URL: wallet.URL{Scheme: phraseScheme}}, nil
	}
	return wallet.Account{}, ErrUnknownAccount
}

// hasKeyFile reports whether acc signs with a key file.
func hasKeyFile(acc wallet.Account) bool { return acc.URL.Scheme == keystore.KeyStoreScheme }

// hasAccount reports whether addr is a key file's or a phrase's account.
func (w *Wallet) hasAccount(addr util.Address) bool {
	if w.keys().HasAddress(addr) {
		return true
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	_, ok := w.meta.SeedOf[addr.Hex()]
	return ok
}

// phraseAccountsLocked lists the phrases' accounts that have no key file,
// phrase by phrase in the order they were added, each along its path. The
// caller holds w.mu.
func (w *Wallet) phraseAccountsLocked(v *vaultFile) []string {
	order := map[string]int{}
	if v != nil {
		for i, s := range v.Seeds {
			order[s.ID] = i
		}
	}
	var out []string
	for addr := range w.meta.SeedOf {
		if !w.keys().HasAddress(util.HexToAddress(addr)) {
			out = append(out, addr)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := w.meta.SeedOf[out[i]], w.meta.SeedOf[out[j]]
		if a.Seed != b.Seed {
			return order[a.Seed] < order[b.Seed]
		}
		ai, aok := standardIndex(a.Path)
		bi, bok := standardIndex(b.Path)
		switch {
		case aok && bok:
			return ai < bi
		case aok != bok:
			return aok
		}
		return a.Path < b.Path
	})
	return out
}

// signingKey decrypts acc's private key for one signature: a key file's
// with password, or a phrase account's derived from the phrase password
// opens, and checked to be the account's. The caller holds w.keyMu, and
// zeroes the key once it has signed.
func (w *Wallet) signingKey(acc wallet.Account, password string) (*ecdsa.PrivateKey, error) {
	if len(password) > maxPasswordLen {
		return nil, ErrWrongPassword
	}
	if hasKeyFile(acc) {
		data, err := os.ReadFile(acc.URL.Path)
		if err != nil {
			return nil, err
		}
		key, err := keystore.DecryptKey(data, password)
		if errors.Is(err, keystore.ErrDecrypt) {
			return nil, w.keyError(password)
		}
		if err != nil {
			return nil, err
		}
		return key.PrivateKey, nil
	}
	w.mu.Lock()
	ref, ok := w.meta.SeedOf[acc.Address.Hex()]
	w.mu.Unlock()
	if !ok {
		return nil, ErrUnknownAccount
	}
	path, err := wallet.ParseDerivationPath(ref.Path)
	if err != nil {
		return nil, err
	}
	v, err := w.loadVault()
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, w.noVaultError()
	}
	for _, s := range v.Seeds {
		if s.ID != ref.Seed {
			continue
		}
		// Opening the phrase is what proves the password: one scrypt, as a
		// key file's
		entropy, pass, err := openSeed(s, password)
		if err != nil {
			return nil, err
		}
		priv, err := deriveKey(entropy, string(pass), path)
		clear(entropy)
		clear(pass)
		if err != nil {
			return nil, err
		}
		if crypto.PubkeyToAddress(priv.PublicKey) != acc.Address {
			zeroPrivateKey(priv)
			return nil, errors.New("wallet: the recovery phrase doesn't make this account")
		}
		return priv, nil
	}
	return nil, ErrUnknownSeed
}

// dropPhraseKeyFiles removes the key file an earlier version kept for each
// phrase account, once the phrase, opened with password, is seen to make
// it: the same address is the same key, so nothing is lost, and the
// address leaves the disk. A file the phrase doesn't make stays. The
// caller holds w.keyMu, and the labels are open.
func (w *Wallet) dropPhraseKeyFiles(password string) error {
	w.mu.Lock()
	bySeed := map[string][]string{}
	for addr, ref := range w.meta.SeedOf {
		if w.keys().HasAddress(util.HexToAddress(addr)) {
			bySeed[ref.Seed] = append(bySeed[ref.Seed], addr)
		}
	}
	refs := make(map[string]seedRef, len(w.meta.SeedOf))
	for addr, ref := range w.meta.SeedOf {
		refs[addr] = ref
	}
	w.mu.Unlock()
	if len(bySeed) == 0 {
		return nil
	}
	v, err := w.loadVault()
	if err != nil || v == nil {
		return err
	}
	dropped := 0
	for _, s := range v.Seeds {
		addrs := bySeed[s.ID]
		if len(addrs) == 0 {
			continue
		}
		entropy, pass, err := openSeed(s, password)
		if err != nil {
			return err
		}
		for _, addr := range addrs {
			path, err := wallet.ParseDerivationPath(refs[addr].Path)
			if err != nil {
				continue
			}
			made, err := deriveAddress(entropy, string(pass), path)
			if err != nil || made != addr {
				continue
			}
			acc, err := w.keys().Find(wallet.Account{Address: util.HexToAddress(addr)})
			if err != nil {
				continue
			}
			if err := os.Remove(acc.URL.Path); err != nil {
				logging.Warn("Failed to remove a phrase account's key file", "err", err)
				continue
			}
			dropped++
		}
		clear(entropy)
		clear(pass)
	}
	if dropped > 0 {
		// The keystore hears of its files going only at its next rescan:
		// opened afresh, it reads the folder now
		w.ks.Store(keystore.NewKeyStore(w.dir, walletScryptN, walletScryptP))
		logging.Info("Removed the key files of the recovery phrases' accounts: the phrases make them as they sign", "count", dropped)
	}
	return nil
}
