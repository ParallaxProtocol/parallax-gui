import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  BookUser,
  ChevronDown,
  ChevronRight,
  Download,
  History,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { api, Contact, ContactsImport, exportContacts, walletError } from "../../lib/api";
import { shortHex } from "../../lib/format";
import { useContacts } from "../../lib/contacts";
import { useOfflineMode } from "../../lib/offline";
import { useWallet } from "../../lib/wallet";
import { FADE_OUT, GLIDE, SPRING, STAGGER, useStagger } from "../../lib/motion";
import { ToolbarAccessory } from "../../lib/toolbar";
import { useNow } from "../../lib/useNow";
import { PAGE_WIDE } from "../../lib/layout";
import { useAgo, useLang, useT } from "../../i18n";
import { Fact, Facts, Panel, Section } from "../../components/ui/Panel";
import { CopyButton, EmptySymbol, Notice } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";
import { AddressAvatar } from "../../components/ui/AddressAvatar";
import { GroupedAddress } from "../../components/ui/AccountParts";
import { GlowCard } from "../../components/ui/GlowCard";
import { SearchField } from "../../components/ui/SearchField";
import { Unfold } from "../Overview/parts";
import { ContactModal, RemoveContactModal } from "./ContactForm";

/** The largest file the contacts import takes, as the backend takes it. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** The most favourites shown as tiles; the rest are in the list, starred. */
const MAX_TILES = 8;

/**
 * ContactsPage is the contacts page: the people and services the user sends
 * to, by name. Favourites sit on top as tiles to send to in one click; below,
 * every contact in a list whose rows open to the whole address, the note and
 * the ways to send, star, edit or remove. The contacts can be searched, and
 * imported or exported as JSON or CSV.
 */
export default function ContactsPage() {
  const t = useT();
  const stagger = useStagger();
  const navigate = useNavigate();
  const { contacts, setFavorite, importBook } = useContacts();
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | null | "new">(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [imported, setImported] = useState<ContactsImport | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!contacts || !q) return contacts ?? [];
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q) || c.note.toLowerCase().includes(q),
    );
  }, [contacts, q]);
  const favorites = useMemo(() => (contacts ?? []).filter((c) => c.favorite), [contacts]);

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

  const send = (c: Contact) => navigate(`/send?to=${c.address}`);
  const star = (c: Contact) => setFavorite(c.id, !c.favorite).catch((e) => say("critical", walletError(e, t)));

  if (!contacts) return null;
  const empty = contacts.length === 0;

  return (
    <div className={`flex flex-col gap-6 p-5 ${PAGE_WIDE}`}>
      <ToolbarAccessory>
        <ContactsActions canExport={!empty} onImport={() => fileInput.current?.click()} onExport={doExport} />
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
        // No contacts yet: what it is for, and the two ways to fill it
        <GlowCard {...stagger} className="px-6 py-14">
          <div className="flex flex-col items-center gap-5 text-center">
            <motion.div variants={STAGGER.item}>
              <EmptySymbol icon={BookUser} className="size-12 text-brand" />
            </motion.div>
            <motion.div variants={STAGGER.item} className="flex max-w-md flex-col gap-1.5">
              <h2 className="text-2xl font-semibold tracking-tight">{t("contacts.empty.title")}</h2>
              <p className="text-muted-foreground">{t("contacts.empty.desc")}</p>
            </motion.div>
            <motion.div variants={STAGGER.item} className="flex flex-wrap justify-center gap-3">
              <button type="button" className="btn btn-primary btn-lg min-w-40" onClick={() => setEditing("new")}>
                <Plus className="size-4" />
                {t("contacts.add.title")}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-lg min-w-40"
                onClick={() => fileInput.current?.click()}
              >
                <Download className="size-4" />
                {t("contacts.import")}
              </button>
            </motion.div>
          </div>
        </GlowCard>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <SearchField
              className="flex-1"
              placeholder={t("contacts.search")}
              aria-label={t("contacts.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              onClear={() => setQuery("")}
              clearLabel={t("contacts.search.clear")}
            />
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              {t("contacts.add.title")}
            </button>
          </div>

          {/* The favourites, a click from sending; out of the way while searching */}
          <AnimatePresence initial={false}>
            {!q && favorites.length > 0 && (
              // Clipped only while it folds, with room inside for the tiles' shadows and lift
              <motion.div
                key="favorites"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SPRING}
                className="-mx-3 -my-3 overflow-hidden px-3 py-3"
              >
                <Section title={t("contacts.favorites")} count={favorites.length}>
                  <motion.ul {...stagger} className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
                    <AnimatePresence initial={false} mode="popLayout">
                      {favorites.slice(0, MAX_TILES).map((c) => (
                        <FavoriteTile key={c.id} contact={c} onSend={() => send(c)} />
                      ))}
                    </AnimatePresence>
                  </motion.ul>
                </Section>
              </motion.div>
            )}
          </AnimatePresence>

          <Section
            title={q ? t("contacts.results") : t("contacts.all")}
            count={q ? undefined : contacts.length}
            aside={q ? t("contacts.countOf", { n: shown.length, total: contacts.length }) : undefined}
          >
            <Panel className="overflow-hidden">
              {shown.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
                  <EmptySymbol icon={Search} />
                  <p>{t("contacts.noMatch", { query: query.trim() })}</p>
                </div>
              ) : (
                <motion.ul {...stagger} className="flex flex-col divide-y divide-border">
                  <AnimatePresence initial={false} mode="popLayout">
                    {shown.map((c) => (
                      <ContactRow
                        key={c.id}
                        contact={c}
                        opened={opened === c.id}
                        onToggle={() => setOpened((o) => (o === c.id ? null : c.id))}
                        onSend={() => send(c)}
                        onEdit={() => setEditing(c)}
                        onRemove={() => setRemoving(c)}
                        onFavorite={() => star(c)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.ul>
              )}
            </Panel>
          </Section>
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

/**
 * FavoriteTile is a favourite on top of the page: its avatar and name on a
 * glass tile that sends to it, lifting a little under the pointer.
 */
function FavoriteTile({ contact: c, onSend }: { contact: Contact; onSend: () => void }) {
  const t = useT();
  return (
    <motion.li
      layout
      variants={STAGGER.item}
      exit={{ opacity: 0, scale: 0.92, transition: FADE_OUT }}
      className="min-w-0"
    >
      <Tooltip content={t("contacts.sendTo", { name: c.name })}>
        <motion.button
          type="button"
          onClick={onSend}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={GLIDE}
          className="glass group relative flex w-full flex-col items-center gap-2.5 rounded-2xl px-3 pt-5 pb-4 text-center"
          aria-label={t("contacts.sendTo", { name: c.name })}
        >
          <span className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full bg-brand-muted text-brand opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <ArrowUpRight className="size-3.5" />
          </span>
          <AddressAvatar address={c.address} size={48} />
          <span className="flex w-full min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{c.name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{shortHex(c.address, 6, 4)}</span>
          </span>
        </motion.button>
      </Tooltip>
    </motion.li>
  );
}

/**
 * ContactRow is one contact of the list: who, at which address, and
 * when last sent to, opening to the rest. As an activity row, the whole row
 * is a button beneath its contents, so Send can sit in the row beside them.
 */
function ContactRow({
  contact: c,
  opened,
  onToggle,
  onSend,
  onEdit,
  onRemove,
  onFavorite,
}: {
  contact: Contact;
  opened: boolean;
  onToggle: () => void;
  onSend: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onFavorite: () => void;
}) {
  const t = useT();
  const ago = useAgo();
  const now = useNow(60_000);
  const label = useId();
  return (
    <motion.li
      layout="position"
      variants={STAGGER.item}
      exit={{ opacity: 0, transition: FADE_OUT }}
      transition={SPRING}
    >
      <div className="group relative flex h-16 items-center gap-3.5 px-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={opened}
          aria-labelledby={label}
          className={`absolute inset-0 transition-colors group-hover:bg-hover ${opened ? "bg-hover" : ""}`}
        />
        <span className="pointer-events-none relative">
          <AddressAvatar address={c.address} size={40} />
        </span>
        <div id={label} className="pointer-events-none relative min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{c.name}</span>
            <AnimatePresence initial={false}>
              {c.favorite && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.4, transition: FADE_OUT }}
                  transition={GLIDE}
                  className="flex shrink-0"
                >
                  <Star className="size-3.5 fill-current text-warn" aria-label={t("contacts.favorite")} />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span className="shrink-0 font-mono">{shortHex(c.address, 8, 6)}</span>
            {c.note && <span className="truncate">· {c.note.split("\n")[0]}</span>}
          </div>
        </div>
        {c.lastSentAt > 0 && (
          <span className="pointer-events-none relative hidden shrink-0 text-sm text-muted-foreground md:inline">
            {t("contacts.lastSent", { when: ago(c.lastSentAt, now) })}
          </span>
        )}
        <button type="button" className="btn btn-tinted btn-sm relative shrink-0" onClick={onSend}>
          <ArrowUpRight className="size-3.5" />
          {t("nav.send")}
        </button>
        <ChevronRight
          className={`pointer-events-none relative size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${opened ? "rotate-90" : ""}`}
        />
      </div>
      <AnimatePresence initial={false}>
        {opened && (
          <Unfold>
            <ContactDetails contact={c} now={now} onEdit={onEdit} onRemove={onRemove} onFavorite={onFavorite} />
          </Unfold>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/**
 * ContactDetails is an opened contact row, in the app's grouped boxes: the
 * address in full, grouped to check against what the other party gave, when
 * it was added and last sent to, the note whole, and what to do with it.
 */
function ContactDetails({
  contact: c,
  now,
  onEdit,
  onRemove,
  onFavorite,
}: {
  contact: Contact;
  now: number;
  onEdit: () => void;
  onRemove: () => void;
  onFavorite: () => void;
}) {
  const t = useT();
  const ago = useAgo();
  const { lang } = useLang();
  const date = (s: number) => new Date(s * 1000).toLocaleDateString(lang, { dateStyle: "medium" });
  // The account's transactions with them, on the History page: an online wallet's, with an account
  const offline = useOfflineMode();
  const { account } = useWallet();
  // Indented to the row's text: its padding, the avatar and the gap after it
  return (
    <div className="flex flex-col gap-3 bg-hover pr-4 pb-4 pl-[70px]">
      <Facts>
        <Fact label={t("contacts.address")}>
          <GroupedAddress address={c.address} wrap className="text-foreground/90" />
          <CopyButton value={c.address} className="-my-1 -mr-2" />
        </Fact>
        <Fact label={t("contacts.lastSentLabel")}>
          {c.lastSentAt > 0 ? (
            <Tooltip content={new Date(c.lastSentAt * 1000).toLocaleString(lang)}>
              <span>{ago(c.lastSentAt, now)}</span>
            </Tooltip>
          ) : (
            t("contacts.neverSent")
          )}
        </Fact>
        <Fact label={t("contacts.added")}>{date(c.createdAt)}</Fact>
      </Facts>
      {c.note && (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
          <span>{t("contacts.note")}</span>
          <p className="selectable break-words whitespace-pre-wrap text-muted-foreground">{c.note}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn btn-tinted btn-sm ${c.favorite ? "text-warn-ink" : ""}`}
          onClick={onFavorite}
          aria-pressed={c.favorite}
        >
          <motion.span key={String(c.favorite)} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={GLIDE}>
            <Star className={`size-3.5 ${c.favorite ? "fill-current" : ""}`} />
          </motion.span>
          {c.favorite ? t("contacts.unfavorite") : t("contacts.favorite")}
        </button>
        <button type="button" className="btn btn-tinted btn-sm" onClick={onEdit}>
          <Pencil className="size-3.5" />
          {t("contacts.edit.title")}
        </button>
        {!offline && account && (
          <Link to={`/history?${new URLSearchParams({ with: c.address })}`} className="btn btn-tinted btn-sm">
            <History className="size-3.5" />
            {t("contacts.history")}
          </Link>
        )}
        <button type="button" className="btn btn-danger btn-sm ml-auto" onClick={onRemove}>
          <Trash2 className="size-3.5" />
          {t("contacts.remove.cta")}
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

/**
 * ContactsActions is what acts on all the contacts, in the toolbar: a glass pill,
 * as a flow's steps are, of Import and Export, Export asking JSON or CSV.
 * With no contacts there is nothing to export, so Export opens out once it has.
 */
function ContactsActions({
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

  const pick = (format: "json" | "csv") => () => {
    setOpen(false);
    onExport(format);
  };
  const capsule = (lit = false) =>
    `flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium transition-colors hover:text-foreground focus-visible:text-foreground ${lit ? "text-foreground" : "text-foreground/70"}`;

  return (
    <div ref={box} className="no-drag relative">
      <div className="glass flex h-9 items-center rounded-full px-1.5">
        <button type="button" className={capsule()} onClick={onImport}>
          <Download className="size-4" />
          {t("contacts.importShort")}
        </button>
        <AnimatePresence initial={false}>
          {canExport && (
            <motion.span
              key="export"
              className="flex items-center overflow-hidden"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={SPRING}
            >
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border-strong" />
              <button
                type="button"
                className={`${capsule(open)} whitespace-nowrap`}
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <Upload className="size-4" />
                {t("contacts.export")}
                <ChevronDown
                  className={`size-3.5 opacity-70 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
              </button>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {open && canExport && (
          <motion.div
            role="menu"
            className="menu absolute top-full right-0 z-50 mt-2 flex w-56 flex-col gap-px p-1.5 text-foreground"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: FADE_OUT }}
            transition={GLIDE}
          >
            <button type="button" role="menuitem" className="menu-item min-h-10 gap-2.5 px-2.5" onClick={pick("json")}>
              <Upload className="size-4 text-muted-foreground" />
              {t("contacts.export.json")}
            </button>
            <button type="button" role="menuitem" className="menu-item min-h-10 gap-2.5 px-2.5" onClick={pick("csv")}>
              <Upload className="size-4 text-muted-foreground" />
              {t("contacts.export.csv")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
