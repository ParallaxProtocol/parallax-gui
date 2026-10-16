import { motion } from "motion/react";
import { ChevronRight, KeyRound } from "lucide-react";
import { STAGGER } from "../../../lib/motion";
import { Pill } from "../../../components/ui/Pill";

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
        <Icon className="size-5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
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
