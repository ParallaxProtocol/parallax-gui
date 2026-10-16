import logo from "../../assets/logo.svg";

/**
 * LogoMark is the app's mark as the greeting and the lock screen draw it:
 * the logo's shape filled with the text colour, warming into the brand's
 * violet at its far corner, rather than the logo's own colours.
 */
export function LogoMark({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`block shrink-0 bg-gradient-to-br from-foreground via-foreground to-[var(--app-brand)] ${className}`}
      style={{
        width: size,
        height: size,
        mask: `url("${logo}") center / contain no-repeat`,
        WebkitMask: `url("${logo}") center / contain no-repeat`,
      }}
    />
  );
}
