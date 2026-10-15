/**
 * ASSISTANT_GLOW lights what belongs to the AI assistants, as GlowCard
 * lights the app's hero surfaces: no coloured edge, only soft light, here
 * the assistants' blue fading out through a hint of indigo. It is the
 * background of a glow wider and taller than the surface it lights.
 */
// A flat peak, so the light spreads rather than gathers in the middle
export const ASSISTANT_GLOW =
  "radial-gradient(closest-side, color-mix(in oklab, var(--info) 13%, transparent), color-mix(in oklab, var(--info) 10%, transparent) 40%, color-mix(in oklab, #5b5bf0 5%, transparent) 72%, transparent)";
