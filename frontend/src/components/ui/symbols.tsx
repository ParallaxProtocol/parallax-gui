import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/**
 * star is a four-pointed star's outline, as SF draws its sparkles: the
 * sides curving in between the points, not straight.
 */
function star(cx: number, cy: number, r: number): string {
  // How far the sides bow in: the curves' control points, toward the middle
  const k = r * 0.14;
  return [
    `M${cx} ${cy - r}`,
    `Q${cx + k} ${cy - k} ${cx + r} ${cy}`,
    `Q${cx + k} ${cy + k} ${cx} ${cy + r}`,
    `Q${cx - k} ${cy + k} ${cx - r} ${cy}`,
    `Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`,
  ].join("");
}

/**
 * SparklesSymbol is SF's sparkles, the mark Apple gives what's done by AI,
 * where Lucide's strays from it: a large star with two smaller ones above
 * it, filled, their points softened by the stroke, which thickens them
 * with `strokeWidth` as a Lucide icon's lines do. On Lucide's 24-unit
 * grid, inside its margin, so it stands in for a Lucide icon anywhere one
 * is taken (an IconBadge, an IconTile). Centred by weight, not by outline:
 * the stars' areas balance on the grid's middle. The corner below right is
 * left empty, for a badge.
 */
export const SparklesSymbol = forwardRef<SVGSVGElement, LucideProps>(function SparklesSymbol(
  { size = 24, strokeWidth = 1.75, absoluteStrokeWidth: _absolute, color = "currentColor", ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke={color}
      strokeWidth={Number(strokeWidth) * 0.6}
      strokeLinejoin="round"
      {...rest}
    >
      <path d={star(11.5, 13.5, 6.5)} />
      <path d={star(18, 5.75, 2.75)} />
      <path d={star(5, 5.5, 1.75)} />
    </svg>
  );
});

/**
 * OnionSymbol is Tor's onion, which Lucide hasn't: a bulb in layers under
 * its sprout, drawn as Lucide draws, on its 24-unit grid in lines of
 * `strokeWidth`, so it stands in for a Lucide icon anywhere one is taken.
 */
export const OnionSymbol = forwardRef<SVGSVGElement, LucideProps>(function OnionSymbol(
  { size = 24, strokeWidth = 2, absoluteStrokeWidth: _absolute, color = "currentColor", ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M12 8C8 9.5 5 12 5 15.25 5 18.6 8.1 21 12 21s7-2.4 7-5.75C19 12 16 9.5 12 8Z" />
      <path d="M12 11.5c-2 .9-3.25 2.25-3.25 3.9 0 1.75 1.45 2.85 3.25 2.85s3.25-1.1 3.25-2.85c0-1.65-1.25-3-3.25-3.9Z" />
      <path d="M12 8V5.5" />
      <path d="M12 5.5c0-1.4 1.1-2.5 2.75-2.5" />
    </svg>
  );
});
