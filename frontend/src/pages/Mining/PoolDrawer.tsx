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
      eyebrow={t("mining.pool")}
      title={editing ? t("mining.pool.edit") : t("mining.pool.add")}
      width="max-w-md"
    >
      <form
        className="flex flex-col gap-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ name: name.trim(), url: url.trim(), region: region.trim(), builtin: false });
        }}
      >
        <FormRow label={t("mining.poolName")}>
          <input className="input" placeholder={t("mining.ph.poolName")} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormRow>
        <FormRow label={t("mining.stratumUrl")}>
          <input
            className="input font-mono"
            placeholder={t("mining.ph.stratum")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </FormRow>
        <FormRow label={t("mining.region")}>
          <input className="input" placeholder={t("mining.ph.region")} value={region} onChange={(e) => setRegion(e.target.value)} />
        </FormRow>
        <div className="flex items-center gap-2 pt-2">
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            {editing ? t("mining.saveChanges") : t("mining.addPoolCta")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          {editing && (
            <button type="button" className="btn btn-danger ml-auto" onClick={() => onRemove(editing.url)}>
              <Trash2 className="size-4" />
              {t("mining.remove")}
            </button>
          )}
        </div>
      </form>
    </Drawer>
  );
}

export function FormRow({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{label}</span>
        {hint && <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
