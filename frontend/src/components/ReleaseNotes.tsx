import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { api, openExternal, type ReleaseNotes } from "../lib/api";
import { useLang, useT } from "../i18n";
import { Modal } from "./ui/Modal";
import { Markdown } from "./ui/Markdown";
import { ActivitySpinner } from "./ui/ActivitySpinner";
import { Notice } from "./ui/bits";

/** Where every release's page is, for the notes the app can't read. */
const RELEASES_URL = "https://github.com/ParallaxProtocol/parallax-gui/releases";

/**
 * ReleaseNotesList is releases' notes as they have them, newest first, each
 * under its name and date, parted by a line across the dialog, as its
 * header and footer are. The update's dialog and About's both show them so.
 */
export function ReleaseNotesList({ releases }: { releases: ReleaseNotes[] }) {
  const t = useT();
  const { lang } = useLang();
  const date = (iso: string) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime()) ? d.toLocaleDateString(lang, { dateStyle: "long" }) : "";
  };
  return (
    <div className="flex flex-col divide-y divide-border-strong">
      {releases.map((r) => (
        <section key={r.version} className="flex flex-col gap-3 px-5 py-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-xl font-semibold tracking-tight">
              {t("updater.availableDesc", { version: r.version })}
            </h3>
            <span className="shrink-0 text-sm text-muted-foreground">{date(r.publishedAt)}</span>
          </div>
          {r.notes.trim() ? (
            <Markdown text={r.notes} className="selectable" />
          ) : (
            <p className="text-muted-foreground">{t("updater.noNotes")}</p>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * ReleaseNotesModal is About's release notes: every release up to the one
 * running, newest first, read from GitHub (through Tor while it's on) as
 * it opens.
 */
export function ReleaseNotesModal({ open, onClose, version }: { open: boolean; onClose: () => void; version: string }) {
  const t = useT();
  const [releases, setReleases] = useState<ReleaseNotes[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setErr(null);
    api
      .releaseNotes()
      .then((r) => alive && setReleases(r ?? []))
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t("settings.about.notes")}
      subtitle={version ? `Parallax Wallet ${version}` : undefined}
      icon={<BookOpen />}
      footer={
        <div className="flex border-t border-border bg-surface/60 px-5 py-3">
          <button type="button" onClick={() => openExternal(RELEASES_URL)} className="btn btn-ghost -ml-2">
            {t("updater.viewOnGitHub")}
          </button>
        </div>
      }
    >
      {err ? (
        <div className="p-5">
          <Notice tone="critical" title={t("settings.about.notesFailed")}>
            {err}
          </Notice>
        </div>
      ) : releases === null ? (
        <div className="grid place-items-center py-16 text-foreground/70">
          <ActivitySpinner size={32} label={t("splash.loading")} />
        </div>
      ) : releases.length === 0 ? (
        <p className="p-5 text-muted-foreground">{t("updater.noNotes")}</p>
      ) : (
        <ReleaseNotesList releases={releases} />
      )}
    </Modal>
  );
}
