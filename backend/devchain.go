// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/ParallaxProtocol/parallax/v2/node"
	"github.com/ParallaxProtocol/parallax/v2/node/fullnode/downloader"
	"github.com/ParallaxProtocol/parallax/v2/node/nodeconfig"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/validation"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

// The development chain: in development builds (make dev) the embedded node
// can run the equivalent of `parallaxd --dev` instead of joining mainnet. A
// private clique chain sealed by a signer key of its own, a block for each
// transaction, no peers, and a genesis that funds an address of the
// developer's choosing so the wallet has something to send.

// devNetworkID is the network ID `parallaxd --dev` uses; the chain ID comes
// from its genesis (chainparams.AllCliqueProtocolChanges).
const devNetworkID = 1337

// devGasLimit is --dev.gaslimit's default.
const devGasLimit = 11_500_000

// devFunds is what the genesis gives the funded address: a million LAX.
var devFunds = new(big.Int).Mul(big.NewInt(1_000_000), big.NewInt(1e18))

// DevBuild reports whether the app runs from `make dev`, which sets
// PARALLAX_DEV in the environment. Release builds never offer the
// development chain, whatever their config holds.
func DevBuild() bool { return os.Getenv("PARALLAX_DEV") == "1" }

// profileName is a valid profile name: lower-case letters, digits and
// dashes, starting with a letter or digit, at most 32 long.
var profileName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

// Profile is the development profile this app runs as (make dev
// PROFILE=<name>), or "" for the default one. A profile is a separate copy
// of the app's state, its config, wallet, address book and logs in
// <user config>/Parallax-<name>, so two copies can run side by side, an
// online wallet and an offline signer, say. Release builds have no
// profiles, whatever their environment says.
func Profile() string {
	p := os.Getenv("PARALLAX_PROFILE")
	if !DevBuild() || !profileName.MatchString(p) {
		return ""
	}
	return p
}

// appDirName is the app's folder in the user's config directory: its own
// for a profile.
func appDirName() string {
	if p := Profile(); p != "" {
		return "Parallax-" + p
	}
	return "Parallax"
}

// devChain reports whether the node should run the development chain.
func devChain(g GUIConfig) bool { return g.DevChain && DevBuild() }

// nodeDataDir is the directory the node keeps its chain in: the configured
// one, or for the development chain a sibling of it per funded address, so
// a mainnet chain is never touched and changing the address starts a chain
// whose genesis funds it.
func nodeDataDir(g GUIConfig) string {
	if !devChain(g) {
		return g.DataDir
	}
	name := "default"
	if a := strings.TrimSpace(g.DevFundAddress); a != "" {
		name = strings.ToLower(util.HexToAddress(a).Hex())
	}
	return filepath.Join(filepath.Clean(g.DataDir)+"-dev", name)
}

// devFundAddress parses the address the genesis funds; zero when unset.
func devFundAddress(g GUIConfig) (util.Address, error) {
	s := strings.TrimSpace(g.DevFundAddress)
	if s == "" {
		return util.Address{}, nil
	}
	if !util.IsHexAddress(s) {
		return util.Address{}, fmt.Errorf("development chain: %q is not an address", s)
	}
	return util.HexToAddress(s), nil
}

// devGUIConfig rewrites the settings that would reach out of the private
// chain: no listening, no discovery, no bootstrap or pinned peers, no
// shared ancient store, no public stats.
func devGUIConfig(g GUIConfig) GUIConfig {
	g.DataDir = nodeDataDir(g)
	g.AncientDir = ""
	g.BlockInbound = true
	g.NoDiscovery = true
	g.Bootnodes = nil
	g.StaticPeers = nil
	g.TrustedPeers = nil
	g.ReportStats = false
	g.SyncMode = "full"
	return g
}

// applyDevChain finishes buildConfigs' configs for the development chain.
func applyDevChain(nodeCfg *node.Config, prlCfg *nodeconfig.Config) {
	nodeCfg.P2P.ListenAddr = ""
	nodeCfg.P2P.MaxPeers = 0
	nodeCfg.P2P.NoDiscovery = true
	nodeCfg.P2P.BootstrapNodes = nil
	nodeCfg.P2P.BootstrapNodesV2 = nil
	nodeCfg.P2P.DNSSeeds = nil

	prlCfg.NetworkId = devNetworkID
	prlCfg.SyncMode = downloader.FullSync
	prlCfg.ParallaxDiscoveryURLs = nil
	prlCfg.SnapDiscoveryURLs = nil
	prlCfg.Miner.GasPrice = big.NewInt(1)
}

// prepareDevChain readies a created stack for the development chain, as
// `parallaxd --dev` does: it unlocks the signer (made on first use, with no
// password) to seal with, and on a fresh data directory supplies the
// genesis, which pre-funds the signer and the configured address. An
// existing chain keeps the genesis it was made with.
func prepareDevChain(stack *node.Node, ks *keystore.KeyStore, g GUIConfig, prlCfg *nodeconfig.Config) error {
	fund, err := devFundAddress(g)
	if err != nil {
		return err
	}
	signer := ks.Accounts()
	if len(signer) == 0 {
		acc, err := ks.NewAccount("")
		if err != nil {
			return fmt.Errorf("development chain: create signer: %w", err)
		}
		signer = append(signer, acc)
	}
	if err := ks.Unlock(signer[0], ""); err != nil {
		return fmt.Errorf("development chain: unlock signer: %w", err)
	}
	prlCfg.Miner.Coinbase = signer[0].Address

	if util.FileExist(stack.ResolvePath("chaindata")) {
		return nil
	}
	genesis := validation.DeveloperGenesisBlock(0, devGasLimit, signer[0].Address)
	if fund != (util.Address{}) {
		genesis.Alloc[fund] = validation.GenesisAccount{Balance: new(big.Int).Set(devFunds)}
	}
	prlCfg.Genesis = genesis
	return nil
}
