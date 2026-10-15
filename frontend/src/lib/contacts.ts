import { createContext, useContext } from "react";
import type { Contact, ContactInput, ContactsImport } from "./api";

// The contacts, read through useContacts; ContactsProvider.tsx holds it

export type ContactsState = {
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

export const ContactsContext = createContext<ContactsState>({
  contacts: null,
  byAddress: () => undefined,
  refresh: async () => {},
  add: () => Promise.reject(new Error("unavailable")),
  update: () => Promise.reject(new Error("unavailable")),
  setFavorite: async () => {},
  remove: async () => {},
  importBook: () => Promise.reject(new Error("unavailable")),
});

export const useContacts = () => useContext(ContactsContext);
