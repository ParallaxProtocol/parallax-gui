import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, Contact, ContactInput, ContactsImport } from "./api";

type ContactsState = {
  /** Null until the backend first answers; favourites first, then by name. */
  contacts: Contact[] | null;
  /** The contact at an address, in any letter case. */
  byAddress: (address: string | undefined) => Contact | undefined;
  refresh: () => Promise<void>;
  add: (c: ContactInput) => Promise<Contact>;
  update: (id: string, c: ContactInput) => Promise<Contact>;
  setFavorite: (id: string, on: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importBook: (data: string) => Promise<ContactsImport>;
};

const ContactsContext = createContext<ContactsState>({
  contacts: null,
  byAddress: () => undefined,
  refresh: async () => {},
  add: () => Promise.reject(new Error("unavailable")),
  update: () => Promise.reject(new Error("unavailable")),
  setFavorite: async () => {},
  remove: async () => {},
  importBook: () => Promise.reject(new Error("unavailable")),
});

/**
 * ContactsProvider holds the address book (backend/contacts.go) for every
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

export const useContacts = () => useContext(ContactsContext);
