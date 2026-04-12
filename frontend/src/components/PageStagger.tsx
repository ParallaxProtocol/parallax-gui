import { motion, Variants } from "motion/react";

/**
 * PageStagger orchestrates the entrance choreography of an entire page.
 * Children that opt in by using <StaggerItem> reveal one after another in
 * the order they appear, producing the cinematic "the page is settling
 * into place" feel that the marketing site uses on hero sections.
 *
 * When the user has disabled animations (body.no-anim is set), we skip
 * the variants entirely and start at the visible state — otherwise
 * motion would commit the hidden state for one frame before snapping,
 * which the user sees as flicker.
 */
const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
};

// Synchronous read of the body class set by App.tsx. We don't need
// reactivity here — the class is in place before any PageStagger mounts
// after the user toggles the setting and navigates.
function animationsDisabled(): boolean {
  if (typeof document === "undefined") return false;
  return document.body.classList.contains("no-anim");
}

export function PageStagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const off = animationsDisabled();
  return (
    <motion.div
      variants={containerVariants}
      initial={off ? "visible" : "hidden"}
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const off = animationsDisabled();
  return (
    <motion.div
      variants={itemVariants}
      initial={off ? "visible" : undefined}
      className={className}
    >
      {children}
    </motion.div>
  );
}
