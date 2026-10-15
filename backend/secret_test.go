// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

//go:build goexperiment.runtimesecret

package backend

import (
	"runtime/secret"
	"testing"
)

// The bridge runs every call that carries a secret under runtime/secret
// (secret_erase.go, at the repository root); the wallet works the same
// there: scrypt, the keystore, the signer and the node it sends through.
func TestWalletUnderRuntimeSecret(t *testing.T) {
	for name, test := range map[string]func(*testing.T){
		"create":         TestWalletCreateKeepsKeyEncryptedAndPrivate,
		"importKey":      TestWalletImportPrivateKey,
		"importKeyfile":  TestWalletImportKeyfile,
		"backupRemove":   TestWalletBackupRemove,
		"changePassword": TestWalletChangePasswordReencryptsEverything,
		"sign":           TestWalletSignIsBoundToChainAndAccount,
		"seedLifecycle":  TestSeedLifecycle,
		"scanSeed":       TestScanSeed,
		"send":           TestWalletSendThroughNode,
	} {
		t.Run(name, func(t *testing.T) { secret.Do(func() { test(t) }) })
	}
}
