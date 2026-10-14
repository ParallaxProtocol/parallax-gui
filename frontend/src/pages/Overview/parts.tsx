import type { ReactNode } from "react";
import { motion } from "motion/react";
import { SPRING } from "../../lib/motion";
import { CopyButton } from "../../components/ui/bits";
import { Tooltip } from "../../components/ui/Tooltip";

/**
 * The pieces the node page's lists share (the peers, the mempool): a row
 * unfolding its details, the inset card they sit in, and a line of them.
 */

/** Unfold reveals its content by growing to its height. */
export function Unfold({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={SPRING}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  );
}

/**
 * DetailCard is an opened row's details: an inset card under the row,
 * indented to the row's main column (its padding, chevron, badge and
 * their gaps; `inset` for other rows), the row's highlight running on
 * behind it.
 */
export function DetailCard({ children, inset = "pr-5 pl-[90px]" }: { children: ReactNode; inset?: string }) {
  return (
    <div className={`bg-hover pb-4 ${inset}`}>
      <div className="rounded-xl bg-muted/60 p-4">{children}</div>
    </div>
  );
}

/** Detail is one line of a DetailCard: a label, a value in monospace, and a copy button if asked. */
export function Detail({ label, value, wrap, copy }: { label: string; value: string; wrap?: boolean; copy?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-baseline gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <Tooltip content={value} mono overflowOnly>
        <dd className={`font-mono text-sm ${wrap ? "break-all" : "truncate"}`}>{value || "—"}</dd>
      </Tooltip>
      {copy && value ? <CopyButton value={value} className="-my-1" /> : <span />}
    </div>
  );
}
