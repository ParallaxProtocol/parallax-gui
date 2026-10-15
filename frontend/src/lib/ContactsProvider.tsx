import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { api, Contact } from "./api";
import { ContactsContext, type ContactsState } from "./contacts";

/**
 * ContactsProvider holds the contacts (backend/contacts.go) for every
 * page: the book itself, editing it, and finding the contact at an address,
 * which the activity, Send and the notifications name people by.
 */
export function ContactsProvider({ children }: { children: ReactNode }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setContacts((await api.contacts()) ?? []);
    } catch {
      setContacts((c) => c ?? []);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Each change, then the book as the backend now has it
  const after = useCallback(
    async <T,>(p: Promise<T>): Promise<T> => {
      const v = await p;
      await refresh();
      return v;
    },
    [refresh],
  );

  const value = useMemo<ContactsState>(() => {
    const index = new Map((contacts ?? []).map((c) => [c.address.toLowerCase(), c]));
    return {
      contacts,
      byAddress: (address) => (address ? index.get(address.toLowerCase()) : undefined),
      refresh,
      add: (c) => after(api.contactAdd(c)),
      update: (id, c) => after(api.contactUpdate(id, c)),
      setFavorite: (id, on) => after(api.contactSetFavorite(id, on)),
      remove: (id) => after(api.contactRemove(id)),
      importBook: (data) => after(api.contactsImport(data)),
    };
  }, [contacts, refresh, after]);

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
}
