import { motion, Variants } from "motion/react";
import { useAnimationsOff } from "../lib/prefs";

/**
 * PageStagger orchestrates a page's entrance: children that opt in with
 * <StaggerItem> rise into place one after another, in the order they
 * appear.
 *
 * With animations off the variants are skipped and everything starts
 * visible; otherwise Motion would commit the hidden state for one frame
 * before snapping, which reads as flicker.
 */
const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", bounce: 0, visualDuration: 0.45 },
  },
};

export function PageStagger({ children, className }: { children: React.ReactNode; className?: string }) {
  const off = useAnimationsOff();
  return (
    <motion.div variants={containerVariants} initial={off ? "visible" : "hidden"} animate="visible" className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const off = useAnimationsOff();
  return (
    <motion.div variants={itemVariants} initial={off ? "visible" : undefined} className={className}>
      {children}
    </motion.div>
  );
}
