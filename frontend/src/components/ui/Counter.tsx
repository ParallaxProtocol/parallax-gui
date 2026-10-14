import { useEffect } from "react";
import { motion, useSpring, useTransform } from "motion/react";
import { useAnimationsOff } from "../../lib/prefs";

/**
 * Counter shows a number that glides to each new value on a spring, its
 * text formatted on every frame by `format`. The first value shows at
 * once; only changes move.
 */
export function Counter({
  value,
  format,
  className,
}: {
  value: number;
  format: (v: number) => string;
  className?: string;
}) {
  const still = useAnimationsOff();
  const spring = useSpring(value, { bounce: 0, visualDuration: 0.6 });
  const text = useTransform(spring, format);

  useEffect(() => {
    if (still) spring.jump(value);
    else spring.set(value);
  }, [value, still, spring]);

  return <motion.span className={`tabular-nums ${className ?? ""}`}>{text}</motion.span>;
}
