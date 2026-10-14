import { createContext, useContext } from "react";

/**
 * Offline signing (backend/offline.go): the app as an offline signer, and
 * the documents that travel between it and a watch-only wallet online.
 */

/** Whether the whole app is an offline signer (GUIConfig.offlineSigner). */
export const OfflineMode = createContext(false);
export const useOfflineMode = () => useContext(OfflineMode);

export type DocKind = "request" | "signed" | "raw" | "address" | "messageRequest" | "signedMessage";

/** What a scanned or opened text is: a signing request, a signed transaction, a bare raw transaction, or an address. */
export function docKind(text: string): DocKind | null {
  const s = text.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return "address";
  if (/^0x[0-9a-fA-F]{100,}$/.test(s)) return "raw";
  if (!s.startsWith("{") || s.length > 8 * 1024) return null;
  try {
    const t = (JSON.parse(s) as { type?: unknown }).type;
    if (t === "parallax-sign-request") return "request";
    if (t === "parallax-signed-tx") return "signed";
    if (t === "parallax-sign-message-request") return "messageRequest";
    if (t === "parallax-signed-message") return "signedMessage";
  } catch {
    /* not JSON */
  }
  return null;
}

/** A scanned address, from a plain address or an ethereum:/parallax: URI. */
export function scannedAddress(text: string): string | null {
  const m = text.trim().match(/^(?:(?:ethereum|parallax):)?(0x[0-9a-fA-F]{40})(?:[@?/].*)?$/);
  return m ? m[1] : null;
}

/** The file a transfer's signing document is saved as: what it is, its nonce and its fingerprint. */
export function docFileName(kind: "request" | "signed", nonce: number, fingerprint: string): string {
  return `parallax-${kind === "request" ? "sign-request" : "signed"}-nonce${nonce}-${fingerprint}.json`;
}

/** The file a message's signing document is saved as. */
export function messageFileName(kind: "request" | "signed", fingerprint: string): string {
  return `parallax-${kind === "request" ? "sign-message-request" : "signed-message"}-${fingerprint}.json`;
}
