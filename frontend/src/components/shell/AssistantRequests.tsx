import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowDown,
  Bot,
  Check,
  Eye,
  KeyRound,
  Loader2,
  Power,
  Send as SendIcon,
  Settings2,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { api, type AssistantRequest } from "../../lib/api";
import { useT } from "../../i18n";
import { CONFIG_UPDATED_EVENT } from "../../App";
import { accountLabel, useWallet } from "../../lib/wallet";
import { useContacts } from "../../lib/contacts";
import { useAssistant } from "../../lib/assistantContext";
import { nodeState, useNode } from "../../lib/live";
import { formatDuration, formatGwei, formatInt, formatUnits, sameAddress, shortHex } from "../../lib/format";
import { SPRING, STAGGER, useStagger } from "../../lib/motion";
import { ModalForm } from "../ui/Modal";
import { AddressAvatar } from "../ui/AddressAvatar";
import { IconBadge } from "../ui/IconBadge";
import { Indicator, type Grade } from "../ui/Indicator";
import { Notice } from "../ui/bits";
import { Pill } from "../ui/Pill";
import { Property, Rows } from "../ui/Panel";
import { Address, Field, PasswordInput } from "../../pages/Wallet/common";

const LAX_DECIMALS = 18;

type T = (k: string, v?: Record<string, string | number>) => string;

/** A setting's value as the user reads it: null is the default. */
function shown(v: unknown, t: T): string {
  if (v === null || v === undefined || v === "") return t("assistant.default");
  if (typeof v === "boolean") return v ? t("assistant.on") : t("assistant.off");
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * The approving button of each request, named for what it does, as the
 * app's dialogs name theirs ("Remove account", "Create account").
 */
function action(r: AssistantRequest, t: T): { label: string; icon: LucideIcon } {
  switch (r.kind) {
    case "transaction":
      return r.transaction?.watchOnly
        ? { label: t("assistant.transaction.makeRequest"), icon: SendIcon }
        : { label: t("wallet.review.cta"), icon: SendIcon };
    case "stopNode":
      return { label: t("assistant.stopNode.cta"), icon: Power };
    case "settings":
      return { label: t("assistant.settings.cta"), icon: Settings2 };
    case "newAccount":
      return { label: t("wallet.create.cta"), icon: KeyRound };
    case "watchOnly":
      return { label: t("assistant.watchOnly.cta"), icon: Eye };
    case "contact":
      return r.contact?.previous
        ? { label: t("assistant.contact.saveCta"), icon: Check }
        : { label: t("contacts.add.cta"), icon: UserPlus };
    default:
      return { label: t("assistant.approve"), icon: Check };
  }
}

/** Stagger is a dialog's contents arriving one after another; each child an Item. */
function Stagger({ children }: { children: ReactNode }) {
  const stagger = useStagger();
  return (
    <motion.div {...stagger} className="flex flex-col gap-4">
      {children}
    </motion.div>
  );
}

function Item({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={STAGGER.item} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * RequestBody is a request as the user decides it, inside the assistant
 * bar opened on it: what would change, the assistant's reason as its own
 * words, and the action, named, or Don't Allow. The backend carries out
 * exactly what was shown; a password goes from here to the wallet, never
 * to the assistant.
 */
export function RequestBody({ req }: { req: AssistantRequest }) {
  return req.kind === "permission" ? <PermissionForm req={req} /> : <RequestForm req={req} />;
}

/**
 * PermissionForm asks whether an assistant may use a feature, as claude.ai
 * asks before a tool runs: once (until that assistant disconnects), always
 * (the permission becomes Allow), or not.
 */
function PermissionForm({ req }: { req: AssistantRequest }) {
  const t = useT();
  const [busy, setBusy] = useState<"once" | "always" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const feature = req.permission?.feature ?? "";

  const allow = async (always: boolean) => {
    if (busy) return;
    setBusy(always ? "always" : "once");
    setErr(null);
    try {
      await api.assistantAllow(req.id, always);
      if (always) window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ModalForm
      // On the assistant bar's glass: a faint blue hairline, no slab
      footerClassName="border-info/15 bg-transparent"
      onSubmit={() => allow(false)}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost mr-auto"
            disabled={!!busy}
            onClick={() => api.assistantReject(req.id)}
          >
            {t("assistant.dontAllow")}
          </button>
          <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => allow(true)}>
            {busy === "always" && <Loader2 className="size-3.5 animate-spin" />}
            {t("assistant.permission.always")}
          </button>
          {/* Not focused at first: a reflexive Enter mustn't grant access */}
          <button type="submit" className="btn btn-primary" disabled={!!busy}>
            {busy === "once" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {t("assistant.permission.once")}
          </button>
        </>
      }
    >
      <Stagger>
        <Item>
          <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            {t(req.permission?.nodeStopped ? "assistant.permission.needsNode" : "assistant.permission.wants")}
            <Pill className="font-mono">{req.permission?.tool}</Pill>
            {req.permission?.nodeStopped && t("assistant.permission.needsNodeRest")}
          </p>
        </Item>
        <Item>
          <div className="flex items-start gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
            <IconBadge icon={ShieldCheck} tone="brand" size="sm" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{t(`settings.mcp.allow.${feature}`)}</span>
              <span className="text-sm text-muted-foreground">{t(`settings.mcp.allow.${feature}.desc`)}</span>
            </div>
          </div>
        </Item>
        <Item>
          <p className="text-sm text-muted-foreground">{t("assistant.permission.explain")}</p>
        </Item>
        {err && (
          <Item>
            <Notice tone="critical">{err}</Notice>
          </Item>
        )}
      </Stagger>
    </ModalForm>
  );
}

function RequestForm({ req }: { req: AssistantRequest }) {
  const t = useT();
  const wallet = useWallet();
  const contacts = useContacts();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = req.kind === "transaction";
  const { hold, showSent } = useAssistant();
  const needsPassword = req.kind === "newAccount" || (send && !req.transaction?.watchOnly);
  useEffect(() => () => setPassword(""), []);

  const approve = async () => {
    if (busy || (needsPassword && !password)) return;
    setBusy(true);
    setErr(null);
    // Kept in the bar while it's carried out, though it leaves the pending list
    hold(req);
    try {
      const done = await api.assistantApprove(req.id, password);
      if (send && req.transaction) {
        const hash = /0x[0-9a-fA-F]{64}/.exec(done.result)?.[0];
        const nonce = /nonce (\d+)/.exec(done.result)?.[1];
        showSent({ tx: req.transaction, hash, nonce: nonce ? Number(nonce) : undefined });
      }
      setPassword("");
      // What changed shows at once
      if (req.kind === "settings") window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT));
      if (req.kind === "newAccount" || req.kind === "watchOnly" || send) await wallet.refresh();
      if (req.kind === "contact" || send) await contacts.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
      hold(null);
    }
  };

  const { label, icon: ActionIcon } = action(req, t);
  return (
    <ModalForm
      // On the assistant bar's glass: a faint blue hairline, no slab
      footerClassName="border-info/15 bg-transparent"
      onSubmit={approve}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => api.assistantReject(req.id)}
          >
            {t("assistant.dontAllow")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || (needsPassword && !password)}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ActionIcon className="size-3.5" />}
            {label}
          </button>
        </>
      }
    >
      <Stagger>
        <Details req={req} />
        {req.reason && (
          <Item>
            <Reason text={req.reason} />
          </Item>
        )}
        <Item>
          <p className="text-sm text-muted-foreground">{t("assistant.caution")}</p>
        </Item>
        {needsPassword && (
          <Item>
            <Field
              label={t("assistant.password")}
              hint={t(send ? "assistant.password.send" : "assistant.password.hint")}
            >
              {(id) => <PasswordInput id={id} value={password} onChange={setPassword} />}
            </Field>
          </Item>
        )}
        {err && (
          <Item>
            <Notice tone="critical">{err}</Notice>
          </Item>
        )}
      </Stagger>
    </ModalForm>
  );
}

/**
 * Reason is the assistant's own words, set apart as a message from it: its
 * badge beside a bubble, the words quoted, never shown as the app's.
 */
function Reason({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2.5">
      <IconBadge icon={Bot} tone="brand" size="sm" />
      <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl rounded-tl-md bg-muted/60 px-3.5 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">{t("assistant.reason")}</span>
        <p className="selectable break-words text-foreground/85">“{text}”</p>
      </div>
    </div>
  );
}

/**
 * Inset is a list inside a dialog, as the app's dialogs show an account: on
 * the muted surface, its lines divided by hairlines, rather than a raised
 * panel.
 */
function Inset({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-border/70 rounded-lg bg-muted/60">{children}</div>;
}

function InsetRow({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">{children}</div>;
}

/** InsetProperty is a label and its value on one line of an Inset. */
function InsetProperty({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <span className="shrink-0">{label}</span>
      <span
        className={`selectable flex min-w-0 items-center justify-end gap-1.5 truncate text-right text-muted-foreground tabular-nums ${
          mono ? "font-mono text-sm" : ""
        }`}
      >
        {children}
      </span>
    </div>
  );
}

const lead = (text: string) => (
  <Item>
    <p className="text-muted-foreground">{text}</p>
  </Item>
);

/** Details is what a request would do: a lead sentence, then its particulars, each arriving in turn. */
function Details({ req }: { req: AssistantRequest }) {
  const t = useT();
  switch (req.kind) {
    case "stopNode":
      return (
        <>
          {lead(t("assistant.stopNode.desc"))}
          <Item>
            <NodeNow />
          </Item>
        </>
      );
    case "settings":
      return (
        <>
          {lead(t("assistant.settings.lead"))}
          <Item>
            <Inset>
              {req.changes?.map((c) => (
                <InsetRow key={c.key}>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{c.label}</span>
                    {c.sensitive && <Pill tone="warn">{t("assistant.sensitive")}</Pill>}
                  </span>
                  <span className="selectable font-mono text-sm tabular-nums">
                    <span className="text-muted-foreground line-through">{shown(c.from, t)}</span>
                    <span className="text-muted-foreground">{"  →  "}</span>
                    <span>{shown(c.to, t)}</span>
                  </span>
                  {c.sensitive && <span className="text-sm text-warn-ink">{t("assistant.sensitive.desc")}</span>}
                  {c.applies !== "now" && (
                    <span className="text-sm text-muted-foreground">{t(`assistant.applies.${c.applies}`)}</span>
                  )}
                </InsetRow>
              ))}
            </Inset>
          </Item>
        </>
      );
    case "newAccount":
      return (
        <>
          {lead(t("assistant.newAccount.lead"))}
          <Item>
            <Inset>
              <InsetProperty label={t("assistant.newAccount.name")}>
                {req.account?.name || t("assistant.newAccount.unnamed")}
              </InsetProperty>
              <InsetProperty label={t("assistant.newAccount.key")}>
                {req.account?.seedId
                  ? t("assistant.newAccount.fromSeed", { seed: req.account.seedName || "" })
                  : t("assistant.newAccount.newKey")}
              </InsetProperty>
            </Inset>
          </Item>
        </>
      );
    case "watchOnly":
      return (
        <>
          {lead(t("assistant.watchOnly.lead"))}
          <Item>
            <Party
              address={req.watch?.address ?? ""}
              fallbackName={req.watch?.name}
              fallbackKind="new"
              proposedName={req.watch?.name}
            />
          </Item>
        </>
      );
    case "permission":
      return null;
    case "transaction":
      return req.transaction ? <TxDetails tx={req.transaction} /> : null;
    case "contact": {
      const c = req.contact;
      if (!c) return null;
      const moved = c.previous && !sameAddress(c.previous.address, c.address);
      const was = c.previous && (c.previous.name !== c.name || moved || (c.previous.note ?? "") !== c.note);
      return (
        <>
          {lead(t(c.previous ? "assistant.contact.changeLead" : "assistant.contact.addLead"))}
          <Item>
            <Party address={c.address} proposedName={c.name} />
          </Item>
          {c.note && (
            <Item>
              <Inset>
                <InsetProperty label={t("assistant.contact.note")}>{c.note}</InsetProperty>
              </Inset>
            </Item>
          )}
          {was && c.previous && (
            <Item>
              <Inset>
                {c.previous.name !== c.name && (
                  <InsetProperty label={t("assistant.contact.wasName")}>{c.previous.name}</InsetProperty>
                )}
                {moved && (
                  <InsetProperty label={t("assistant.contact.wasAddress")} mono>
                    {shortHex(c.previous.address, 10, 8)}
                  </InsetProperty>
                )}
                {(c.previous.note ?? "") !== c.note && (
                  <InsetProperty label={t("assistant.contact.wasNote")}>{c.previous.note || "—"}</InsetProperty>
                )}
              </Inset>
            </Item>
          )}
          {moved && (
            <Item>
              <Notice tone="warn">{t("assistant.contact.moved")}</Notice>
            </Item>
          )}
        </>
      );
    }
  }
}

/** NodeNow is what stopping the node would interrupt: its state, height, peers and uptime, live. */
function NodeNow() {
  const t = useT();
  const node = useNode();
  const state = nodeState(node);
  const grade: Grade = state === "synced" ? "good" : state === "syncing" ? "warn" : "off";
  return (
    <Inset>
      <InsetProperty label={t("assistant.stopNode.state")}>
        <Indicator grade={grade} />
        {t(`node.state.${state}`)}
      </InsetProperty>
      {node?.running && (
        <>
          <InsetProperty label={t("assistant.stopNode.block")}>{formatInt(node.currentBlock)}</InsetProperty>
          <InsetProperty label={t("assistant.stopNode.peers")}>{formatInt(node.peers)}</InsetProperty>
          <InsetProperty label={t("assistant.stopNode.uptime")}>{formatDuration(node.uptimeSeconds)}</InsetProperty>
        </>
      )}
    </Inset>
  );
}

/**
 * Party is an address as the wallet knows it, on the muted surface the
 * app's dialogs show an account on: one of its accounts or a contact, by
 * avatar, name and kind, with the full address under it to check. The live
 * wallet and address book name it; a request's own reading covers a moment
 * when they haven't loaded. proposedName is a name the request gives it.
 */
function Party({
  address,
  fallbackName,
  fallbackKind,
  proposedName,
}: {
  address: string;
  fallbackName?: string;
  fallbackKind?: "own" | "contact" | "new";
  proposedName?: string;
}) {
  const t = useT();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const own = info?.accounts.find((a) => sameAddress(a.address, address));
  const contact = own ? undefined : byAddress(address);
  let name = proposedName ?? "";
  let tag = "";
  if (own && info) {
    name = accountLabel(own, info.accounts, t);
    tag = t(own.watchOnly ? "assistant.party.watchOnly" : "assistant.party.yours");
  } else if (contact) {
    name = proposedName || contact.name;
    tag = t("assistant.party.contact");
  } else if (fallbackKind === "own" || fallbackKind === "contact") {
    name = fallbackName || name;
    tag = t(fallbackKind === "own" ? "assistant.party.yours" : "assistant.party.contact");
  }
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
      <AddressAvatar address={address} size={30} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {name && (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{name}</span>
            {tag && <Pill>{tag}</Pill>}
          </span>
        )}
        <Address value={address} className="text-sm" />
      </div>
    </div>
  );
}

/**
 * TxDetails is a send as the user approves it, laid out as the app's own
 * send review: the amount large, springing in, where it goes, then every
 * figure in a property list. Amounts are exact; both ends are named as the
 * wallet knows them, the recipient with its full address.
 */
function TxDetails({ tx }: { tx: NonNullable<AssistantRequest["transaction"]> }) {
  const t = useT();
  const { info } = useWallet();
  const { byAddress } = useContacts();
  const accounts = info?.accounts ?? [];
  const fromAcc = accounts.find((a) => sameAddress(a.address, tx.from));
  const after = BigInt(tx.balanceWei) - BigInt(tx.totalWei);
  // Neither one of the wallet's accounts nor a contact: the address to check
  const known = accounts.some((a) => sameAddress(a.address, tx.to)) || !!byAddress(tx.to) || tx.recipient !== "new";
  return (
    <>
      <Item className="flex flex-col items-center gap-3 py-1 text-center">
        <motion.span
          className="flex items-baseline gap-2"
          variants={{ hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1, transition: SPRING } }}
        >
          <span className="selectable bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] bg-clip-text text-5xl font-semibold tracking-tight text-transparent tabular-nums">
            {formatUnits(tx.valueWei, LAX_DECIMALS)}
          </span>
          <span className="text-2xl font-medium text-muted-foreground">LAX</span>
        </motion.span>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowDown className="size-3.5" />
          {t("wallet.send.to")}
        </span>
      </Item>
      <Item>
        <Party address={tx.to} fallbackName={tx.toName} fallbackKind={tx.recipient} />
      </Item>
      {!known && (
        <Item>
          <Notice tone="warn">{t("assistant.transaction.new")}</Notice>
        </Item>
      )}
      {tx.toContract && (
        <Item>
          <Notice tone="warn">{t("wallet.review.toContract")}</Notice>
        </Item>
      )}
      <Item>
        <Rows as="dl">
          <Property label={t("wallet.send.from")}>
            <AddressAvatar address={tx.from} size={20} />
            <span className="truncate">
              {fromAcc ? accountLabel(fromAcc, accounts, t) : tx.fromName || shortHex(tx.from, 8, 6)}
            </span>
            <span className="font-mono text-sm">{shortHex(tx.from, 6, 4)}</span>
          </Property>
          <Property label={t("wallet.review.fee")}>
            <span>
              {formatUnits(tx.feeWei, LAX_DECIMALS)} LAX
              <span className="ml-2 text-sm text-muted-foreground">
                {t("wallet.review.feeDetail", { gas: formatInt(tx.gasLimit), price: formatGwei(tx.gasPriceWei) })}
              </span>
            </span>
          </Property>
          <Property label={t("wallet.review.total")}>
            <span className="font-semibold text-foreground">{formatUnits(tx.totalWei, LAX_DECIMALS)} LAX</span>
          </Property>
          <Property label={t("assistant.transaction.after")}>
            {formatUnits((after < 0n ? 0n : after).toString(), LAX_DECIMALS)} LAX
          </Property>
        </Rows>
      </Item>
      {tx.watchOnly && (
        <Item>
          <Notice tone="info">{t("assistant.transaction.watchOnly")}</Notice>
        </Item>
      )}
    </>
  );
}
