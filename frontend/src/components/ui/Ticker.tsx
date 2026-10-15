import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useAnimationsOff } from "../../lib/prefs";

/** How long each line rests in view, and how long it takes to rise to the next (seconds). */
const HOLD = 1.6;
const RISE = 0.4;

/**
 * Ticker shows a text in one line's room: wrapped to its width, the first
 * line rests in view, then each next one rises into its place, and after
 * the last the first rises again from below, as if the text ran round a
 * wheel: a copy of it waits under the last line, and the cycle restarts
 * where the copy looks just like the start. Text that fits stays still,
 * and so does all of it with animations off.
 */
export function Ticker({ text, className = "" }: { text: string; className?: string }) {
  const body = useRef<HTMLSpanElement>(null);
  const off = useAnimationsOff();
  const [layout, setLayout] = useState({ lines: 1, height: 20 });

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      const height = parseFloat(getComputedStyle(el).lineHeight) || 20;
      const lines = Math.max(1, Math.round(el.scrollHeight / height));
      setLayout((l) => (l.lines === lines && l.height === height ? l : { lines, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const { lines, height } = layout;
  // Built once per layout, so a re-render of what holds it doesn't restart the cycle
  const motionProps = useMemo(() => {
    if (lines <= 1 || off) return {};
    // Each line rests, then rises to the next; the last rises to the copy's
    // first line, where the loop starts over unseen
    const y: number[] = [];
    const at: number[] = [];
    let now = 0;
    for (let i = 0; i < lines; i++) {
      y.push(-i * height);
      at.push(now);
      now += HOLD;
      y.push(-i * height);
      at.push(now);
      now += RISE;
    }
    y.push(-lines * height);
    at.push(now);
    const total = now;
    return {
      // Starting at the first line, so the cycle runs from mount
      initial: { y: 0 },
      animate: { y },
      transition: {
        duration: total,
        times: at.map((t) => t / total),
        ease: [0.16, 1, 0.3, 1] as const,
        repeat: Infinity,
      },
    };
  }, [lines, height, off]);

  return (
    <span className={`relative block overflow-hidden ${className}`} style={{ height }}>
      <motion.span key={text} className="block" {...motionProps}>
        <span ref={body} className="block">
          {text}
        </span>
        {/* The copy the last line rises into, so the start comes round again */}
        {lines > 1 && !off && (
          <span aria-hidden className="block">
            {text}
          </span>
        )}
      </motion.span>
    </span>
  );
}
