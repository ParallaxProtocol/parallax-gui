// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	parallax "github.com/ParallaxProtocol/parallax/v2"
	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/rpc/client"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

// The wallet keeps its keys in the daemon's own encrypted keystore
// (wallet/keystore: Web3 Secret Storage, scrypt and AES-128-CTR, the files
// parallaxd and parallax-wallet read and write), with the standard scrypt
// cost. Its directory is in the user's config directory, apart from the
// chain data a resync may delete, and the keystore is never attached to the
// node: no RPC client can list its accounts or ask them to sign.
//
// No account is ever unlocked. A key is decrypted only for the one action
// its password was given for (signing a transaction, checking a backup,
// changing the password) and zeroed as soon as it is done.

// Errors the frontend recognises, by message, to say them in the user's
// language. Keep them in step with WALLET_ERRORS in frontend/src/lib/api.ts.
var (
	ErrWrongPassword     = errors.New("wallet: wrong password")
	ErrWeakPassword      = fmt.Errorf("wallet: the password must be at least %d characters", minPasswordLen)
	ErrLongPassword      = fmt.Errorf("wallet: the password must be at most %d characters", maxPasswordLen)
	ErrUnknownAccount    = errors.New("wallet: no such account in this wallet")
	ErrAccountExists     = errors.New("wallet: this account is already in the wallet")
	ErrBadPrivateKey     = errors.New("wallet: not a valid private key")
	ErrBadKeyfile        = errors.New("wallet: not a valid keystore file")
	ErrWrongFilePassword = errors.New("wallet: wrong password for the keystore file")
	ErrBadRecipient      = errors.New("wallet: not a valid recipient address")
	ErrBadChecksum       = errors.New("wallet: the recipient address fails its checksum")
	ErrBadAmount         = errors.New("wallet: not a valid amount")
	ErrBadFee            = errors.New("wallet: not a valid fee")
	ErrFeeTooLow         = errors.New("wallet: the fee is below what the node suggests")
	ErrNodeStopped       = errors.New("wallet: the node is not running")
	ErrNodeSyncing       = errors.New("wallet: the node is still syncing")
	ErrNoPeers           = errors.New("wallet: the node has no peers to send the transaction to")
	ErrInsufficientFee   = errors.New("wallet: the balance does not cover the amount and the fee")
)

const (
	// minPasswordLen is the shortest password the wallet encrypts a key
	// with. scrypt makes every guess cost about a second, but only a
	// password long enough to have many possibilities makes that matter.
	minPasswordLen = 8
	// maxPasswordLen bounds what reaches scrypt, which hashes any length.
	maxPasswordLen = 1024
	// maxKeyfileBytes bounds an imported keystore file: real ones are
	// under a kilobyte.
	maxKeyfileBytes = 64 << 10
	// maxNameLen bounds an account's label, in characters.
	maxNameLen = 64
)

// The scrypt cost keys are encrypted at: the keystore's standard, about a
// second and 256 MB per encryption or decryption. Tests lower it.
var walletScryptN, walletScryptP = keystore.StandardScryptN, keystore.StandardScryptP

// WalletAccount is one account of the wallet.
type WalletAccount struct {
	Address string `json:"address"` // EIP-55 checksummed
	Name    string `json:"name"`
	// BackedUp is set once the user saved the key's backup, brought the key
	// from elsewhere (an import), or confirmed the recovery phrase it comes
	// from: until then this computer holds the only copy.
	BackedUp bool `json:"backedUp"`
	// FromSeed is set for an account made from recovery phrase SeedID, at
	// SeedPath; SeedStandard when that is m/44'/60'/0'/0/SeedIndex.
	FromSeed     bool   `json:"fromSeed"`
	SeedID       string `json:"seedId"`
	SeedPath     string `json:"seedPath"`
	SeedIndex    uint32 `json:"seedIndex"`
	SeedStandard bool   `json:"seedStandard"`
}

// WalletInfo is the wallet as a whole: its accounts in creation order, the
// one the app shows, and where the keystore lives.
type WalletInfo struct {
	Accounts    []WalletAccount `json:"accounts"`
	Selected    string          `json:"selected"` // empty when there are no accounts
	KeystoreDir string          `json:"keystoreDir"`
	// HasPassword is set once the wallet password is; NeedsSetup when the
	// keystore has keys but the wallet no password yet.
	HasPassword bool `json:"hasPassword"`
	NeedsSetup  bool `json:"needsSetup"`
	// Seeds are the recovery phrases, in the order they were added.
	Seeds []SeedInfo `json:"seeds"`
}

// walletMeta is what the wallet keeps beside the keystore: nothing secret,
// only labels and the selected account. Addresses are checksummed.
type walletMeta struct {
	Names    map[string]string `json:"names"`
	BackedUp map[string]bool   `json:"backedUp"`
	Selected string            `json:"selected"`
	// Seeds labels each recovery phrase by its id; SeedOf ties each account
	// made from one to it. Nothing here is secret: the phrases, in the
	// vault, are what derive the keys.
	Seeds  map[string]seedMeta `json:"seeds"`
	SeedOf map[string]seedRef  `json:"seedOf"`
}

// Wallet is the app's own wallet. It is safe for concurrent use.
type Wallet struct {
	ks       *keystore.KeyStore
	dir      string
	metaPath string
	node     *NodeController
	// ready reports why the node can't send now, nil when it can. Tests
	// replace it: a private test chain has no peers.
	ready func() error

	mu   sync.Mutex // guards meta
	meta walletMeta

	// keyMu admits one key decryption at a time: each takes scrypt's
	// 256 MB, and a send must assign its nonce, sign and submit before
	// the next one reads the pending nonce.
	keyMu sync.Mutex
}

// NewWallet opens the wallet kept in configDir: the keystore in
// configDir/keystore and its labels in configDir/wallet.json.
func NewWallet(configDir string, node *NodeController) (*Wallet, error) {
	dir := filepath.Join(configDir, "keystore")
	// The keystore creates it on the first key with the same mode; made
	// now so the directory watcher has something to watch
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	w := &Wallet{
		ks:       keystore.NewKeyStore(dir, walletScryptN, walletScryptP),
		dir:      dir,
		metaPath: filepath.Join(configDir, "wallet.json"),
		node:     node,
		meta:     walletMeta{Names: map[string]string{}, BackedUp: map[string]bool{}, Seeds: map[string]seedMeta{}, SeedOf: map[string]seedRef{}},
	}
	w.ready = w.nodeReady
	if data, err := os.ReadFile(w.metaPath); err == nil {
		if err := json.Unmarshal(data, &w.meta); err != nil {
			logging.Warn("Ignoring an unreadable wallet.json", "err", err)
			w.meta = walletMeta{}
			// An account then shows as not backed up: the safe side
		}
		if w.meta.Names == nil {
			w.meta.Names = map[string]string{}
		}
		if w.meta.BackedUp == nil {
			w.meta.BackedUp = map[string]bool{}
		}
		if w.meta.Seeds == nil {
			w.meta.Seeds = map[string]seedMeta{}
		}
		if w.meta.SeedOf == nil {
			w.meta.SeedOf = map[string]seedRef{}
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return w, nil
}

// saveMeta writes the labels atomically. The caller holds w.mu.
func (w *Wallet) saveMeta() error {
	data, err := json.MarshalIndent(w.meta, "", "  ")
	if err != nil {
		return err
	}
	tmp := w.metaPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, w.metaPath)
}

// Info lists the wallet's accounts. The keystore orders them by file name,
// which starts with the time each key was made or imported.
func (w *Wallet) Info() WalletInfo {
	accs := w.ks.Accounts()
	v, err := w.loadVault()
	if err != nil {
		logging.Warn("Failed to read the wallet's vault", "err", err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	info := WalletInfo{
		Accounts:    make([]WalletAccount, 0, len(accs)),
		KeystoreDir: w.dir,
		HasPassword: v != nil,
		NeedsSetup:  v == nil && err == nil && len(accs) > 0,
		Seeds:       w.seedInfosLocked(v),
	}
	selected := false
	for _, a := range accs {
		addr := a.Address.Hex()
		info.Accounts = append(info.Accounts, w.viewLocked(addr))
		if addr == w.meta.Selected {
			selected = true
		}
	}
	switch {
	case selected:
		info.Selected = w.meta.Selected
	case len(info.Accounts) > 0:
		// The selected key was removed (here or by another tool): fall
		// back to the first
		info.Selected = info.Accounts[0].Address
	}
	return info
}

// find returns the keystore account for a checksummed or plain address.
func (w *Wallet) find(address string) (wallet.Account, error) {
	address = strings.TrimSpace(address)
	if !util.IsHexAddress(address) {
		return wallet.Account{}, ErrUnknownAccount
	}
	acc, err := w.ks.Find(wallet.Account{Address: util.HexToAddress(address)})
	if err != nil {
		return wallet.Account{}, ErrUnknownAccount
	}
	return acc, nil
}

// Select makes address the account the app shows.
func (w *Wallet) Select(address string) error {
	acc, err := w.find(address)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.meta.Selected = acc.Address.Hex()
	return w.saveMeta()
}

// Rename labels an account; an empty name clears the label.
func (w *Wallet) Rename(address, name string) error {
	acc, err := w.find(address)
	if err != nil {
		return err
	}
	name, err = cleanName(name)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if name == "" {
		delete(w.meta.Names, acc.Address.Hex())
	} else {
		w.meta.Names[acc.Address.Hex()] = name
	}
	return w.saveMeta()
}

// MarkBackedUp records that the user saved the account's backup.
func (w *Wallet) MarkBackedUp(address string) error {
	acc, err := w.find(address)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.meta.BackedUp[acc.Address.Hex()] = true
	return w.saveMeta()
}

// added labels and selects an account just made or imported.
func (w *Wallet) added(acc wallet.Account, name string, backedUp bool) (WalletAccount, error) {
	addr := acc.Address.Hex()
	w.mu.Lock()
	defer w.mu.Unlock()
	if name != "" {
		w.meta.Names[addr] = name
	}
	if backedUp {
		w.meta.BackedUp[addr] = true
	} else {
		delete(w.meta.BackedUp, addr)
	}
	w.meta.Selected = addr
	if err := w.saveMeta(); err != nil {
		// The key is safely stored; only its label is lost
		logging.Warn("Failed to save the wallet's labels", "err", err)
	}
	return w.viewLocked(addr), nil
}

// Create makes a new key from the operating system's random source and
// stores it encrypted with the wallet password.
func (w *Wallet) Create(name, password string) (WalletAccount, error) {
	name, err := cleanName(name)
	if err != nil {
		return WalletAccount{}, err
	}
	w.keyMu.Lock()
	acc, err := w.newAccount(password)
	w.keyMu.Unlock()
	if err != nil {
		return WalletAccount{}, err
	}
	logging.Info("Created a wallet account", "address", acc.Address)
	return w.added(acc, name, false)
}

// newAccount makes a key under the wallet password. The caller holds
// w.keyMu.
func (w *Wallet) newAccount(password string) (wallet.Account, error) {
	if _, err := w.unlockVault(password); err != nil {
		return wallet.Account{}, err
	}
	return w.ks.NewAccount(password)
}

// ImportPrivateKey stores a raw secp256k1 private key, given as 64 hex
// digits, encrypted with the wallet password.
func (w *Wallet) ImportPrivateKey(name, privateKeyHex, password string) (WalletAccount, error) {
	name, err := cleanName(name)
	if err != nil {
		return WalletAccount{}, err
	}
	raw := strings.TrimSpace(privateKeyHex)
	raw = strings.TrimPrefix(strings.TrimPrefix(raw, "0x"), "0X")
	if len(raw) != 64 {
		return WalletAccount{}, ErrBadPrivateKey
	}
	b, err := hex.DecodeString(raw)
	if err != nil {
		return WalletAccount{}, ErrBadPrivateKey
	}
	defer clear(b)
	// ToECDSA rejects zero and keys outside the curve's order
	priv, err := crypto.ToECDSA(b)
	if err != nil {
		return WalletAccount{}, ErrBadPrivateKey
	}
	defer zeroPrivateKey(priv)

	w.keyMu.Lock()
	acc, err := func() (wallet.Account, error) {
		if _, err := w.unlockVault(password); err != nil {
			return wallet.Account{}, err
		}
		return w.ks.ImportECDSA(priv, password)
	}()
	w.keyMu.Unlock()
	if errors.Is(err, keystore.ErrAccountAlreadyExists) {
		return WalletAccount{}, ErrAccountExists
	}
	if err != nil {
		return WalletAccount{}, err
	}
	logging.Info("Imported a private key into the wallet", "address", acc.Address)
	return w.added(acc, name, true)
}

// ImportKeyfile stores a key from a keystore file (as parallaxd,
// parallax-wallet and most EVM wallets export them), decrypted with
// filePassword and encrypted again under the wallet password.
func (w *Wallet) ImportKeyfile(name, keyJSON, filePassword, password string) (WalletAccount, error) {
	name, err := cleanName(name)
	if err != nil {
		return WalletAccount{}, err
	}
	if len(keyJSON) > maxKeyfileBytes || !json.Valid([]byte(keyJSON)) {
		return WalletAccount{}, ErrBadKeyfile
	}
	if len(filePassword) > maxPasswordLen {
		return WalletAccount{}, ErrWrongFilePassword
	}
	w.keyMu.Lock()
	acc, err := func() (wallet.Account, error) {
		if _, err := w.unlockVault(password); err != nil {
			return wallet.Account{}, err
		}
		return w.ks.Import([]byte(keyJSON), filePassword, password)
	}()
	w.keyMu.Unlock()
	switch {
	case errors.Is(err, ErrWrongPassword), errors.Is(err, ErrNoPassword), errors.Is(err, ErrNeedsSetup):
		return WalletAccount{}, err
	case errors.Is(err, keystore.ErrAccountAlreadyExists):
		return WalletAccount{}, ErrAccountExists
	case errors.Is(err, keystore.ErrDecrypt):
		return WalletAccount{}, ErrWrongFilePassword
	case err != nil:
		// A file that parses as JSON but not as a key, or uses a cipher or
		// KDF the keystore doesn't know
		logging.Debug("Keystore file import failed", "err", err)
		return WalletAccount{}, ErrBadKeyfile
	}
	logging.Info("Imported a keystore file into the wallet", "address", acc.Address)
	return w.added(acc, name, true)
}

// Backup returns the account's keystore file, still encrypted with the
// wallet password, once the password proves to open it: a backup is only
// worth keeping if its owner can decrypt it. The file name is the
// keystore's own.
func (w *Wallet) Backup(address, password string) (WalletBackup, error) {
	acc, err := w.find(address)
	if err != nil {
		return WalletBackup{}, err
	}
	data, err := os.ReadFile(acc.URL.Path)
	if err != nil {
		return WalletBackup{}, err
	}
	if err := w.verify(data, password); err != nil {
		return WalletBackup{}, err
	}
	return WalletBackup{FileName: filepath.Base(acc.URL.Path), Keyfile: string(data)}, nil
}

// WalletBackup is an account's encrypted keystore file.
type WalletBackup struct {
	FileName string `json:"fileName"`
	Keyfile  string `json:"keyfile"`
}

// verify checks that password decrypts the keystore file data.
func (w *Wallet) verify(data []byte, password string) error {
	if len(password) > maxPasswordLen {
		return ErrWrongPassword
	}
	w.keyMu.Lock()
	defer w.keyMu.Unlock()
	key, err := keystore.DecryptKey(data, password)
	if key != nil && key.PrivateKey != nil {
		zeroPrivateKey(key.PrivateKey)
	}
	if errors.Is(err, keystore.ErrDecrypt) {
		return w.keyError(password)
	}
	return err
}

// Remove deletes the account's key file once the password proves the user
// holds it. Without a backup the account's funds are lost for good.
func (w *Wallet) Remove(address, password string) error {
	acc, err := w.find(address)
	if err != nil {
		return err
	}
	if len(password) > maxPasswordLen {
		return ErrWrongPassword
	}
	w.keyMu.Lock()
	err = w.ks.Delete(acc, password)
	if errors.Is(err, keystore.ErrDecrypt) {
		err = w.keyError(password)
	}
	w.keyMu.Unlock()
	if err != nil {
		return err
	}
	logging.Info("Removed a wallet account", "address", acc.Address)
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.meta.Names, acc.Address.Hex())
	delete(w.meta.BackedUp, acc.Address.Hex())
	delete(w.meta.SeedOf, acc.Address.Hex())
	if w.meta.Selected == acc.Address.Hex() {
		w.meta.Selected = ""
	}
	if err := w.saveMeta(); err != nil {
		logging.Warn("Failed to save the wallet's labels", "err", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Balances and activity
// ---------------------------------------------------------------------------

// Summary reports one wallet account's balance and activity: the
// transactions of the last week of blocks, and those waiting in the pool.
func (w *Wallet) Summary(address string) (AddressView, error) {
	acc, err := w.find(address)
	if err != nil {
		return AddressView{}, err
	}
	return w.node.AddressSummary(acc.Address.Hex())
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

// SendQuote is what a send would cost, worked out by the node before the
// user confirms it. Amounts are decimal wei strings.
type SendQuote struct {
	From              string `json:"from"`
	To                string `json:"to"` // checksummed
	ValueWei          string `json:"valueWei"`
	GasPriceWei       string `json:"gasPriceWei"`       // the price the send will pay
	SuggestedPriceWei string `json:"suggestedPriceWei"` // the node's suggestion, for comparison
	GasLimit          uint64 `json:"gasLimit"`
	FeeWei            string `json:"feeWei"`   // gasLimit × gasPrice: the most the send can cost in fees
	TotalWei          string `json:"totalWei"` // value + fee
	BalanceWei        string `json:"balanceWei"`
	MaxValueWei       string `json:"maxValueWei"` // the most that can be sent at this fee
	Sufficient        bool   `json:"sufficient"`  // the balance covers the total
	ToContract        bool   `json:"toContract"`
	ToSelf            bool   `json:"toSelf"`
	ChainID           uint64 `json:"chainId"`
}

// SendRequest is a transfer the user reviewed and confirmed, with the
// password of the account it is sent from.
type SendRequest struct {
	From        string `json:"from"`
	To          string `json:"to"`
	ValueWei    string `json:"valueWei"`
	GasPriceWei string `json:"gasPriceWei"`
	GasLimit    uint64 `json:"gasLimit"`
	Password    string `json:"password"`
}

// SentTx is a transaction the node accepted into its pool.
type SentTx struct {
	Hash  string `json:"hash"`
	Nonce uint64 `json:"nonce"`
}

// nodeReady reports whether the node is in a state to send from: synced,
// with peers to relay to. A nonce or balance read mid-sync is stale, and a
// transaction no peer hears of goes nowhere.
func (w *Wallet) nodeReady() error {
	st := w.node.Status()
	switch {
	case !st.Running:
		return ErrNodeStopped
	case st.Peers == 0 && !st.DevChain:
		return ErrNoPeers
	case st.Syncing:
		return ErrNodeSyncing
	}
	return nil
}

// readyNode returns an in-process RPC client of the running node, once it
// is in a state to send from. Sending through the node's own API keeps
// every check eth_sendRawTransaction makes (replay protection, the fee cap,
// the pool's rules). The caller closes it.
func (w *Wallet) readyNode() (*client.Client, *big.Int, error) {
	stack, prl := w.node.Stack(), w.node.Parallax()
	if stack == nil || prl == nil {
		return nil, nil, ErrNodeStopped
	}
	if err := w.ready(); err != nil {
		return nil, nil, err
	}
	// The head state is missing until a snap sync has finished
	if _, err := prl.BlockChain().State(); err != nil {
		return nil, nil, ErrNodeSyncing
	}
	rpcClient, err := stack.Attach()
	if err != nil {
		return nil, nil, err
	}
	chainID := prl.BlockChain().Config().ChainID
	if chainID == nil || chainID.Sign() <= 0 {
		rpcClient.Close()
		return nil, nil, errors.New("wallet: the chain has no chain ID to sign for")
	}
	return client.NewClient(rpcClient), new(big.Int).Set(chainID), nil
}

// parseRecipient reads a recipient address. A mixed-case address must carry
// a valid EIP-55 checksum, which catches most typing mistakes; one all in
// lower or upper case has none to check.
func parseRecipient(s string) (util.Address, error) {
	s = strings.TrimSpace(s)
	if !util.IsHexAddress(s) || !strings.HasPrefix(s, "0x") && !strings.HasPrefix(s, "0X") {
		return util.Address{}, ErrBadRecipient
	}
	body := s[2:]
	if body != strings.ToLower(body) && body != strings.ToUpper(body) {
		if util.HexToAddress(s).Hex()[2:] != body {
			return util.Address{}, ErrBadChecksum
		}
	}
	addr := util.HexToAddress(s)
	if addr == (util.Address{}) {
		// Anything sent to the zero address is burnt
		return util.Address{}, ErrBadRecipient
	}
	return addr, nil
}

// parseWei reads a non-negative decimal wei amount.
func parseWei(s string, bad error) (*big.Int, error) {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 78 { // 2^256 has 78 digits
		return nil, bad
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return nil, bad
		}
	}
	v, ok := new(big.Int).SetString(s, 10)
	if !ok || v.BitLen() > 256 {
		return nil, bad
	}
	return v, nil
}

// Quote works out the gas, the fee and the totals of sending valueWei from
// one of the wallet's accounts to to, at gasPriceWei, or at the node's
// suggested price when it is empty.
func (w *Wallet) Quote(from, to, valueWei, gasPriceWei string) (SendQuote, error) {
	acc, err := w.find(from)
	if err != nil {
		return SendQuote{}, err
	}
	recipient, err := parseRecipient(to)
	if err != nil {
		return SendQuote{}, err
	}
	value, err := parseWei(valueWei, ErrBadAmount)
	if err != nil {
		return SendQuote{}, err
	}
	ec, chainID, err := w.readyNode()
	if err != nil {
		return SendQuote{}, err
	}
	defer ec.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	suggested, err := ec.SuggestGasPrice(ctx)
	if err != nil {
		return SendQuote{}, fmt.Errorf("wallet: no fee suggestion: %w", err)
	}
	price := suggested
	if strings.TrimSpace(gasPriceWei) != "" {
		if price, err = parseWei(gasPriceWei, ErrBadFee); err != nil {
			return SendQuote{}, err
		}
		// A custom fee may pay more, never less. Below the suggestion a
		// transaction can wait in pools indefinitely, and while it waits
		// every later send from the account queues behind its nonce
		if price.Cmp(suggested) < 0 {
			return SendQuote{}, ErrFeeTooLow
		}
	}
	if price.Sign() <= 0 {
		return SendQuote{}, ErrBadFee
	}
	balance, err := ec.PendingBalanceAt(ctx, acc.Address)
	if err != nil {
		return SendQuote{}, err
	}
	code, err := ec.PendingCodeAt(ctx, recipient)
	if err != nil {
		return SendQuote{}, err
	}

	// A plain transfer costs exactly the intrinsic gas; a contract runs
	// code on receipt, which the node measures
	gas := chainparams.TxGas
	if len(code) > 0 {
		msg := parallax.CallMsg{From: acc.Address, To: &recipient, Value: value, GasPrice: price}
		if gas, err = ec.EstimateGas(ctx, msg); err != nil {
			return SendQuote{}, fmt.Errorf("wallet: the recipient contract would reject this transfer: %w", err)
		}
	}

	fee := new(big.Int).Mul(price, new(big.Int).SetUint64(gas))
	total := new(big.Int).Add(value, fee)
	maxValue := new(big.Int).Sub(balance, fee)
	if maxValue.Sign() < 0 {
		maxValue.SetInt64(0)
	}
	return SendQuote{
		From:              acc.Address.Hex(),
		To:                recipient.Hex(),
		ValueWei:          value.String(),
		GasPriceWei:       price.String(),
		SuggestedPriceWei: suggested.String(),
		GasLimit:          gas,
		FeeWei:            fee.String(),
		TotalWei:          total.String(),
		BalanceWei:        balance.String(),
		MaxValueWei:       maxValue.String(),
		Sufficient:        balance.Cmp(total) >= 0,
		ToContract:        len(code) > 0,
		ToSelf:            recipient == acc.Address,
		ChainID:           chainID.Uint64(),
	}, nil
}

// Send signs the transfer the user confirmed and hands it to the node,
// which checks it as it would any eth_sendRawTransaction and relays it to
// its peers. Every field is checked again here: the frontend's word is
// not taken for any of them. The key is decrypted for this one signature.
func (w *Wallet) Send(req SendRequest) (SentTx, error) {
	acc, err := w.find(req.From)
	if err != nil {
		return SentTx{}, err
	}
	recipient, err := parseRecipient(req.To)
	if err != nil {
		return SentTx{}, err
	}
	value, err := parseWei(req.ValueWei, ErrBadAmount)
	if err != nil {
		return SentTx{}, err
	}
	price, err := parseWei(req.GasPriceWei, ErrBadFee)
	if err != nil || price.Sign() <= 0 {
		return SentTx{}, ErrBadFee
	}
	if len(req.Password) > maxPasswordLen {
		return SentTx{}, ErrWrongPassword
	}
	prl := w.node.Parallax()
	if prl == nil {
		return SentTx{}, ErrNodeStopped
	}
	head := prl.BlockChain().CurrentBlock()
	if req.GasLimit < chainparams.TxGas || head == nil || req.GasLimit > head.GasLimit() {
		return SentTx{}, ErrBadFee
	}
	// The node takes its own transactions below the pool's price floor, but
	// its peers don't: such a send would never leave this computer
	if price.Cmp(prl.TxPool().GasPrice()) < 0 {
		return SentTx{}, ErrFeeTooLow
	}

	ec, chainID, err := w.readyNode()
	if err != nil {
		return SentTx{}, err
	}
	defer ec.Close()

	// One send at a time, from reading the nonce to the pool taking the
	// transaction, so two sends never take the same nonce
	w.keyMu.Lock()
	defer w.keyMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	balance, err := ec.PendingBalanceAt(ctx, acc.Address)
	if err != nil {
		return SentTx{}, err
	}
	fee := new(big.Int).Mul(price, new(big.Int).SetUint64(req.GasLimit))
	if balance.Cmp(new(big.Int).Add(value, fee)) < 0 {
		return SentTx{}, ErrInsufficientFee
	}
	nonce, err := ec.PendingNonceAt(ctx, acc.Address)
	if err != nil {
		return SentTx{}, err
	}

	tx := types.NewTransaction(nonce, recipient, value, req.GasLimit, price, nil)
	signed, err := w.sign(acc, req.Password, tx, chainID)
	if err != nil {
		return SentTx{}, err
	}
	if err := ec.SendTransaction(ctx, signed); err != nil {
		return SentTx{}, fmt.Errorf("wallet: the node refused the transaction: %w", err)
	}
	logging.Info("Sent a wallet transaction", "hash", signed.Hash(), "from", acc.Address, "to", recipient, "nonce", nonce)
	return SentTx{Hash: signed.Hash().Hex(), Nonce: nonce}, nil
}

// sign signs tx for chainID with the account's key, decrypted for this one
// signature, and checks the result. The caller holds w.keyMu.
func (w *Wallet) sign(acc wallet.Account, password string, tx *types.Transaction, chainID *big.Int) (*types.Transaction, error) {
	signed, err := w.ks.SignTxWithPassphrase(acc, password, tx, chainID)
	if errors.Is(err, keystore.ErrDecrypt) {
		return nil, w.keyError(password)
	}
	if err != nil {
		return nil, err
	}
	// Belt and braces: the signature must be replay-protected for this
	// chain and recover to the account it was meant to come from
	if !signed.Protected() || signed.ChainId().Cmp(chainID) != 0 {
		return nil, errors.New("wallet: the signature is not bound to this chain")
	}
	if sender, err := types.Sender(types.LatestSignerForChainID(chainID), signed); err != nil || sender != acc.Address {
		return nil, errors.New("wallet: the signature does not match the account")
	}
	return signed, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func checkPassword(p string) error {
	switch n := utf8.RuneCountInString(p); {
	case len(p) > maxPasswordLen:
		return ErrLongPassword
	case n < minPasswordLen:
		return ErrWeakPassword
	}
	return nil
}

// cleanName trims an account label and refuses one too long or holding
// control characters.
func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > maxNameLen || !utf8.ValidString(name) {
		return "", errors.New("wallet: the name is too long")
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return "", errors.New("wallet: the name has a control character")
		}
	}
	return name, nil
}

// zeroPrivateKey overwrites a private key's scalar in memory, as the
// keystore does with the keys it decrypts.
func zeroPrivateKey(k *ecdsa.PrivateKey) {
	if k == nil || k.D == nil {
		return
	}
	b := k.D.Bits()
	for i := range b {
		b[i] = 0
	}
}
