// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	parallaxpkg "github.com/ParallaxProtocol/parallax/v2"
	"github.com/ParallaxProtocol/parallax/v2/kernel/xhash"
	"github.com/ParallaxProtocol/parallax/v2/node/stats"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
)

// smartFeeTarget is the confirmation target the Overview asks the smart fee
// estimator about: six blocks, about an hour at the 10 minute target.
const smartFeeTarget = 6

// Details returns the Overview's fuller picture of the running node. Every
// part is read directly from the live node, so a part that fails is left
// empty rather than failing the whole snapshot.
func (n *NodeController) Details() NodeDetails {
	n.mu.RLock()
	stack := n.stack
	parallax := n.parallax
	diskCritical := n.diskCritical
	n.mu.RUnlock()

	guiCfg := n.cfg.Get()
	d := NodeDetails{
		DaemonVersion:      parallaxpkg.VersionWithMeta,
		DaemonRelease:      parallaxpkg.Version,
		DaemonMeta:         parallaxpkg.VersionMeta,
		DaemonCommit:       daemonCommit(),
		SyncModeConfigured: guiCfg.SyncMode,
		SmartFee:           guiCfg.EnableSmartFee,
		SmartFeeTarget:     smartFeeTarget,
		InboundAllowed:     !guiCfg.BlockInbound,
		MaxPeers:           guiCfg.MaxPeers,
	}
	if stack == nil || parallax == nil {
		return d
	}
	d.Running = true

	// Identity and reachability, from the p2p server's view of itself
	if srv := stack.Server(); srv != nil {
		info := srv.NodeInfo()
		d.NodeID = info.ID
		d.ClientName = info.Name
		if info.Enode != nil {
			d.Enode = *info.Enode
		}
		d.ExternalIP = info.IP
		d.ListenPort = info.Ports.Listener
		d.MaxPeers = srv.MaxPeers
		d.InboundAllowed = srv.NAT != nil
		d.V2Only = srv.LegacyHandshakeRefused()
	}

	// The chain at the head: total difficulty, and the reward schedule
	chain := parallax.BlockChain()
	if head := chain.CurrentBlock(); head != nil {
		num := head.NumberU64()
		if td := chain.GetTd(head.Hash(), num); td != nil {
			d.TotalDifficulty = td.String()
		}
		d.BlockRewardWei = blockRewardAt(num + 1).String()
		d.NextHalvingBlock = (num/xhash.HalvingIntervalBlocks + 1) * xhash.HalvingIntervalBlocks
		d.BlocksToHalving = d.NextHalvingBlock - num
	}

	// The mempool, and what a transaction should pay to get into a block
	pending, queued := parallax.TxPool().Content()
	d.TxPending, d.TxBytes = countPool(pending)
	var queuedBytes uint64
	d.TxQueued, queuedBytes = countPool(queued)
	d.TxBytes += queuedBytes
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if price, err := parallax.APIBackend.SuggestGasTipCap(ctx); err == nil && price != nil {
		d.GasPriceWei = price.String()
	}
	if guiCfg.EnableSmartFee {
		if fee, meta, err := parallax.APIBackend.EstimateSmartFee(ctx, smartFeeTarget); err == nil {
			if fee != nil {
				d.SmartFeeWei = fee.String()
			}
			if meta != nil {
				d.SmartFeeBlocks = meta.DataBlocks
				d.SmartFeeFallback = meta.LegacyFallback
			}
		}
	}

	// Storage: free space where the chain lives, and where the node stops
	if free, err := getFreeDiskSpace(stack.InstanceDir()); err == nil {
		d.DiskFreeBytes = free
	}
	d.DiskStopBelowBytes = diskCritical

	// Sync: the mode in use (it can differ from the configured one once a
	// snap sync hands over to full sync), and snap sync's state download
	d.SyncModeActive = parallax.SyncMode().String()
	d.ArchiveMode = parallax.ArchiveMode()
	prog := parallax.Downloader().Progress()
	d.SnapAccounts = prog.SyncedAccounts
	d.SnapStorage = prog.SyncedStorage
	d.SnapBytes = prog.SyncedAccountBytes + prog.SyncedStorageBytes + prog.SyncedBytecodeBytes
	d.SnapHealing = prog.HealingTrienodes

	// The name this node reports under on the public status page. The
	// stats service generates and keeps it in the instance directory
	// (node/stats.defaultNodeName); it appears once the service has run
	if guiCfg.ReportStats {
		d.StatsHost = stats.DefaultHost
		if b, err := os.ReadFile(filepath.Join(stack.InstanceDir(), "prlstats_name")); err == nil {
			d.StatsName = strings.TrimSpace(string(b))
		}
	}
	return d
}

// countPool counts a pool section's transactions and sums their encoded size.
func countPool(content map[util.Address]types.Transactions) (count int, bytes uint64) {
	for _, txs := range content {
		count += len(txs)
		for _, tx := range txs {
			bytes += uint64(tx.Size())
		}
	}
	return count, bytes
}
