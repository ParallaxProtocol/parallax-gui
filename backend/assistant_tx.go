// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"context"
	"fmt"
	"math/big"
	"slices"
	"strings"

	"github.com/ParallaxProtocol/parallax-mcp/pkg/server"
)

// RequestTransaction asks the user to send LAX from a wallet account.
const RequestTransaction = "transaction"

// TxProposal is a send an assistant asks for, as quoted when it asked:
// what the user reviews before approving it with the wallet password.
type TxProposal struct {
	From     string `json:"from"`
	FromName string `json:"fromName"`
	// WatchOnly sends make a signing request for the offline signer
	// instead, as the app's Send page does for those accounts
	WatchOnly bool   `json:"watchOnly"`
	To        string `json:"to"`
	// Recipient says who the address is to the wallet: one of its own
	// accounts ("own"), a contact ("contact", with its name), or an
	// address it has never seen ("new")
	Recipient   string `json:"recipient"`
	ToName      string `json:"toName,omitempty"`
	ToContract  bool   `json:"toContract"`
	ValueWei    string `json:"valueWei"`
	GasPriceWei string `json:"gasPriceWei"`
	GasLimit    uint64 `json:"gasLimit"`
	FeeWei      string `json:"feeWei"`
	TotalWei    string `json:"totalWei"`
	BalanceWei  string `json:"balanceWei"`
}

type txIn struct {
	From     string `json:"from" jsonschema:"the wallet account to send from: an address from wallet_accounts"`
	To       string `json:"to" jsonschema:"the address to send to"`
	ValueLAX string `json:"value_lax,omitempty" jsonschema:"the amount in LAX, as a decimal string such as \"1.5\""`
	ValueWei string `json:"value_wei,omitempty" jsonschema:"the amount in wei, as a decimal string, instead of value_lax"`
	Reason   string `json:"reason" jsonschema:"why you ask, in a sentence the user reads before deciding"`
}

// laxToWei reads a decimal amount of LAX, to the wei.
func laxToWei(s string) (*big.Int, bool) {
	s = strings.TrimSpace(s)
	if s == "" || s == "." {
		return nil, false
	}
	whole, frac, _ := strings.Cut(s, ".")
	if whole == "" {
		whole = "0"
	}
	if len(frac) > 18 || strings.Trim(whole+frac, "0123456789") != "" || whole+frac == "" {
		return nil, false
	}
	v, ok := new(big.Int).SetString(whole+frac+strings.Repeat("0", 18-len(frac)), 10)
	return v, ok
}

func (a *Assistant) registerTransactions(r *server.Registrar) {
	server.Add(r, server.Spec{Group: GroupApp, Name: "request_transaction", Title: "Ask to send LAX", Changes: true, Destructive: true, Timeout: a.permitTimeout(),
		Description: `Asks the user to send LAX from one of the wallet's accounts to an address. The app quotes it first (fee at the node's suggested gas price, total, balance) and refuses what the balance doesn't cover or what would pay more than the user's fee cap. The user reviews the amount, the recipient (one of their accounts, a contact, or an address they have never used), the fee and the total, and approves it with the wallet password, which you never see. Once approved it returns the transaction's hash; from a watch-only account it makes a signing request the user signs on their offline signer. Plain transfers only: no contract calls.` + requestNote + requestPermitNote},
		func(ctx context.Context, in txIn) (any, error) {
			if err := a.permit(ctx, "sendTransactions"); err != nil {
				return nil, err
			}
			w, err := a.wallet()
			if err != nil {
				return nil, err
			}
			from, watch, err := w.known(in.From)
			if err != nil {
				return nil, server.Inputf("%s is not an account in the wallet; wallet_accounts lists them", in.From)
			}
			to, err := parseRecipient(in.To)
			if err != nil {
				return nil, server.Inputf("%v", err)
			}
			var value *big.Int
			switch {
			case in.ValueLAX != "" && in.ValueWei != "":
				return nil, server.Inputf("give value_lax or value_wei, not both")
			case in.ValueLAX != "":
				v, ok := laxToWei(in.ValueLAX)
				if !ok {
					return nil, server.Inputf("value_lax is a decimal string of LAX with at most 18 decimals, such as \"1.5\"")
				}
				value = v
			default:
				v, ok := parseDecimal(in.ValueWei)
				if !ok {
					return nil, server.Inputf("give the amount as value_lax (\"1.5\") or value_wei (a decimal string)")
				}
				value = v
			}
			if value.Sign() <= 0 {
				return nil, server.Inputf("the amount must be more than 0")
			}

			if err := a.ensureNode(ctx); err != nil {
				return nil, err
			}
			q, err := w.Quote(from.Hex(), to.Hex(), value.String(), "")
			if err != nil {
				return nil, err
			}
			if !q.Sufficient {
				return nil, server.Inputf("the account holds %s LAX, short of the %s LAX the transfer and its fee need", weiToLAX(q.BalanceWei), weiToLAX(q.TotalWei))
			}
			if fee, _ := new(big.Int).SetString(q.FeeWei, 10); fee != nil && fee.Cmp(w.feeCap()) > 0 {
				return nil, server.Inputf("the fee, %s LAX, is over the user's fee cap of %s LAX", weiToLAX(q.FeeWei), weiToLAX(w.feeCap().String()))
			}

			prop := &TxProposal{
				From: q.From, WatchOnly: watch, To: q.To, Recipient: "new", ToContract: q.ToContract,
				ValueWei: q.ValueWei, GasPriceWei: q.GasPriceWei, GasLimit: q.GasLimit, FeeWei: q.FeeWei, TotalWei: q.TotalWei, BalanceWei: q.BalanceWei,
			}
			info := w.Info()
			for _, acc := range info.Accounts {
				switch acc.Address {
				case q.From:
					prop.FromName = acc.Name
				case q.To:
					prop.Recipient, prop.ToName = "own", acc.Name
				}
			}
			if prop.Recipient == "new" && a.deps.Contacts != nil {
				list := a.deps.Contacts.List()
				if i := slices.IndexFunc(list, func(c Contact) bool { return c.Address == q.To }); i >= 0 {
					prop.Recipient, prop.ToName = "contact", list[i].Name
				}
			}

			return a.submit(RequestTransaction, in.Reason, AssistantRequest{Transaction: prop}, func(password string) (string, error) {
				if prop.WatchOnly {
					req, err := w.BuildRequest(OfflineRequestInput{
						From: prop.From, To: prop.To, ValueWei: prop.ValueWei, GasPriceWei: prop.GasPriceWei, GasLimit: prop.GasLimit,
						Memo: "Asked for by an AI assistant",
					})
					if err != nil {
						return "", err
					}
					return fmt.Sprintf("made a signing request (nonce %d): the user signs it on their offline signer, then broadcasts it in Parallax Wallet", req.Tx.Nonce), nil
				}
				sent, err := w.Send(SendRequest{
					From: prop.From, To: prop.To, ValueWei: prop.ValueWei, GasPriceWei: prop.GasPriceWei, GasLimit: prop.GasLimit, Password: password,
				})
				if err != nil {
					return "", err
				}
				if a.deps.Contacts != nil {
					a.deps.Contacts.SentTo(prop.To)
				}
				return fmt.Sprintf("sent transaction %s (nonce %d); get_receipt tells once it is mined", sent.Hash, sent.Nonce), nil
			})
		})
}
