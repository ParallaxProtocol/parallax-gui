// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ParallaxProtocol/parallax/v2/crypto"
	"github.com/ParallaxProtocol/parallax/v2/logging"
	"github.com/ParallaxProtocol/parallax/v2/util"
	"github.com/ParallaxProtocol/parallax/v2/util/hexutil"
	"github.com/ParallaxProtocol/parallax/v2/wallet"
	"github.com/ParallaxProtocol/parallax/v2/wallet/keystore"
)

// Signing and verifying messages: text signed with an account's key to
// prove it controls the address, the EIP-191 personal_sign scheme
// `parallax-wallet signmessage` uses. Only text is ever signed, behind the
// "\x19Ethereum Signed Message:\n<length>" prefix, never a raw hash, which
// could be a transaction's. A watch-only account signs on its offline
// signer, by a message signing request (offline.go has the transfers):
//
//	request: {"type":"parallax-sign-message-request","version":1,"id",
//	  "from","message","createdAt"}
//	signed:  {"type":"parallax-signed-message","version":1,"id",
//	  "address","message","signature"}
//
// id is the message's EIP-191 hash. Signatures are written 0x-prefixed
// with v = 27/28, the common wallet form, and read in that form or as
// parallax-wallet signmessage prints them (no 0x, v = 0/1).

const (
	signMessageRequestType = "parallax-sign-message-request"
	signedMessageType      = "parallax-signed-message"
	// maxMessageBytes bounds a message, small enough for one QR code.
	maxMessageBytes = 1024
)

var (
	ErrMessageText      = errors.New("message: the message must be 1 to 1024 bytes of text, without control characters")
	ErrBadSignature     = errors.New("message: not a valid signature")
	ErrMessageAddress   = errors.New("message: not a valid address")
	ErrMessageRequest   = errors.New("message: not a message signing request")
	ErrMessageSigned    = errors.New("message: not a signed message")
	ErrMessageTampered  = errors.New("message: the message does not match its fingerprint")
	ErrMessageNotSigner = errors.New("message: the signature is not from that address")
)

// SignedMessage is a message and its signature, as signed here or on the
// offline signer, with the fingerprint both screens show.
type SignedMessage struct {
	Address     string `json:"address"`
	Message     string `json:"message"`
	Signature   string `json:"signature"`
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
	// Doc is the signed document, for the offline signer to show back
	Doc string `json:"doc,omitempty"`
}

// MessageCheck is what verifying a signature found: whether it is from
// the address, and who it is from, whether or not that is the address.
type MessageCheck struct {
	Valid     bool   `json:"valid"`
	Recovered string `json:"recovered"`
}

// MessageRequest is a message signing request: its document (the QR code's
// and the file's content) and what it asks.
type MessageRequest struct {
	Doc         string `json:"doc"`
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
	From        string `json:"from"`
	Message     string `json:"message"`
	CreatedAt   int64  `json:"createdAt"`
}

// SignedMessageReview is a signed message as the online wallet checks it.
type SignedMessageReview struct {
	SignedMessage
	MessageCheck
}

type messageRequestDoc struct {
	Type      string `json:"type"`
	Version   int    `json:"version"`
	ID        string `json:"id"`
	From      string `json:"from"`
	Message   string `json:"message"`
	CreatedAt int64  `json:"createdAt"`
}

type signedMessageDoc struct {
	Type      string `json:"type"`
	Version   int    `json:"version"`
	ID        string `json:"id"`
	Address   string `json:"address"`
	Message   string `json:"message"`
	Signature string `json:"signature"`
}

// checkMessage enforces the message rules: valid UTF-8, 1 to 1024 bytes,
// and no control characters but line feeds and tabs, so what is shown is
// all that is signed.
func checkMessage(msg string) error {
	if len(msg) == 0 || len(msg) > maxMessageBytes || !utf8.ValidString(msg) {
		return ErrMessageText
	}
	for _, r := range msg {
		if unicode.Is(unicode.Cc, r) && r != '\n' && r != '\t' {
			return ErrMessageText
		}
	}
	return nil
}

// messageID is the message's EIP-191 hash, the one that is signed.
func messageID(msg string) string { return hexutil.Encode(wallet.TextHash([]byte(msg))) }

// parseSignature reads a 65-byte signature, 0x-prefixed or not, with v as
// 27/28 or 0/1, into the 0/1 form recovery takes.
func parseSignature(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "0x"), "0X")
	sig, err := hex.DecodeString(s)
	if err != nil || len(sig) != crypto.SignatureLength {
		return nil, ErrBadSignature
	}
	if sig[64] >= 27 {
		sig[64] -= 27
	}
	if sig[64] > 1 {
		return nil, ErrBadSignature
	}
	return sig, nil
}

// encodeSignature writes a 0/1 signature in the common form: 0x, v 27/28.
func encodeSignature(sig []byte) string {
	out := append([]byte(nil), sig...)
	out[64] += 27
	return hexutil.Encode(out)
}

// recoverSigner is the address that made sig over msg.
func recoverSigner(msg string, sig []byte) (util.Address, error) {
	pub, err := crypto.SigToPub(wallet.TextHash([]byte(msg)), sig)
	if err != nil || pub == nil {
		return util.Address{}, ErrBadSignature
	}
	return crypto.PubkeyToAddress(*pub), nil
}

// parseMessageAddress reads an address as a recipient is read: a
// mixed-case one must pass its checksum, and never the zero address.
func parseMessageAddress(s string) (util.Address, error) {
	addr, err := parseRecipient(s)
	if err != nil {
		return util.Address{}, ErrMessageAddress
	}
	return addr, nil
}

// VerifyMessage checks that signature is address's over message. It needs
// no wallet: anyone can check anyone's signature.
func VerifyMessage(address, message, signature string) (MessageCheck, error) {
	addr, err := parseMessageAddress(address)
	if err != nil {
		return MessageCheck{}, err
	}
	if err := checkMessage(message); err != nil {
		return MessageCheck{}, err
	}
	sig, err := parseSignature(signature)
	if err != nil {
		return MessageCheck{}, err
	}
	signer, err := recoverSigner(message, sig)
	if err != nil {
		return MessageCheck{}, err
	}
	return MessageCheck{Valid: signer == addr, Recovered: signer.Hex()}, nil
}

// SignMessage signs message with one of the wallet's keys and its password.
func (w *Wallet) SignMessage(address, message, password string) (SignedMessage, error) {
	acc, err := w.find(address)
	if err != nil {
		if _, watch, _ := w.known(address); watch {
			return SignedMessage{}, ErrWatchOnly
		}
		return SignedMessage{}, err
	}
	return w.signMessage(acc, message, password)
}

func (w *Wallet) signMessage(acc wallet.Account, message, password string) (SignedMessage, error) {
	if err := checkMessage(message); err != nil {
		return SignedMessage{}, err
	}
	if len(password) > maxPasswordLen {
		return SignedMessage{}, ErrWrongPassword
	}
	w.keyMu.Lock()
	sig, err := w.ks.SignHashWithPassphrase(acc, password, wallet.TextHash([]byte(message)))
	if errors.Is(err, keystore.ErrDecrypt) {
		err = w.keyError(password)
	}
	w.keyMu.Unlock()
	if err != nil {
		return SignedMessage{}, err
	}
	// Belt and braces: the signature must recover to the account
	if signer, err := recoverSigner(message, sig); err != nil || signer != acc.Address {
		return SignedMessage{}, errors.New("message: the signature does not match the account")
	}
	id := messageID(message)
	logging.Info("Signed a message", "address", acc.Address, "id", id)
	return SignedMessage{
		Address: acc.Address.Hex(), Message: message, Signature: encodeSignature(sig),
		ID: id, Fingerprint: Fingerprint(id),
	}, nil
}

// BuildMessageRequest makes a message signing request for a watch-only
// account, to sign on its offline signer.
func (w *Wallet) BuildMessageRequest(address, message string) (MessageRequest, error) {
	from, watch, err := w.known(address)
	if err != nil {
		return MessageRequest{}, err
	}
	if !watch {
		return MessageRequest{}, ErrNotWatchOnly
	}
	if err := checkMessage(message); err != nil {
		return MessageRequest{}, err
	}
	doc := messageRequestDoc{
		Type: signMessageRequestType, Version: offlineVersion, ID: messageID(message),
		From: from.Hex(), Message: message, CreatedAt: time.Now().Unix(),
	}
	data, _ := json.Marshal(doc)
	return MessageRequest{
		Doc: string(data), ID: doc.ID, Fingerprint: Fingerprint(doc.ID),
		From: doc.From, Message: message, CreatedAt: doc.CreatedAt,
	}, nil
}

// parseMessageRequest reads a message signing request and checks it as the
// signer must before signing.
func parseMessageRequest(data string) (MessageRequest, error) {
	if len(data) > maxOfflineDoc {
		return MessageRequest{}, ErrMessageRequest
	}
	var doc messageRequestDoc
	if err := json.Unmarshal([]byte(strings.TrimSpace(data)), &doc); err != nil || doc.Type != signMessageRequestType {
		return MessageRequest{}, ErrMessageRequest
	}
	if doc.Version != offlineVersion {
		return MessageRequest{}, ErrRequestVersion
	}
	from, err := parseMessageAddress(doc.From)
	if err != nil {
		return MessageRequest{}, err
	}
	if err := checkMessage(doc.Message); err != nil {
		return MessageRequest{}, err
	}
	id := messageID(doc.Message)
	if !strings.EqualFold(doc.ID, id) {
		return MessageRequest{}, ErrMessageTampered
	}
	return MessageRequest{
		Doc: data, ID: id, Fingerprint: Fingerprint(id),
		From: from.Hex(), Message: doc.Message, CreatedAt: doc.CreatedAt,
	}, nil
}

// ReviewMessageRequest checks a scanned message signing request on the
// signer, which must hold the account's key.
func (w *Wallet) ReviewMessageRequest(data string) (MessageRequest, error) {
	req, err := parseMessageRequest(data)
	if err != nil {
		return MessageRequest{}, err
	}
	if _, err := w.find(req.From); err != nil {
		return MessageRequest{}, ErrRequestAccount
	}
	return req, nil
}

// SignMessageRequest signs a message signing request on the signer and
// returns the signed document to carry back.
func (w *Wallet) SignMessageRequest(data, password string) (SignedMessage, error) {
	req, err := parseMessageRequest(data)
	if err != nil {
		return SignedMessage{}, err
	}
	acc, err := w.find(req.From)
	if err != nil {
		return SignedMessage{}, ErrRequestAccount
	}
	signed, err := w.signMessage(acc, req.Message, password)
	if err != nil {
		return SignedMessage{}, err
	}
	doc, _ := json.Marshal(signedMessageDoc{
		Type: signedMessageType, Version: offlineVersion, ID: signed.ID,
		Address: signed.Address, Message: signed.Message, Signature: signed.Signature,
	})
	signed.Doc = string(doc)
	return signed, nil
}

// ReviewSignedMessage checks a signed message brought back from a signer:
// its id must be its message's, and its signature is verified against its
// address.
func ReviewSignedMessage(data string) (SignedMessageReview, error) {
	if len(data) > maxOfflineDoc {
		return SignedMessageReview{}, ErrMessageSigned
	}
	var doc signedMessageDoc
	if err := json.Unmarshal([]byte(strings.TrimSpace(data)), &doc); err != nil || doc.Type != signedMessageType {
		return SignedMessageReview{}, ErrMessageSigned
	}
	if doc.Version != offlineVersion {
		return SignedMessageReview{}, ErrRequestVersion
	}
	check, err := VerifyMessage(doc.Address, doc.Message, doc.Signature)
	if err != nil {
		return SignedMessageReview{}, err
	}
	id := messageID(doc.Message)
	if !strings.EqualFold(doc.ID, id) {
		return SignedMessageReview{}, ErrMessageTampered
	}
	sig, _ := parseSignature(doc.Signature)
	return SignedMessageReview{
		SignedMessage: SignedMessage{
			Address: util.HexToAddress(doc.Address).Hex(), Message: doc.Message,
			Signature: encodeSignature(sig), ID: id, Fingerprint: Fingerprint(id),
		},
		MessageCheck: check,
	}, nil
}
