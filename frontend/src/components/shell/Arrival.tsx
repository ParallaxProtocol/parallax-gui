import { useState, type ReactNode } from "react";
import { motion } from "motion/react";

/** How long, in s, the app is left to mount and draw its first page under the cover before it lifts. */
const SETTLE = 0.3;

/**
 * Arrival is the app coming in once the first launch's setup is through,
 * as a Mac's desktop does after its setup assistant: the setup gone, the
 * app fades up out of the same plain background. The app itself is never
 * animated (its glass would have every frame's blur redone, while it is
 * still mounting): it renders as ever, under a cover of the background
 * that waits for it to settle, then dissolves. Otherwise (play false) it
 * is just there.
 */
export function Arrival({
  play,
  coverClassName = "z-[1000]",
  children,
}: {
  play: boolean;
  /** Where the cover lies: over everything, or under what stays in place as the app arrives. */
  coverClassName?: string;
  children: ReactNode;
}) {
  const [covered, setCovered] = useState(play);
  return (
    <>
      {children}
      {covered && (
        <motion.div
          aria-hidden
          className={`pointer-events-none fixed inset-0 bg-background ${coverClassName}`}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ delay: SETTLE, duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
          onAnimationComplete={() => setCovered(false)}
        />
      )}
    </>
  );
}
