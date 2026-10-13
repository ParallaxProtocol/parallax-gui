import { useState, type ReactNode } from "react";
import { Label, Plate, type Tone } from "./Plate";
import { Rolling } from "./Rolling";

/**
 * Tile is one headline figure on a plate: a label and readout along the
 * top, the figure, a line or two of qualifier, then anything else (a
 * chart, a bar). Its border glows briefly whenever `flashKey` changes
 * after first render, as the status page's tiles do on a new block.
 */
export function Tile({
  label,
  readout,
  value,
  unit,
  qualifier,
  tone,
  flashKey,
  className = "",
  children,
}: {
  label: ReactNode;
  readout?: ReactNode;
  value?: ReactNode;
  unit?: string;
  qualifier?: ReactNode;
  tone?: Tone;
  flashKey?: string | number;
  className?: string;
  children?: ReactNode;
}) {
  const [first] = useState(flashKey);
  return (
    <Plate tone={tone} className={`flex min-w-0 flex-col gap-3 p-5 ${className}`}>
      {flashKey !== undefined && flashKey !== first && (
        <span key={flashKey} aria-hidden className="tile-flash" />
      )}
      <div className="flex items-baseline justify-between gap-3">
        <Label className="whitespace-nowrap">{label}</Label>
        {readout && (
          <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{readout}</span>
        )}
      </div>
      {value !== undefined && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="-mx-2 truncate px-2 text-3xl tracking-tight tabular-nums">
            {typeof value === "string" ? <Rolling value={value} /> : value}
            {unit && <span className="text-base text-muted-foreground"> {unit}</span>}
          </span>
          {qualifier && <span className="text-sm leading-5 text-muted-foreground">{qualifier}</span>}
        </div>
      )}
      {children}
    </Plate>
  );
}
