import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronRight, KeyRound, Loader2, Lock } from "lucide-react";
import { STAGGER } from "../../../lib/motion";
import { Pill } from "../../../components/ui/Pill";
import { IconBadge } from "../../../components/ui/IconBadge";
import { useT } from "../../../i18n";
import { Notice } from "../../../components/ui/bits";
import { Modal, ModalForm } from "../../../components/ui/Modal";
import { Field, PasswordInput } from "../../Wallet/common";
import { useBusy } from "../../Wallet/accountActions";

/**
 * ChoiceRow is one way on from a page of choices, as a row of a Settings
 * group: its icon, what it is and what it does, and the chevron of a row
 * that opens a page.
 */
export function ChoiceRow({
  icon: Icon,
  title,
  desc,
  badge,
  onClick,
}: {
  icon: typeof KeyRound;
  title: string;
  desc: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <motion.li variants={STAGGER.item}>
      <button
        type="button"
        onClick={onClick}
        className="group flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-hover"
      >
        <IconBadge icon={Icon} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span>{title}</span>
            {badge && <Pill tone="brand">{badge}</Pill>}
          </span>
          <span className="text-sm text-muted-foreground">{desc}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
      </button>
    </motion.li>
  );
}

/**
 * UnlockModal asks for the wallet password an action needs, as Settings
 * does for its other actions, and runs it with the password: its error, a
 * wrong password among them, shows in the modal. What follows success
 * (closing, leaving the page) is the action's to do.
 */
export function UnlockModal({
  open,
  title,
  subtitle,
  desc,
  icon,
  cta,
  onClose,
  onUnlock,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  desc?: string;
  icon?: ReactNode;
  cta: string;
  onClose: () => void;
  /** The action, with the password; a failure is thrown, to show. */
  onUnlock: (password: string) => Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} icon={icon ?? <Lock className="size-4" />}>
      {open && <Unlock desc={desc} cta={cta} onClose={onClose} onUnlock={onUnlock} />}
    </Modal>
  );
}

function Unlock({
  desc,
  cta,
  onClose,
  onUnlock,
}: {
  desc?: string;
  cta: string;
  onClose: () => void;
  onUnlock: (password: string) => Promise<void>;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const { busy, error, run } = useBusy();
  useEffect(() => () => setPassword(""), []);
  return (
    <ModalForm
      onSubmit={async () => {
        if (busy || !password) return;
        await run(() => onUnlock(password));
      }}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !password}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {cta}
          </button>
        </>
      }
    >
      {desc && <p className="text-muted-foreground">{desc}</p>}
      <Field label={t("wallet.walletPassword")}>
        {(id) => <PasswordInput id={id} value={password} onChange={setPassword} autoFocus />}
      </Field>
      {error && <Notice tone="critical">{error}</Notice>}
    </ModalForm>
  );
}
