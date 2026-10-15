import { createContext, useContext } from "react";
import type { AssistantRequest, MCPActivity, MCPStatus, TxProposal } from "./api";

/** How long a send's confirmation stays once the pointer has left it (ms), as its countdown shows. */
export const SENT_MS = 2000;

/** A send an assistant asked for, just carried out: what the bar confirms before it closes. */
export type SentInfo = { tx: TxProposal; hash?: string; nonce?: number };

// The assistant bar's state, apart from its provider (assistant.tsx), so
// that file exports only a component and keeps Fast Refresh

type Ctx = {
  status: MCPStatus | null;
  /** What assistants asked for and wait on the user, oldest first. */
  pending: AssistantRequest[];
  /** The bar's width now, 0 while it isn't shown: the node bar keeps clear of it. */
  width: number;
  /** The tool call an assistant is making now, if any: shown a moment at least, so quick calls don't flicker. */
  activity: MCPActivity | null;
  /** The bar's width told what's up, to lay its contents out at while it grows to it or shrinks from it. */
  restWidth: number;
  /** Whether the bar is pointed at, or focused, now. */
  hovered: boolean;
  /** setHovered opens the bar a little while it's pointed at, or focused. */
  setHovered: (on: boolean) => void;
  /** The request the bar shows: the oldest pending, or one being carried out (held). */
  shown: AssistantRequest | null;
  /** hold keeps a request in the bar while it is being carried out, when it has left the pending list. */
  hold: (r: AssistantRequest | null) => void;
  /** A send just carried out, confirmed in the bar until dismissed or a moment passes. */
  sent: SentInfo | null;
  showSent: (s: SentInfo | null) => void;
};

export const AssistantContext = createContext<Ctx>({
  status: null,
  pending: [],
  width: 0,
  activity: null,
  restWidth: 0,
  hovered: false,
  setHovered: () => {},
  shown: null,
  hold: () => {},
  sent: null,
  showSent: () => {},
});

/** useAssistant reads the AI assistant server's state, its pending requests, and the assistant bar's width. */
export const useAssistant = () => useContext(AssistantContext);
