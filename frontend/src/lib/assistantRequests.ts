import { BookUser, Eye, KeyRound, Power, Send, Settings2, ShieldCheck, type LucideIcon } from "lucide-react";
import type { AssistantRequest } from "./api";
import { formatUnits } from "./format";

type T = (k: string, v?: Record<string, string | number>) => string;

/** Each kind of request's mark, beside its title in the assistant bar. */
export const REQUEST_ICON: Record<AssistantRequest["kind"], LucideIcon> = {
  permission: ShieldCheck,
  transaction: Send,
  settings: Settings2,
  newAccount: KeyRound,
  watchOnly: Eye,
  contact: BookUser,
  stopNode: Power,
};

/** requestTitle asks what a request asks, as its title: "Send 1.5 LAX?" */
export function requestTitle(r: AssistantRequest, t: T): string {
  if (r.kind === "transaction")
    return t("assistant.transaction.title", { amount: formatUnits(r.transaction?.valueWei ?? "0", 18) });
  if (r.kind === "permission")
    return t(
      r.permission?.nodeStopped ? "assistant.permission.startStopped" : `assistant.permission.${r.permission?.feature}`,
    );
  if (r.kind === "contact") return t(r.contact?.previous ? "assistant.contact.change" : "assistant.contact.add");
  return t(`assistant.${r.kind}.title`);
}

/** wideRequest is whether a request shows a full address beside its avatar, which takes the wider panel. */
export function wideRequest(r: AssistantRequest): boolean {
  return r.kind === "transaction" || r.kind === "contact" || r.kind === "watchOnly";
}

/** activityKey says, as a translation key, what an assistant is doing with a tool: "checking a balance". */
export function activityKey(tool: string): string {
  const exact: Record<string, string> = {
    get_balance: "balance",
    get_block: "block",
    get_transaction: "transaction",
    get_receipt: "transaction",
    trace_transaction: "trace",
    trace_call: "trace",
    get_logs: "events",
    estimate_gas: "fees",
    gas_price: "fees",
    audit_token_approvals: "approvals",
    chain_info: "chain",
    build_unsigned_tx: "buildTx",
    decode_tx: "buildTx",
    search_docs: "docs",
    read_doc: "docs",
    node_status: "node",
    node_logs: "logs",
    wallet_accounts: "wallet",
    wallet_activity: "wallet",
    contacts: "contacts",
    app_settings: "settings",
    start_node: "startNode",
    lock_app: "lockApp",
    supply_info: "mining",
    block_reward: "mining",
    mining_stats: "mining",
  };
  if (exact[tool]) return `assistant.doing.${exact[tool]}`;
  if (["get_code", "get_storage_at", "call_contract", "get_proof"].includes(tool)) return "assistant.doing.contract";
  if (tool.startsWith("mempool_")) return "assistant.doing.mempool";
  if (tool.startsWith("explorer_")) return "assistant.doing.explorer";
  if (tool.startsWith("network_") || tool === "node_peers") return "assistant.doing.network";
  if (tool.startsWith("request_")) return "assistant.doing.request";
  return "assistant.doing.other";
}
