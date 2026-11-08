/**
 * Border beam (B5) — a quantum streak orbiting a card border, MagicUI-style.
 *
 * Pure CSS presentation, server-safe. The masked layer (globals.css "flagship
 * motion layer") renders only the 1px ring; the rotating conic child sweeps a
 * quantum arc across it. Decorative only: aria-hidden, pointer-events-none.
 * Reduced motion: the orbit freezes to a static quantum hairline via the
 * explicit override in globals.css. The parent must be `relative` with a
 * border radius for the ring to line up.
 */
import type { CSSProperties } from "react";

export interface BorderBeamProps {
  /** Visual length of the streak in px. A conic sweep expresses length as an
   *  arc angle, so the px value maps against a 1600px reference perimeter
   *  (a typical card) and is clamped to 10–120deg. */
  size?: number;
  /** Phase offset in seconds; negative values shift the starting angle. */
  delay?: number;
  className?: string;
}

export function BorderBeam({ size = 120, delay = 0, className = "" }: BorderBeamProps) {
  const arc = `${Math.min(120, Math.max(10, Math.round((size / 1600) * 360)))}deg`;
  return (
    <div
      aria-hidden="true"
      className={`border-beam pointer-events-none ${className}`.trim()}
      style={{ "--beam-arc": arc } as CSSProperties}
    >
      <div
        className="border-beam-orbit"
        style={delay !== 0 ? { animationDelay: `${delay}s` } : undefined}
      />
    </div>
  );
}
