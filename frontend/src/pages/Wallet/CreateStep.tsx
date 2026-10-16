import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { GLIDE, SPRING } from "../../lib/motion";
import { useT } from "../../i18n";
import { type Strength } from "./accountActions";

/** Requirement is one condition the password must meet, its mark filling in once met. */
export function Requirement({ met, label }: { met: boolean; label: string }) {
  return (
    <li
      className={`flex items-center gap-2 text-sm transition-colors duration-200 ${met ? "text-foreground" : "text-muted-foreground"}`}
    >
      <span className="relative grid size-4 shrink-0 place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full border"
          initial={false}
          animate={{ borderColor: met ? "var(--brand-mark)" : "var(--border-strong)" }}
          transition={GLIDE}
        />
        <AnimatePresence initial={false}>
          {met && (
            <motion.span
              key="met"
              className="absolute inset-0 grid place-items-center rounded-full bg-brand-fill text-brand-foreground"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={GLIDE}
            >
              <Check className="size-2.5" strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {label}
    </li>
  );
}

const STRENGTH: Record<Strength, { key: string; color: string }> = {
  0: { key: "wallet.create.strength.short", color: "var(--critical)" },
  1: { key: "wallet.create.strength.fair", color: "var(--warn)" },
  2: { key: "wallet.create.strength.good", color: "var(--brand-mark)" },
  3: { key: "wallet.create.strength.strong", color: "var(--brand-mark)" },
  4: { key: "wallet.create.strength.strong", color: "var(--brand-mark)" },
};

/** StrengthMeter is four segments filling in with the password's strength, and its word. */
export function StrengthMeter({ strength, empty }: { strength: Strength; empty: boolean }) {
  const t = useT();
  const s = STRENGTH[strength];
  const lit = empty ? 0 : Math.max(1, strength);
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.span
              className="block h-full rounded-full"
              initial={false}
              animate={{ scaleX: i <= lit ? 1 : 0, backgroundColor: s.color }}
              style={{ originX: 0 }}
              transition={SPRING}
            />
          </span>
        ))}
      </div>
      {/* As tall when empty as with its word, so nothing shifts as the first key is typed */}
      <span className="h-5 w-16 text-right text-sm text-muted-foreground">{empty ? "" : t(s.key)}</span>
    </div>
  );
}
