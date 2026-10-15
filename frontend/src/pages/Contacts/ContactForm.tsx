import { useEffect, useState } from "react";
import { BookUser, Loader2, Trash2 } from "lucide-react";
import { Contact, ContactInput } from "../../lib/api";
import { isAddress, sameAddress } from "../../lib/format";
import { useContacts } from "../../lib/contacts";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useT } from "../../i18n";
import { Modal, ModalForm } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/bits";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { Field } from "../Wallet/common";
import { useBusy } from "../Wallet/accountActions";

const MAX_NAME = 64;
const MAX_NOTE = 500;

/**
 * ContactModal adds a contact, or edits `contact`. `initial` fills in a new
 * one: the address a send just went to. The backend checks it all again
 * (the checksum, a name or address already in the book) and its reasons
 * show in the user's language.
 */
export function ContactModal({
  open,
  onClose,
  contact,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  contact?: Contact | null;
  initial?: Partial<ContactInput>;
  onSaved?: (c: Contact) => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contact ? t("contacts.edit.title") : t("contacts.add.title")}
      subtitle={contact?.name}
      icon={<BookUser className="size-4" />}
    >
      {open && <ContactFormBody contact={contact ?? null} initial={initial} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function ContactFormBody({
  contact,
  initial,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  initial?: Partial<ContactInput>;
  onClose: () => void;
  onSaved?: (c: Contact) => void;
}) {
  const t = useT();
  const { add, update, byAddress, contacts } = useContacts();
  const { info } = useWallet();
  const [name, setName] = useState(contact?.name ?? initial?.name ?? "");
  const [address, setAddress] = useState(contact?.address ?? initial?.address ?? "");
  const [note, setNote] = useState(contact?.note ?? initial?.note ?? "");
  const { busy, error, run } = useBusy();

  // A different contact opened: its own values
  useEffect(() => {
    setName(contact?.name ?? initial?.name ?? "");
    setAddress(contact?.address ?? initial?.address ?? "");
    setNote(contact?.note ?? initial?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id]);

  const addr = address.trim();
  const addrOk = isAddress(addr);
  const nameTrim = name.trim();
  // What the backend would refuse, said as it is typed
  const taken = addrOk ? byAddress(addr) : undefined;
  const takenBy = taken && taken.id !== contact?.id ? taken : undefined;
  const nameUsed = (contacts ?? []).find(
    (c) => c.id !== contact?.id && c.name.toLowerCase() === nameTrim.replace(/\s+/g, " ").toLowerCase(),
  );
  const own = addrOk ? info?.accounts.find((a) => sameAddress(a.address, addr)) : undefined;
  const ready = !busy && nameTrim !== "" && addrOk && !takenBy && !nameUsed && note.length <= MAX_NOTE;

  const save = async () => {
    if (!ready) return;
    const input = { name, address: addr, note };
    const saved = await run(() => (contact ? update(contact.id, input) : add(input)));
    if (saved) {
      onSaved?.(saved);
      onClose();
    }
  };

  return (
    <ModalForm
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {contact ? t("contacts.save") : t("contacts.add.cta")}
          </button>
        </>
      }
    >
      <Field label={t("contacts.name")} error={nameUsed ? t("contacts.err.nameUsed") : null}>
        {(id) => (
          <input
            id={id}
            className="input"
            value={name}
            maxLength={MAX_NAME}
            placeholder={t("contacts.name.placeholder")}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus={!contact}
          />
        )}
      </Field>
      <Field
        label={t("contacts.address")}
        error={
          addr && !addrOk
            ? t("wallet.err.badRecipient")
            : takenBy
              ? t("contacts.err.existsAs", { name: takenBy.name })
              : null
        }
        hint={t("contacts.address.hint")}
      >
        {(id) => (
          <div className="flex items-center gap-2.5">
            {addrOk && <AddressAvatar address={addr} size={28} />}
            <input
              id={id}
              className="input flex-1 font-mono"
              value={address}
              placeholder="0x…"
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
      </Field>
      <Field
        label={t("contacts.note")}
        aside={
          <span
            className={`text-xs tabular-nums ${note.length > MAX_NOTE ? "text-critical-ink" : "text-muted-foreground"}`}
          >
            {note.length} / {MAX_NOTE}
          </span>
        }
      >
        {(id) => (
          <textarea
            id={id}
            className="input h-auto min-h-20 resize-y py-2"
            rows={3}
            value={note}
            placeholder={t("contacts.note.placeholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      {own && info && (
        <Notice tone="info">{t("contacts.ownAccount", { name: accountLabel(own, info.accounts, t) })}</Notice>
      )}
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}

/** RemoveContactModal asks before taking a contact out of the book. */
export function RemoveContactModal({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const t = useT();
  const { remove } = useContacts();
  const { busy, error, run } = useBusy();
  return (
    <Modal
      open={!!contact}
      onClose={onClose}
      title={t("contacts.remove.title")}
      subtitle={contact?.name}
      icon={<Trash2 className="size-4" />}
      tone="danger"
    >
      {contact && (
        <ModalForm
          onSubmit={async () => {
            if (busy) return;
            const ok = await run(async () => {
              await remove(contact.id);
              return true;
            });
            if (ok) onClose();
          }}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn btn-danger" disabled={busy} autoFocus>
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {t("contacts.remove.cta")}
              </button>
            </>
          }
        >
          <p className="text-muted-foreground">{t("contacts.remove.desc", { name: contact.name })}</p>
          {error && <Notice tone="critical">{error}</Notice>}
        </ModalForm>
      )}
    </Modal>
  );
}
