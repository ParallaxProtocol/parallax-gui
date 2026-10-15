// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/ParallaxProtocol/parallax/v2/kernel/chainparams"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/primitives/types"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/util/hexutil"
)

// Offline signing. A watch-only account's key lives on another computer
// running this app as an offline signer, which never goes online. A send
// from it is a signing request, built here with what only the node knows
// (the nonce, the fee, the gas), carried to the signer as a QR code or a
// file, reviewed and signed there, and carried back as the signed
// transaction, which is checked against the request before it is
// broadcast. The format is shared with `parallax-wallet signrequest`:
//
//	signing request: {"type":"parallax-sign-request","version":1,"id",
//	  "chainId","from","to","nonce","valueWei","gasLimit","gasPriceWei",
//	  "createdAt","memo"}
//	signed transaction: {"type":"parallax-signed-tx","version":1,"id",
//	  "hash","raw","from","nonce","chainId"}
//
// Integers are decimal strings. id is the EIP-155 signing hash of the
// legacy transaction the request describes: it binds every signed field,
// and each side recomputes it. Version 1 signs plain LAX transfers only.

const (
	signRequestType = "parallax-sign-request"
	signedTxType    = "parallax-signed-tx"
	offlineVersion  = 1
	// maxOfflineDoc bounds a request or signed document.
	maxOfflineDoc = 8 << 10
	// maxMemoLen bounds a request's memo, in characters.
	maxMemoLen = 200
	// maxRequestGas bounds a request's gas limit.
	maxRequestGas = 30_000_000
	// maxSignedLog bounds the signer's record of what it signed.
	maxSignedLog = 1000
	// priceBumpPercent is how much more a replacement must pay than the
	// transaction it replaces: the pool's default --txpool.pricebump.
	priceBumpPercent = 10
)

// defaultFeeCapWei is the signer's default cap on a request's fee: 1 LAX.
var defaultFeeCapWei = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)

// The offline errors the app says in the user's language. Keep them in
// step with WALLET_ERRORS in frontend/src/lib/api.ts.
var (
	ErrOfflineSigner     = errors.New("offline: this app is an offline signer: it never goes online")
	ErrRequestFormat     = errors.New("offline: not a signing request")
	ErrRequestVersion    = errors.New("offline: the signing request is from a newer version of the app")
	ErrRequestChain      = errors.New("offline: the signing request is for another network")
	ErrRequestData       = errors.New("offline: only plain LAX transfers can be signed")
	ErrRequestGas        = errors.New("offline: the signing request's gas is not valid")
	ErrRequestFeeCap     = errors.New("offline: the fee is above the signing fee cap")
	ErrRequestTampered   = errors.New("offline: the signing request does not match its fingerprint")
	ErrRequestAccount    = errors.New("offline: the signing request is for an account this wallet doesn't hold")
	ErrRequestUnknown    = errors.New("offline: no such signing request")
	ErrRequestMemo       = errors.New("offline: the memo is longer than 200 characters")
	ErrSignedFormat      = errors.New("offline: not a signed transaction")
	ErrSignedMismatch    = errors.New("offline: the signed transaction does not match its signing request")
	ErrSignedChain       = errors.New("offline: the signed transaction is for another network")
	ErrSignedSender      = errors.New("offline: the transaction is not signed by an account of this wallet")
	ErrSignedNonceUsed   = errors.New("offline: this transaction's nonce has already been used")
	ErrNotWatchOnly      = errors.New("offline: signing requests are for watch-only accounts")
	ErrOfflineFeeCap     = errors.New("offline: the signing fee cap must be more than 0 LAX")
	errOfflineOnlyOnline = errors.New("offline: this needs the node, which an offline signer never starts")
)

// SignRequestDoc is a signing request as it travels.
type SignRequestDoc struct {
	Type        string `json:"type"`
	Version     int    `json:"version"`
	ID          string `json:"id"`
	ChainID     string `json:"chainId"`
	From        string `json:"from"`
	To          string `json:"to"`
	Nonce       string `json:"nonce"`
	ValueWei    string `json:"valueWei"`
	GasLimit    string `json:"gasLimit"`
	GasPriceWei string `json:"gasPriceWei"`
	CreatedAt   int64  `json:"createdAt"`
	Memo        string `json:"memo,omitempty"`
	// Data is not part of version 1: present only to be refused
	Data *string `json:"data,omitempty"`
}

// SignedTxDoc is a signed transaction as it travels.
type SignedTxDoc struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	ID      string `json:"id"`
	Hash    string `json:"hash"`
	Raw     string `json:"raw"`
	From    string `json:"from"`
	Nonce   string `json:"nonce"`
	ChainID string `json:"chainId"`
}

// OfflineTx is a transfer as either side shows it before acting on it:
// what it moves, what it may cost, and the fingerprint both screens show.
// Amounts are decimal wei strings.
type OfflineTx struct {
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
	ChainID     uint64 `json:"chainId"`
	From        string `json:"from"`
	To          string `json:"to"`
	ValueWei    string `json:"valueWei"`
	Nonce       uint64 `json:"nonce"`
	GasLimit    uint64 `json:"gasLimit"`
	GasPriceWei string `json:"gasPriceWei"`
	MaxFeeWei   string `json:"maxFeeWei"`
	TotalWei    string `json:"totalWei"`
	Memo        string `json:"memo"`
	CreatedAt   int64  `json:"createdAt"`
}

// SigningRequest is a request built for a watch-only account: its document
// (compact JSON, the QR code's content and the file's) and what it says.
type SigningRequest struct {
	Doc string    `json:"doc"`
	Tx  OfflineTx `json:"tx"`
}

// RequestReview is a request as the signer shows it before signing.
// Conflict is set when the signer already signed a different transfer from
// the same account with the same nonce; Signed when it signed this one.
type RequestReview struct {
	Tx       OfflineTx `json:"tx"`
	Conflict bool      `json:"conflict"`
	Signed   bool      `json:"signed"`
}

// SignedOffline is what the signer hands back: the signed document and
// the transaction's hash.
type SignedOffline struct {
	Doc  string    `json:"doc"`
	Hash string    `json:"hash"`
	Tx   OfflineTx `json:"tx"`
}

// SignedReview is a signed transaction as the online wallet shows it before
// broadcasting. Matched is set when it answers one of the wallet's
// requests (Memo then comes from it). Warnings name what may delay it:
// "priceLow" (below the node's suggestion now), "nonceGap" (earlier nonces
// are still unused), "balanceLow" (the balance doesn't cover it now).
type SignedReview struct {
	Tx       OfflineTx `json:"tx"`
	Hash     string    `json:"hash"`
	Matched  bool      `json:"matched"`
	Warnings []string  `json:"warnings"`
}

// PendingRequest is a request the wallet built and is following, until its
// transaction is in a block. Status: "waiting" (for its signature),
// "broadcast" (sent, not yet in a block), "replaced" (a replacement was
// made for its nonce), or "stale" (its nonce was used by another
// transaction).
type PendingRequest struct {
	Doc     string    `json:"doc"`
	Tx      OfflineTx `json:"tx"`
	Status  string    `json:"status"`
	TxHash  string    `json:"txHash"`
	SentAt  int64     `json:"sentAt"`
	Replace string    `json:"replaces"` // the id of the request it replaces
}

// OfflineRequestInput is a send from a watch-only account, as reviewed.
type OfflineRequestInput struct {
	From        string `json:"from"`
	To          string `json:"to"`
	ValueWei    string `json:"valueWei"`
	GasPriceWei string `json:"gasPriceWei"`
	GasLimit    uint64 `json:"gasLimit"`
	Memo        string `json:"memo"`
}

// ---------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------

// parsedRequest is a request that passed every check, ready to sign.
type parsedRequest struct {
	doc     SignRequestDoc
	tx      *types.Transaction
	chainID *big.Int
	from    util.Address
	view    OfflineTx
}

// allowedChain reports whether requests for chainID may be signed: Parallax
// mainnet, and the development chain in development builds.
func allowedChain(chainID *big.Int) bool {
	if chainID.Cmp(chainparams.MainnetChainConfig.ChainID) == 0 {
		return true
	}
	return DevBuild() && chainID.Cmp(chainparams.AllCliqueProtocolChanges.ChainID) == 0
}

// parseSignRequest reads a signing request and checks it as the signer
// must before signing (the spec's list, in order). feeCap bounds its fee.
func parseSignRequest(data string, feeCap *big.Int) (*parsedRequest, error) {
	if len(data) > maxOfflineDoc {
		return nil, ErrRequestFormat
	}
	var doc SignRequestDoc
	if err := json.Unmarshal([]byte(strings.TrimSpace(data)), &doc); err != nil || doc.Type != signRequestType {
		return nil, ErrRequestFormat
	}
	if doc.Version != offlineVersion {
		return nil, ErrRequestVersion
	}
	chainID, ok := parseDecimal(doc.ChainID)
	if !ok || chainID.Sign() <= 0 {
		return nil, ErrRequestFormat
	}
	if !allowedChain(chainID) {
		return nil, ErrRequestChain
	}
	from, err := parseRecipient(doc.From)
	if err != nil {
		return nil, ErrRequestFormat
	}
	to, err := parseRecipient(doc.To)
	if err != nil {
		return nil, err
	}
	nonce, okNonce := parseUint(doc.Nonce)
	gas, okGas := parseUint(doc.GasLimit)
	value, okValue := parseDecimal(doc.ValueWei)
	price, okPrice := parseDecimal(doc.GasPriceWei)
	if !okNonce || !okGas || !okValue || !okPrice {
		return nil, ErrRequestFormat
	}
	if price.Sign() <= 0 || gas < chainparams.TxGas || gas > maxRequestGas {
		return nil, ErrRequestGas
	}
	if doc.Data != nil && *doc.Data != "" && *doc.Data != "0x" {
		return nil, ErrRequestData
	}
	maxFee := new(big.Int).Mul(price, new(big.Int).SetUint64(gas))
	if maxFee.Cmp(feeCap) > 0 {
		return nil, ErrRequestFeeCap
	}
	if utf8.RuneCountInString(doc.Memo) > maxMemoLen {
		return nil, ErrRequestMemo
	}
	tx := types.NewTransaction(nonce, to, value, gas, price, nil)
	id := types.LatestSignerForChainID(chainID).Hash(tx)
	if !strings.EqualFold(doc.ID, id.Hex()) {
		return nil, ErrRequestTampered
	}
	return &parsedRequest{
		doc: doc, tx: tx, chainID: chainID, from: from,
		view: offlineView(id, chainID, from, tx, doc.Memo, doc.CreatedAt),
	}, nil
}

// newSignRequest describes a transfer as a signing request.
func newSignRequest(chainID *big.Int, from util.Address, tx *types.Transaction, memo string, now time.Time) SigningRequest {
	id := types.LatestSignerForChainID(chainID).Hash(tx)
	doc := SignRequestDoc{
		Type:        signRequestType,
		Version:     offlineVersion,
		ID:          id.Hex(),
		ChainID:     chainID.String(),
		From:        from.Hex(),
		To:          tx.To().Hex(),
		Nonce:       strconv.FormatUint(tx.Nonce(), 10),
		ValueWei:    tx.Value().String(),
		GasLimit:    strconv.FormatUint(tx.Gas(), 10),
		GasPriceWei: tx.GasPrice().String(),
		CreatedAt:   now.Unix(),
		Memo:        memo,
	}
	data, _ := json.Marshal(doc)
	return SigningRequest{Doc: string(data), Tx: offlineView(id, chainID, from, tx, memo, doc.CreatedAt)}
}

// offlineView describes a transfer for the screens.
func offlineView(id util.Hash, chainID *big.Int, from util.Address, tx *types.Transaction, memo string, created int64) OfflineTx {
	maxFee := new(big.Int).Mul(tx.GasPrice(), new(big.Int).SetUint64(tx.Gas()))
	v := OfflineTx{
		ID:          id.Hex(),
		Fingerprint: Fingerprint(id.Hex()),
		ChainID:     chainID.Uint64(),
		From:        from.Hex(),
		ValueWei:    tx.Value().String(),
		Nonce:       tx.Nonce(),
		GasLimit:    tx.Gas(),
		GasPriceWei: tx.GasPrice().String(),
		MaxFeeWei:   maxFee.String(),
		TotalWei:    new(big.Int).Add(maxFee, tx.Value()).String(),
		Memo:        memo,
		CreatedAt:   created,
	}
	if to := tx.To(); to != nil {
		v.To = to.Hex()
	}
	return v
}

// Fingerprint is the short form of a request id both screens show, for the
// user to see they are signing the request they made: its first eight hex
// digits, upper case, in two groups (3FA2-91C0).
func Fingerprint(id string) string {
	h := strings.ToUpper(strings.TrimPrefix(strings.TrimPrefix(id, "0x"), "0X"))
	if len(h) < 8 {
		return h
	}
	return h[:4] + "-" + h[4:8]
}

// parseSignedTx reads a signed document, or a bare 0x raw transaction (as
// `parallax-wallet signtx` prints), into the transaction and the request
// id it claims to answer (empty for a bare one).
func parseSignedTx(data string) (*types.Transaction, string, error) {
	data = strings.TrimSpace(data)
	if len(data) > maxOfflineDoc {
		return nil, "", ErrSignedFormat
	}
	raw, id := data, ""
	if strings.HasPrefix(data, "{") {
		var doc SignedTxDoc
		if err := json.Unmarshal([]byte(data), &doc); err != nil || doc.Type != signedTxType {
			return nil, "", ErrSignedFormat
		}
		if doc.Version != offlineVersion {
			return nil, "", ErrRequestVersion
		}
		raw, id = doc.Raw, doc.ID
	}
	b, err := hexutil.Decode(raw)
	if err != nil {
		return nil, "", ErrSignedFormat
	}
	tx := new(types.Transaction)
	if err := tx.UnmarshalBinary(b); err != nil || tx.Type() != types.LegacyTxType {
		return nil, "", ErrSignedFormat
	}
	return tx, id, nil
}

// parseDecimal reads a decimal string of ASCII digits, at most 256 bits,
// as `parallax-wallet signrequest` does.
func parseDecimal(s string) (*big.Int, bool) {
	if s == "" || strings.TrimLeft(s, "0123456789") != "" {
		return nil, false
	}
	v, ok := new(big.Int).SetString(s, 10)
	if !ok || v.BitLen() > 256 {
		return nil, false
	}
	return v, true
}

func parseUint(s string) (uint64, bool) {
	v, ok := parseDecimal(s)
	if !ok || !v.IsUint64() {
		return 0, false
	}
	return v.Uint64(), true
}

// ---------------------------------------------------------------------------
// The signer
// ---------------------------------------------------------------------------

// signedRecord is one transfer the signer signed, kept to warn before it
// signs a different one from the same account with the same nonce.
type signedRecord struct {
	ID      string `json:"id"`
	ChainID uint64 `json:"chainId"`
	From    string `json:"from"`
	Nonce   uint64 `json:"nonce"`
	Hash    string `json:"hash"`
	At      int64  `json:"at"`
}

// feeCap is the signer's cap on a request's fee, from the settings.
func (w *Wallet) feeCap() *big.Int {
	if w.node != nil && w.node.cfg != nil {
		if v, ok := parseDecimal(w.node.cfg.Get().OfflineFeeCapWei); ok && v.Sign() > 0 {
			return v
		}
	}
	return new(big.Int).Set(defaultFeeCapWei)
}

// ReviewRequest checks a scanned or opened signing request, for the signer
// to show before asking for the password.
func (w *Wallet) ReviewRequest(data string) (RequestReview, error) {
	req, err := parseSignRequest(data, w.feeCap())
	if err != nil {
		return RequestReview{}, err
	}
	if _, err := w.find(req.from.Hex()); err != nil {
		return RequestReview{}, ErrRequestAccount
	}
	rev := RequestReview{Tx: req.view}
	for _, r := range w.signedLog() {
		if r.ChainID != req.view.ChainID || r.From != req.view.From || r.Nonce != req.view.Nonce {
			continue
		}
		if strings.EqualFold(r.ID, req.view.ID) {
			rev.Signed = true
		} else {
			rev.Conflict = true
		}
	}
	return rev, nil
}

// SignRequest signs a signing request with the wallet password, after the
// same checks as ReviewRequest, and returns the signed document to carry
// back. Signing is deterministic: the same request always signs to the
// same transaction.
func (w *Wallet) SignRequest(data, password string) (SignedOffline, error) {
	req, err := parseSignRequest(data, w.feeCap())
	if err != nil {
		return SignedOffline{}, err
	}
	acc, err := w.find(req.from.Hex())
	if err != nil {
		return SignedOffline{}, ErrRequestAccount
	}
	if len(password) > maxPasswordLen {
		return SignedOffline{}, ErrWrongPassword
	}
	w.keyMu.Lock()
	signed, err := w.sign(acc, password, req.tx, req.chainID)
	w.keyMu.Unlock()
	if err != nil {
		return SignedOffline{}, err
	}
	if types.LatestSignerForChainID(req.chainID).Hash(signed).Hex() != req.view.ID {
		return SignedOffline{}, errors.New("offline: the signature does not cover the request")
	}
	raw, err := signed.MarshalBinary()
	if err != nil {
		return SignedOffline{}, err
	}
	doc, _ := json.Marshal(SignedTxDoc{
		Type:    signedTxType,
		Version: offlineVersion,
		ID:      req.view.ID,
		Hash:    signed.Hash().Hex(),
		Raw:     hexutil.Encode(raw),
		From:    acc.Address.Hex(),
		Nonce:   strconv.FormatUint(signed.Nonce(), 10),
		ChainID: req.chainID.String(),
	})
	w.recordSigned(signedRecord{
		ID: req.view.ID, ChainID: req.view.ChainID, From: req.view.From,
		Nonce: req.view.Nonce, Hash: signed.Hash().Hex(), At: time.Now().Unix(),
	})
	logging.Info("Signed an offline signing request", "id", req.view.ID, "from", acc.Address, "nonce", signed.Nonce(), "hash", signed.Hash())
	return SignedOffline{Doc: string(doc), Hash: signed.Hash().Hex(), Tx: req.view}, nil
}

func (w *Wallet) signedLogPath() string { return filepath.Join(filepath.Dir(w.dir), "signed.json") }

func (w *Wallet) signedLog() []signedRecord {
	w.signedMu.Lock()
	defer w.signedMu.Unlock()
	return w.signedLogLocked()
}

func (w *Wallet) signedLogLocked() []signedRecord {
	var out []signedRecord
	if data, err := os.ReadFile(w.signedLogPath()); err == nil {
		if err := json.Unmarshal(data, &out); err != nil {
			logging.Warn("Ignoring an unreadable record of signed requests", "err", err)
			return nil
		}
	}
	return out
}

// recordSigned adds to the signer's record, keeping the latest entries. A
// failure only costs the warning it would give, so it is logged.
func (w *Wallet) recordSigned(r signedRecord) {
	w.signedMu.Lock()
	defer w.signedMu.Unlock()
	log := append(w.signedLogLocked(), r)
	if len(log) > maxSignedLog {
		log = log[len(log)-maxSignedLog:]
	}
	data, _ := json.MarshalIndent(log, "", "  ")
	if err := writePrivateFile(w.signedLogPath(), data); err != nil {
		logging.Warn("Failed to record a signed request", "err", err)
	}
}

// ---------------------------------------------------------------------------
// The online wallet
// ---------------------------------------------------------------------------

// requestStore is the requests the wallet built and follows, in
// requests.json beside the keystore.
type requestStore struct {
	mu   sync.Mutex
	path string
}

func (w *Wallet) requestStore() *requestStore {
	w.reqOnce.Do(func() {
		w.requests = &requestStore{path: filepath.Join(filepath.Dir(w.dir), "requests.json")}
	})
	return w.requests
}

// load reads the requests; the caller holds s.mu.
func (s *requestStore) load() []PendingRequest {
	var out []PendingRequest
	data, err := os.ReadFile(s.path)
	if err != nil {
		return []PendingRequest{}
	}
	if err := json.Unmarshal(data, &out); err != nil {
		logging.Warn("Ignoring an unreadable list of signing requests", "err", err)
		return []PendingRequest{}
	}
	return out
}

// save writes the requests; the caller holds s.mu.
func (s *requestStore) save(list []PendingRequest) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateFile(s.path, data)
}

// BuildRequest makes a signing request for a send from a watch-only
// account, as reviewed from its quote: the node gives the nonce (the next
// after every request still outstanding) and checks the fee and the
// balance as a send would.
func (w *Wallet) BuildRequest(in OfflineRequestInput) (SigningRequest, error) {
	from, watch, err := w.known(in.From)
	if err != nil {
		return SigningRequest{}, err
	}
	if !watch {
		return SigningRequest{}, ErrNotWatchOnly
	}
	to, err := parseRecipient(in.To)
	if err != nil {
		return SigningRequest{}, err
	}
	value, err := parseWei(in.ValueWei, ErrBadAmount)
	if err != nil {
		return SigningRequest{}, err
	}
	price, err := parseWei(in.GasPriceWei, ErrBadFee)
	if err != nil || price.Sign() <= 0 {
		return SigningRequest{}, ErrBadFee
	}
	memo := strings.TrimSpace(in.Memo)
	if utf8.RuneCountInString(memo) > maxMemoLen {
		return SigningRequest{}, ErrRequestMemo
	}
	return w.buildRequest(from, to, value, price, in.GasLimit, memo, nil, "")
}

// buildRequest makes and stores a request; nonce, when given, is used as
// is (a replacement), else the next free one is taken.
func (w *Wallet) buildRequest(from, to util.Address, value, price *big.Int, gas uint64, memo string, nonce *uint64, replaces string) (SigningRequest, error) {
	prl := w.node.Parallax()
	if prl == nil {
		if w.node.cfg != nil && w.node.cfg.Get().OfflineSigner {
			return SigningRequest{}, errOfflineOnlyOnline
		}
		return SigningRequest{}, ErrNodeStopped
	}
	head := prl.BlockChain().CurrentBlock()
	if gas < chainparams.TxGas || head == nil || gas > head.GasLimit() {
		return SigningRequest{}, ErrBadFee
	}
	if price.Cmp(prl.TxPool().GasPrice()) < 0 {
		return SigningRequest{}, ErrFeeTooLow
	}
	ec, chainID, err := w.readyNode()
	if err != nil {
		return SigningRequest{}, err
	}
	defer ec.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	balance, err := ec.PendingBalanceAt(ctx, from)
	if err != nil {
		return SigningRequest{}, err
	}
	fee := new(big.Int).Mul(price, new(big.Int).SetUint64(gas))
	if balance.Cmp(new(big.Int).Add(value, fee)) < 0 {
		return SigningRequest{}, ErrInsufficientFee
	}

	store := w.requestStore()
	store.mu.Lock()
	defer store.mu.Unlock()
	list := store.load()

	var n uint64
	if nonce != nil {
		n = *nonce
	} else {
		if n, err = ec.PendingNonceAt(ctx, from); err != nil {
			return SigningRequest{}, err
		}
		// After every request from the account still outstanding
		for _, r := range list {
			if r.Tx.From == from.Hex() && r.Tx.ChainID == chainID.Uint64() && r.Status != "stale" && r.Tx.Nonce >= n {
				n = r.Tx.Nonce + 1
			}
		}
	}

	req := newSignRequest(chainID, from, types.NewTransaction(n, to, value, gas, price, nil), memo, time.Now())
	if replaces != "" {
		for i := range list {
			if list[i].Tx.ID == replaces {
				list[i].Status = "replaced"
			}
		}
	}
	list = append(list, PendingRequest{Doc: req.Doc, Tx: req.Tx, Status: "waiting", Replace: replaces})
	if err := store.save(list); err != nil {
		return SigningRequest{}, err
	}
	logging.Info("Made an offline signing request", "id", req.Tx.ID, "from", from, "nonce", n)
	return req, nil
}

// PendingRequests lists the requests the wallet follows, oldest nonce
// first, each with its status as the chain now says: one whose
// transaction is in a block is dropped, one whose nonce went to another
// transaction is "stale".
func (w *Wallet) PendingRequests() ([]PendingRequest, error) {
	store := w.requestStore()
	store.mu.Lock()
	defer store.mu.Unlock()
	list := store.load()

	prl := w.node.Parallax()
	if prl != nil {
		if st, err := prl.BlockChain().State(); err == nil {
			kept := list[:0:0]
			changed := false
			for _, r := range list {
				used := st.GetNonce(util.HexToAddress(r.Tx.From)) > r.Tx.Nonce
				if used {
					mined := false
					if r.TxHash != "" {
						tx, _, _, _, _ := prl.APIBackend.GetTransaction(context.Background(), util.HexToHash(r.TxHash))
						mined = tx != nil
					}
					// Its transaction is in a block, or a replacement's is
					if mined || r.Status == "replaced" {
						changed = true
						continue
					}
					if r.Status != "stale" {
						r.Status, changed = "stale", true
					}
				}
				kept = append(kept, r)
			}
			if changed {
				list = kept
				if err := store.save(list); err != nil {
					logging.Warn("Failed to save the signing requests", "err", err)
				}
			}
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Tx.From != list[j].Tx.From {
			return list[i].Tx.From < list[j].Tx.From
		}
		return list[i].Tx.Nonce < list[j].Tx.Nonce
	})
	return list, nil
}

// DiscardRequest stops following a request. Its nonce is free again only
// if no later request took the next one; the app offers a replacement for
// that case.
func (w *Wallet) DiscardRequest(id string) error {
	store := w.requestStore()
	store.mu.Lock()
	defer store.mu.Unlock()
	list := store.load()
	kept := list[:0:0]
	for _, r := range list {
		if !strings.EqualFold(r.Tx.ID, id) {
			kept = append(kept, r)
		}
	}
	if len(kept) == len(list) {
		return ErrRequestUnknown
	}
	return store.save(kept)
}

// ReplaceRequest makes a request that takes the same nonce for a 0-LAX send
// from the account to itself, paying enough more than the original for the
// pool to take it in its place: the way to cancel a transfer that was
// sent but is stuck, or to fill the nonce of one that will never be signed.
func (w *Wallet) ReplaceRequest(id string) (SigningRequest, error) {
	store := w.requestStore()
	store.mu.Lock()
	var old *PendingRequest
	for _, r := range store.load() {
		if strings.EqualFold(r.Tx.ID, id) {
			r := r
			old = &r
		}
	}
	store.mu.Unlock()
	if old == nil {
		return SigningRequest{}, ErrRequestUnknown
	}
	from := util.HexToAddress(old.Tx.From)
	oldPrice, _ := parseDecimal(old.Tx.GasPriceWei)
	// At least the pool's bump over the original, and the node's suggestion
	price := bumpedPrice(oldPrice, priceBumpPercent)
	if prl := w.node.Parallax(); prl != nil {
		if ec, _, err := w.readyNode(); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			if suggested, err := ec.SuggestGasPrice(ctx); err == nil && suggested.Cmp(price) > 0 {
				price = suggested
			}
			cancel()
			ec.Close()
		}
	}
	nonce := old.Tx.Nonce
	return w.buildRequest(from, from, new(big.Int), price, chainparams.TxGas, "", &nonce, old.Tx.ID)
}

// ReviewSigned checks a scanned or opened signed transaction before it is
// broadcast: a replay-protected legacy transfer for this node's chain,
// signed by one of the wallet's accounts, matching its request when it
// names one, with a nonce not yet used.
func (w *Wallet) ReviewSigned(data string) (SignedReview, error) {
	rev, _, err := w.checkSigned(data)
	return rev, err
}

func (w *Wallet) checkSigned(data string) (SignedReview, *types.Transaction, error) {
	tx, claimed, err := parseSignedTx(data)
	if err != nil {
		return SignedReview{}, nil, err
	}
	prl := w.node.Parallax()
	if prl == nil {
		return SignedReview{}, nil, ErrNodeStopped
	}
	chainID := prl.BlockChain().Config().ChainID
	if !tx.Protected() || tx.ChainId().Cmp(chainID) != 0 {
		return SignedReview{}, nil, ErrSignedChain
	}
	if len(tx.Data()) > 0 || tx.To() == nil {
		return SignedReview{}, nil, ErrRequestData
	}
	signer := types.LatestSignerForChainID(chainID)
	from, err := types.Sender(signer, tx)
	if err != nil {
		return SignedReview{}, nil, ErrSignedFormat
	}
	if _, _, err := w.known(from.Hex()); err != nil {
		return SignedReview{}, nil, ErrSignedSender
	}
	id := signer.Hash(tx).Hex()
	if claimed != "" && !strings.EqualFold(claimed, id) {
		return SignedReview{}, nil, ErrSignedMismatch
	}

	rev := SignedReview{Hash: tx.Hash().Hex(), Warnings: []string{}}
	memo, created := "", int64(0)
	store := w.requestStore()
	store.mu.Lock()
	for _, r := range store.load() {
		if strings.EqualFold(r.Tx.ID, id) {
			rev.Matched, memo, created = true, r.Tx.Memo, r.Tx.CreatedAt
		}
	}
	store.mu.Unlock()
	rev.Tx = offlineView(util.HexToHash(id), chainID, from, tx, memo, created)

	st, err := prl.BlockChain().State()
	if err != nil {
		return SignedReview{}, nil, ErrNodeSyncing
	}
	if tx.Nonce() < st.GetNonce(from) {
		return SignedReview{}, nil, ErrSignedNonceUsed
	}
	if tx.Nonce() > prl.TxPool().Nonce(from) {
		rev.Warnings = append(rev.Warnings, "nonceGap")
	}
	if ec, _, err := w.readyNode(); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if suggested, err := ec.SuggestGasPrice(ctx); err == nil && tx.GasPrice().Cmp(suggested) < 0 {
			rev.Warnings = append(rev.Warnings, "priceLow")
		}
		if bal, err := ec.PendingBalanceAt(ctx, from); err == nil && bal.Cmp(tx.Cost()) < 0 {
			rev.Warnings = append(rev.Warnings, "balanceLow")
		}
		cancel()
		ec.Close()
	}
	return rev, tx, nil
}

// Broadcast sends a signed transaction, checked again as ReviewSigned does,
// through the node, and marks its request sent.
func (w *Wallet) Broadcast(data string) (SentTx, error) {
	rev, tx, err := w.checkSigned(data)
	if err != nil {
		return SentTx{}, err
	}
	ec, _, err := w.readyNode()
	if err != nil {
		return SentTx{}, err
	}
	defer ec.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := ec.SendTransaction(ctx, tx); err != nil {
		return SentTx{}, fmt.Errorf("wallet: the node refused the transaction: %w", err)
	}
	if rev.Matched {
		store := w.requestStore()
		store.mu.Lock()
		list := store.load()
		for i := range list {
			if strings.EqualFold(list[i].Tx.ID, rev.Tx.ID) {
				list[i].Status, list[i].TxHash, list[i].SentAt = "broadcast", tx.Hash().Hex(), time.Now().Unix()
			}
		}
		if err := store.save(list); err != nil {
			logging.Warn("Failed to save the signing requests", "err", err)
		}
		store.mu.Unlock()
	}
	logging.Info("Broadcast an offline-signed transaction", "hash", tx.Hash(), "from", rev.Tx.From, "nonce", tx.Nonce())
	return SentTx{Hash: tx.Hash().Hex(), Nonce: tx.Nonce()}, nil
}
