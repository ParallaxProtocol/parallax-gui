/**
 * The tones a small mark can take (an icon's badge, a label pill): neutral,
 * the accent, or a status grade. Each is a faint wash of its colour behind
 * its ink.
 */
export type Tone = "neutral" | "brand" | "info" | "warn" | "good" | "critical";

export const TONE_WASH: Record<Tone, string> = {
  neutral: "bg-muted text-foreground/80",
  brand: "bg-brand-muted text-brand",
  info: "bg-info/15 text-info-ink",
  warn: "bg-warn/15 text-warn-ink",
  good: "bg-good/15 text-good-ink",
  critical: "bg-critical/15 text-critical-ink",
};
