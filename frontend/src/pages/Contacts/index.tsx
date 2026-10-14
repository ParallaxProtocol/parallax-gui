import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  BookUser,
  Download,
  Ellipsis,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api, Contact, ContactsImport, exportContacts, walletError } from "../../lib/api";
import { shortHex } from "../../lib/format";
import { useContacts } from "../../lib/contacts";
import { FADE_OUT, GLIDE, STAGGER, useStagger } from "../../lib/motion";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useNow } from "../../lib/useNow";
import { PAGE_WIDE } from "../../lib/layout";
import { useAgo, useT } from "../../i18n";
import { Panel } from "../../components/ui/Panel";
import { IconBadge } from "../../components/ui/IconBadge";
import { CopyButton, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { ContactModal, RemoveContactModal } from "./ContactForm";

/** The largest file the address book imports, as the backend takes it. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/**
 * ContactsPage is the address book: the people and services the user sends
 * to, by name. Each can be sent to, copied, starred, edited or removed; the
 * book can be searched, and imported or exported as JSON or CSV.
 */
export default function ContactsPage() {
  const t = useT();
  const stagger = useStagger();
  const navigate = useNavigate();
  const { contacts, setFavorite, importBook } = useContacts();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Contact | null | "new">(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [imported, setImported] = useState<ContactsImport | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!contacts || !q) return contacts ?? [];
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q) || c.note.toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const say = (tone: "info" | "critical", text: string) => {
    setImported(null);
    setMessage({ tone, text });
  };

  const readImport = async (f: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) return say("critical", t("contacts.err.file"));
    try {
      const res = await importBook(await f.text());
      setMessage(null);
      setImported(res);
    } catch (e) {
      say("critical", walletError(e, t));
    }
  };

  const doExport = async (format: "json" | "csv") => {
    try {
      const data = await api.contactsExport(format);
      if (await exportContacts(format, data)) say("info", t("contacts.exported", { n: contacts?.length ?? 0 }));
    } catch (e) {
      say("critical", walletError(e, t));
    }
  };

  if (!contacts) return null;
  const empty = contacts.length === 0;

  return (
    <div className={`flex flex-col gap-5 p-5 ${PAGE_WIDE}`}>
      <ToolbarAccessory>
        <MoreMenu
          canExport={!empty}
          onImport={() => fileInput.current?.click()}
          onExport={doExport}
        />
      </ToolbarAccessory>
      <input
        ref={fileInput}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => readImport(e.target.files?.[0])}
      />

      {imported && <ImportResult result={imported} onClose={() => setImported(null)} />}
      {message && (
        <Notice
          tone={message.tone}
          action={
            <button type="button" className="btn btn-tinted btn-sm" onClick={() => setMessage(null)}>
              {t("common.close")}
            </button>
          }
        >
          {message.text}
        </Notice>
      )}

      {empty ? (
        <Panel className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <IconBadge icon={BookUser} size="lg" />
          <div className="flex max-w-md flex-col gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight">{t("contacts.empty.title")}</h2>
            <p className="text-muted-foreground">{t("contacts.empty.desc")}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("contacts.add.title")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" />
              {t("contacts.import")}
            </button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="input pr-9 pl-9"
                placeholder={t("contacts.search")}
                aria-label={t("contacts.search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                spellCheck={false}
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label={t("contacts.search.clear")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("contacts.add.title")}
            </button>
          </div>

          <Panel className="overflow-hidden">
            {shown.length === 0 ? (
              <p className="py-14 text-center text-muted-foreground">{t("contacts.noMatch", { query: query.trim() })}</p>
            ) : (
              <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
                {shown.map((c) => (
                  <motion.li variants={STAGGER.item} key={c.id}>
                    <ContactRow
                      contact={c}
                      onSend={() => navigate(`/send?to=${c.address}`)}
                      onEdit={() => setEditing(c)}
                      onRemove={() => setRemoving(c)}
                      onFavorite={() =>
                        setFavorite(c.id, !c.favorite).catch((e) => say("critical", walletError(e, t)))
                      }
                    />
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </Panel>
          <p className="px-1 text-sm text-muted-foreground">
            {query.trim()
              ? t("contacts.countOf", { n: shown.length, total: contacts.length })
              : t(contacts.length === 1 ? "contacts.count.one" : "contacts.count", { n: contacts.length })}
          </p>
        </>
      )}

      <ContactModal
        open={editing !== null}
        contact={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
      />
      <RemoveContactModal contact={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

function ContactRow({
  contact: c,
  onSend,
  onEdit,
  onRemove,
  onFavorite,
}: {
  contact: Contact;
  onSend: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onFavorite: () => void;
}) {
  const t = useT();
  const ago = useAgo();
  const now = useNow(60_000);
  return (
    <div className="group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-hover">
      <AddressAvatar address={c.address} size={40} />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onEdit}>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{c.name}</span>
          {c.favorite && <Star className="size-3.5 shrink-0 fill-current text-warn" aria-label={t("contacts.favorite")} />}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="shrink-0 font-mono">{shortHex(c.address, 8, 6)}</span>
          {c.note && <span className="truncate">· {c.note.split("\n")[0]}</span>}
        </span>
        {c.lastSentAt > 0 && (
          <span className="block text-xs text-muted-foreground">
            {t("contacts.lastSent", { when: ago(c.lastSentAt, now) })}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content={c.favorite ? t("contacts.unfavorite") : t("contacts.favorite")}>
          <button
            type="button"
            className={`btn btn-ghost btn-icon ${c.favorite ? "text-warn" : "text-muted-foreground"}`}
            onClick={onFavorite}
            aria-pressed={c.favorite}
            aria-label={c.favorite ? t("contacts.unfavorite") : t("contacts.favorite")}
          >
            <Star className={`size-4 ${c.favorite ? "fill-current" : ""}`} />
          </button>
        </Tooltip>
        <CopyButton value={c.address} />
        <Tooltip content={t("contacts.edit.title")}>
          <button type="button" className="btn btn-ghost btn-icon text-muted-foreground" onClick={onEdit} aria-label={t("contacts.edit.title")}>
            <Pencil className="size-4" />
          </button>
        </Tooltip>
        <Tooltip content={t("contacts.remove.title")}>
          <button
            type="button"
            className="btn btn-ghost btn-icon text-muted-foreground hover:text-critical-ink"
            onClick={onRemove}
            aria-label={t("contacts.remove.title")}
          >
            <Trash2 className="size-4" />
          </button>
        </Tooltip>
        <button type="button" className="btn btn-secondary btn-sm ml-1.5" onClick={onSend}>
          <ArrowUpRight className="size-3.5" />
          {t("nav.send")}
        </button>
      </div>
    </div>
  );
}

/** ImportResult says what an import did, and why entries were left out. */
function ImportResult({ result: r, onClose }: { result: ContactsImport; onClose: () => void }) {
  const t = useT();
  const parts = [t("contacts.imported.added", { n: r.added })];
  if (r.skipped) parts.push(t("contacts.imported.skipped", { n: r.skipped }));
  if (r.invalid) parts.push(t("contacts.imported.invalid", { n: r.invalid }));
  return (
    <Notice
      tone={r.invalid ? "warn" : "info"}
      title={t("contacts.imported.title")}
      action={
        <button type="button" className="btn btn-tinted btn-sm" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <span>{parts.join(" · ")}</span>
      {r.errors.length > 0 && (
        <ul className="mt-1.5 list-disc pl-5 text-sm">
          {r.errors.map((e) => (
            <li key={e} className="selectable">
              {t("contacts.imported.line", { detail: e })}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

/** MoreMenu holds the actions on the whole book: import, and export as JSON or CSV. */
function MoreMenu({
  canExport,
  onImport,
  onExport,
}: {
  canExport: boolean;
  onImport: () => void;
  onExport: (format: "json" | "csv") => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={box} className="no-drag relative">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Ellipsis className="size-4" />
        {t("contacts.more")}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="menu absolute top-full right-0 z-50 mt-1 flex w-56 flex-col gap-px p-1 text-foreground"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            transition={GLIDE}
          >
            <button type="button" role="menuitem" className="menu-item" onClick={pick(onImport)}>
              <Upload className="size-4 text-muted-foreground" />
              {t("contacts.import")}
            </button>
            <div className="my-0.5 border-t border-border" />
            <button
              type="button"
              role="menuitem"
              className="menu-item disabled:opacity-40"
              disabled={!canExport}
              onClick={pick(() => onExport("json"))}
            >
              <Download className="size-4 text-muted-foreground" />
              {t("contacts.export.json")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item disabled:opacity-40"
              disabled={!canExport}
              onClick={pick(() => onExport("csv"))}
            >
              <Download className="size-4 text-muted-foreground" />
              {t("contacts.export.csv")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
