// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package backend

import (
	"bytes"
	"crypto/rand"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ParallaxProtocol/parallax/v2/logging"
)

// The contacts: the people and services the user sends to, by name.
// Who someone pays says much about them, so the book is sealed under the
// wallet key (sealed.go) in contacts.sealed, read as the wallet unlocks
// and forgotten as it locks; until then it can't be read or changed. It
// is written atomically. Names and addresses are each unique, so a name
// always means one address and an address one name: a look-alike entry
// can't hide behind a familiar one.

const (
	// maxContacts bounds the book; a person's real one is far smaller.
	maxContacts = 10_000
	// maxContactNote bounds a contact's note, in characters.
	maxContactNote = 500
	// maxContactsImport bounds an imported file.
	maxContactsImport = 2 << 20
	// contactsVersion is the file's format, for later migrations.
	contactsVersion = 1
)

var (
	ErrContactName     = errors.New("contacts: a contact needs a name of at most 64 characters")
	ErrContactNote     = errors.New("contacts: the note is longer than 500 characters")
	ErrContactExists   = errors.New("contacts: this address is already in your contacts")
	ErrContactNameUsed = errors.New("contacts: another contact already has this name")
	ErrContactUnknown  = errors.New("contacts: no such contact")
	ErrContactsFull    = errors.New("contacts: the contacts are full")
	ErrContactsFile    = errors.New("contacts: not a contacts file")
)

// Contact is one entry of the contacts. Times are Unix seconds;
// LastSentAt is zero until the wallet first sends to it.
type Contact struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Address    string `json:"address"` // EIP-55 checksummed
	Note       string `json:"note"`
	Favorite   bool   `json:"favorite"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	LastSentAt int64  `json:"lastSentAt"`
}

// ContactInput is a contact as the user typed it, to add or edit.
type ContactInput struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Note    string `json:"note"`
}

// ContactsImport reports what an import did: the contacts added, those
// already in the book (by address, or by name for a different address),
// and the entries that weren't valid contacts, with why for the first few.
type ContactsImport struct {
	Added   int      `json:"added"`
	Skipped int      `json:"skipped"`
	Invalid int      `json:"invalid"`
	Errors  []string `json:"errors"`
}

// contactsFile is contacts.json.
type contactsFile struct {
	Version  int       `json:"version"`
	Contacts []Contact `json:"contacts"`
}

// Contacts is the user's contacts. It is safe for concurrent use.
type Contacts struct {
	mu     sync.Mutex
	path   string // the sealed book
	legacy string // the book an earlier version kept in the clear
	list   []Contact
	// sealer is the wallet, while the book is open; nil while it's locked
	sealer Sealer
	now    func() time.Time // tests set the clock
}

// OpenContacts makes the contacts kept in configDir, closed until the
// wallet opens them (Open).
func OpenContacts(configDir string) (*Contacts, error) {
	return &Contacts{
		path:   filepath.Join(configDir, sealedContacts),
		legacy: filepath.Join(configDir, "contacts.json"),
		list:   []Contact{},
		now:    time.Now,
	}, nil
}

// Open reads the book through sealer, the wallet just unlocked, sealing
// first a book an earlier version kept in the clear. An unreadable book
// is set aside, never overwritten, and the book starts empty.
func (c *Contacts) Open(sealer Sealer) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var f contactsFile
	w, _ := sealer.(*Wallet)
	if w != nil {
		if err := w.migratePlain(c.legacy, c.path, sealedContacts, &contactsFile{}); err != nil {
			logging.Warn("Failed to seal the contacts", "err", err)
		}
	}
	var err error
	if w != nil {
		var damaged bool
		damaged, err = w.readSealedOrRecover(c.path, sealedContacts, &f)
		if damaged {
			w.noteDamaged("contacts")
		}
	} else {
		_, err = sealer.ReadSealed(c.path, sealedContacts, &f)
	}
	if errors.Is(err, ErrLocked) {
		return err
	}
	if err != nil || f.Version > contactsVersion {
		aside := fmt.Sprintf("%s.unreadable-%d", c.path, time.Now().Unix())
		logging.Warn("Setting aside an unreadable contacts file", "file", c.path, "to", aside, "err", err, "version", f.Version)
		if err := os.Rename(c.path, aside); err != nil {
			return err
		}
		f = contactsFile{}
	}
	c.list = []Contact{}
	// Each entry checked as if typed: a hand-edited file can't bring in a
	// duplicate or a malformed address
	for _, k := range f.Contacts {
		in, err := c.clean(ContactInput{Name: k.Name, Address: k.Address, Note: k.Note}, "")
		if err != nil {
			logging.Warn("Dropping an invalid contact", "err", err)
			continue
		}
		k.Name, k.Address, k.Note = in.Name, in.Address, in.Note
		if k.ID == "" {
			k.ID = newContactID()
		}
		c.list = append(c.list, k)
	}
	c.sealer = sealer
	return nil
}

// Wipe forgets the book and removes its files: sealed under a wallet
// key that's gone (the wallet deleted), nothing could open them.
func (c *Contacts) Wipe() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.list, c.sealer = []Contact{}, nil
	for _, p := range []string{c.path, previousCopy(c.path), c.legacy} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// Close forgets the book, as the wallet locks.
func (c *Contacts) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.list, c.sealer = []Contact{}, nil
}

// List returns the book: favourites first, then by name.
func (c *Contacts) List() []Contact {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Never nil: an empty book is [] to the frontend, not null
	out := make([]Contact, len(c.list))
	copy(out, c.list)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Favorite != out[j].Favorite {
			return out[i].Favorite
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

// Add puts a new contact in the book.
func (c *Contacts) Add(in ContactInput) (Contact, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sealer == nil {
		return Contact{}, ErrLocked
	}
	if len(c.list) >= maxContacts {
		return Contact{}, ErrContactsFull
	}
	in, err := c.clean(in, "")
	if err != nil {
		return Contact{}, err
	}
	now := c.now().Unix()
	k := Contact{ID: newContactID(), Name: in.Name, Address: in.Address, Note: in.Note, CreatedAt: now, UpdatedAt: now}
	c.list = append(c.list, k)
	if err := c.save(); err != nil {
		c.list = c.list[:len(c.list)-1]
		return Contact{}, err
	}
	return k, nil
}

// Update changes a contact's name, address and note.
func (c *Contacts) Update(id string, in ContactInput) (Contact, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sealer == nil {
		return Contact{}, ErrLocked
	}
	i := c.index(id)
	if i < 0 {
		return Contact{}, ErrContactUnknown
	}
	in, err := c.clean(in, id)
	if err != nil {
		return Contact{}, err
	}
	was := c.list[i]
	k := was
	k.Name, k.Address, k.Note = in.Name, in.Address, in.Note
	k.UpdatedAt = c.now().Unix()
	c.list[i] = k
	if err := c.save(); err != nil {
		c.list[i] = was
		return Contact{}, err
	}
	return k, nil
}

// SetFavorite stars or unstars a contact.
func (c *Contacts) SetFavorite(id string, on bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sealer == nil {
		return ErrLocked
	}
	i := c.index(id)
	if i < 0 {
		return ErrContactUnknown
	}
	if c.list[i].Favorite == on {
		return nil
	}
	c.list[i].Favorite = on
	if err := c.save(); err != nil {
		c.list[i].Favorite = !on
		return err
	}
	return nil
}

// Remove takes a contact out of the book.
func (c *Contacts) Remove(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sealer == nil {
		return ErrLocked
	}
	i := c.index(id)
	if i < 0 {
		return ErrContactUnknown
	}
	was := c.list
	c.list = append(append([]Contact{}, c.list[:i]...), c.list[i+1:]...)
	if err := c.save(); err != nil {
		c.list = was
		return err
	}
	return nil
}

// SentTo notes that the wallet sent to address, if it is a contact, for
// the Send page to offer recent ones first. Best effort: a failure to save
// it is only logged.
func (c *Contacts) SentTo(address string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.list {
		if strings.EqualFold(c.list[i].Address, address) {
			c.list[i].LastSentAt = c.now().Unix()
			if err := c.save(); err != nil {
				logging.Warn("Failed to save the contacts", "err", err)
			}
			return
		}
	}
}

// Export writes the book as JSON or CSV ("json" | "csv"), for a backup or
// another wallet.
func (c *Contacts) Export(format string) (string, error) {
	c.mu.Lock()
	locked := c.sealer == nil
	c.mu.Unlock()
	if locked {
		return "", ErrLocked
	}
	list := c.List()
	switch format {
	case "json":
		out := contactsFile{Version: contactsVersion, Contacts: list}
		data, err := json.MarshalIndent(out, "", "  ")
		return string(data), err
	case "csv":
		var b strings.Builder
		w := csv.NewWriter(&b)
		_ = w.Write([]string{"name", "address", "note", "favorite"})
		for _, k := range list {
			fav := ""
			if k.Favorite {
				fav = "yes"
			}
			_ = w.Write([]string{csvSafe(k.Name), k.Address, csvSafe(k.Note), fav})
		}
		w.Flush()
		return b.String(), w.Error()
	}
	return "", fmt.Errorf("contacts: unknown export format %q", format)
}

// Import adds the contacts of an exported book, JSON (this app's, or a
// plain list of {name, address, note}) or CSV with a name and an address
// column. Entries already in the book are skipped, never overwritten.
func (c *Contacts) Import(data string) (ContactsImport, error) {
	if len(data) > maxContactsImport {
		return ContactsImport{}, ErrContactsFile
	}
	entries, err := parseContacts(data)
	if err != nil {
		return ContactsImport{}, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sealer == nil {
		return ContactsImport{}, ErrLocked
	}
	res := ContactsImport{Errors: []string{}}
	before := len(c.list)
	now := c.now().Unix()
	for n, e := range entries {
		in, err := c.clean(e.ContactInput, "")
		switch {
		case errors.Is(err, ErrContactExists) || errors.Is(err, ErrContactNameUsed):
			res.Skipped++
			continue
		case err != nil:
			res.Invalid++
			if len(res.Errors) < 5 {
				res.Errors = append(res.Errors, fmt.Sprintf("%d: %v", n+1, err))
			}
			continue
		case len(c.list) >= maxContacts:
			res.Invalid++
			continue
		}
		c.list = append(c.list, Contact{
			ID: newContactID(), Name: in.Name, Address: in.Address, Note: in.Note,
			Favorite: e.Favorite, CreatedAt: now, UpdatedAt: now,
		})
		res.Added++
	}
	if res.Added > 0 {
		if err := c.save(); err != nil {
			c.list = c.list[:before]
			return ContactsImport{}, err
		}
	}
	return res, nil
}

// importEntry is one contact of an imported file.
type importEntry struct {
	ContactInput
	Favorite bool
}

// parseContacts reads an exported book: JSON when it starts like JSON,
// else CSV.
func parseContacts(data string) ([]importEntry, error) {
	data = strings.TrimPrefix(data, "\ufeff") // a spreadsheet's byte order mark
	trimmed := strings.TrimSpace(data)
	if trimmed == "" {
		return nil, ErrContactsFile
	}
	if trimmed[0] == '{' || trimmed[0] == '[' {
		var list []Contact
		if trimmed[0] == '{' {
			var f contactsFile
			if err := json.Unmarshal([]byte(trimmed), &f); err != nil || f.Contacts == nil {
				return nil, ErrContactsFile
			}
			list = f.Contacts
		} else if err := json.Unmarshal([]byte(trimmed), &list); err != nil {
			return nil, ErrContactsFile
		}
		out := make([]importEntry, len(list))
		for i, k := range list {
			out[i] = importEntry{ContactInput{Name: k.Name, Address: k.Address, Note: k.Note}, k.Favorite}
		}
		return out, nil
	}

	r := csv.NewReader(bytes.NewReader([]byte(data)))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	header, err := r.Read()
	if err != nil {
		return nil, ErrContactsFile
	}
	col := map[string]int{}
	for i, h := range header {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	nameCol, okName := col["name"]
	addrCol, okAddr := col["address"]
	if !okName || !okAddr {
		return nil, ErrContactsFile
	}
	noteCol, okNote := col["note"]
	favCol, okFav := col["favorite"]
	var out []importEntry
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, ErrContactsFile
		}
		field := func(i int, ok bool) string {
			if !ok || i >= len(rec) {
				return ""
			}
			return rec[i]
		}
		fav := strings.ToLower(strings.TrimSpace(field(favCol, okFav)))
		out = append(out, importEntry{
			ContactInput{Name: csvUnsafe(field(nameCol, true)), Address: field(addrCol, true), Note: csvUnsafe(field(noteCol, okNote))},
			fav == "yes" || fav == "true" || fav == "1",
		})
	}
	return out, nil
}

// clean checks a contact as typed and puts it in its stored form: the name
// and note trimmed, the address checksummed. self is the contact being
// edited, which may keep its own name and address. The caller holds c.mu.
func (c *Contacts) clean(in ContactInput, self string) (ContactInput, error) {
	in.Name = strings.Join(strings.Fields(in.Name), " ")
	if in.Name == "" || utf8.RuneCountInString(in.Name) > maxNameLen || strings.IndexFunc(in.Name, unicode.IsControl) >= 0 {
		return in, ErrContactName
	}
	in.Note = strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(in.Note) > maxContactNote {
		return in, ErrContactNote
	}
	// Line breaks are a note's own; other control characters are not
	in.Note = strings.Map(func(r rune) rune {
		if r != '\n' && unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.ReplaceAll(in.Note, "\r\n", "\n"))
	addr, err := parseRecipient(in.Address)
	if err != nil {
		return in, err
	}
	in.Address = addr.Hex()
	for _, k := range c.list {
		if k.ID == self {
			continue
		}
		if k.Address == in.Address {
			return in, ErrContactExists
		}
		if strings.EqualFold(k.Name, in.Name) {
			return in, ErrContactNameUsed
		}
	}
	return in, nil
}

// index finds a contact by id; -1 if there is none. The caller holds c.mu.
func (c *Contacts) index(id string) int {
	for i, k := range c.list {
		if k.ID == id {
			return i
		}
	}
	return -1
}

// save seals the book and writes it atomically. The caller holds c.mu.
func (c *Contacts) save() error {
	if c.sealer == nil {
		return ErrLocked
	}
	return c.sealer.WriteSealed(c.path, sealedContacts, contactsFile{Version: contactsVersion, Contacts: c.list})
}

// csvUnsafe undoes csvSafe on an imported field.
func csvUnsafe(s string) string {
	if len(s) > 1 && s[0] == '\'' && strings.ContainsRune("=+-@\t\r", rune(s[1])) {
		return s[1:]
	}
	return s
}

func newContactID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand doesn't fail on supported platforms
	}
	return hex.EncodeToString(b[:])
}

// csvSafe keeps a spreadsheet from reading a field as a formula, which a
// name or note starting with = + - or @ would otherwise be.
func csvSafe(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}
