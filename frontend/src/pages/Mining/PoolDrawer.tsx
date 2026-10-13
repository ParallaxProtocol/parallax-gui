import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { PoolInfo } from "../../lib/api";
import { useT } from "../../i18n";
import { Drawer } from "../../components/ui/Drawer";

/**
 * PoolDrawer adds a custom stratum pool, or edits or removes one added
 * before. Built-in pools are not editable.
 */
export default function PoolDrawer({
  open,
  editing,
  onClose,
  onSave,
  onRemove,
}: {
  open: boolean;
  /** The pool being edited, or null to add one. */
  editing: PoolInfo | null;
  onClose: () => void;
  onSave: (pool: PoolInfo) => void;
  onRemove: (url: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [region, setRegion] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setUrl(editing?.url ?? "");
    setRegion(editing?.region ?? "");
  }, [open, editing]);

  const valid = !!name.trim() && !!url.trim();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? t("mining.pool.edit") : t("mining.pool.add")}
      width="max-w-md"
    >
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ name: name.trim(), url: url.trim(), region: region.trim(), builtin: false });
        }}
      >
        <FormRow inline={false} label={t("mining.poolName")}>
          <input className="input" placeholder={t("mining.ph.poolName")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormRow>
        <FormRow inline={false} label={t("mining.stratumUrl")}>
          <input
            className="input font-mono"
            placeholder={t("mining.ph.stratum")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </FormRow>
        <FormRow inline={false} label={t("mining.region")}>
          <input className="input" placeholder={t("mining.ph.region")} value={region} onChange={(e) => setRegion(e.target.value)} />
        </FormRow>
        <div className="flex items-center gap-2 pt-1">
          {editing && (
            <button type="button" className="btn btn-danger" onClick={() => onRemove(editing.url)}>
              <Trash2 className="size-3.5" />
              {t("mining.remove")}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            {editing ? t("mining.saveChanges") : t("mining.addPoolCta")}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

/**
 * FormRow is one labelled field. In a Rows panel (`inline`) the label sits
 * left of the field, as in a settings form; otherwise above it.
 */
export function FormRow({
  label,
  hint,
  inline = true,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  inline?: boolean;
  children: React.ReactNode;
}) {
  if (!inline) {
    return (
      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <span>{label}</span>
          {hint && <span className="text-sm text-muted-foreground tabular-nums">{hint}</span>}
        </span>
        {children}
      </label>
    );
  }
  return (
    <label className="grid grid-cols-[minmax(110px,auto)_1fr] items-center gap-x-6 gap-y-1 px-4 py-2.5">
      <span>{label}</span>
      {children}
      {hint && <span className="col-start-2 text-sm text-muted-foreground tabular-nums">{hint}</span>}
    </label>
  );
}
