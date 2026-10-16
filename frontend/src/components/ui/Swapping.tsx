import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FADE_IN, FADE_OUT, SPRING } from "../../lib/motion";

/**
 * Swapping changes what it holds as the switch above it changes: the old
 * fading out as the new fades in, and its height gliding from the one's
 * to the other's. Between swaps it follows its content's height at once,
 * so what grows inside it (a row unfolding) isn't chased by a second glide.
 */
export function Swapping({ swap, children }: { swap: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  // Glides only from a swap until its height settles
  const [gliding, setGliding] = useState(false);
  const [last, setLast] = useState(swap);
  if (last !== swap) {
    setLast(swap);
    setGliding(true);
  }
  // A swap to the same height never glides, so it can't settle either
  useEffect(() => {
    if (!gliding) return;
    const id = setTimeout(() => setGliding(false), 800);
    return () => clearTimeout(id);
  }, [gliding]);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div
      className="relative overflow-hidden"
      initial={false}
      animate={{ height }}
      transition={gliding ? SPRING : { duration: 0 }}
      onAnimationComplete={() => setGliding(false)}
    >
      <div ref={inner}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={swap}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: FADE_IN }}
            exit={{ opacity: 0, transition: FADE_OUT }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
