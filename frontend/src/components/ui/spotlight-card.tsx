"use client";

/**
 * Mouse-follow radial spotlight card (B1).
 *
 * pointermove writes --spot-x/--spot-y straight to the element via ref — CSS
 * variables only, so moving the pointer never re-renders React. Two
 * aria-hidden overlays (globals.css "flagship motion layer") render the glow:
 * a soft radial fill and the same gradient masked to a 1px border ring.
 *
 * Activation is gated to `(hover: hover) and (pointer: fine)` in CSS, so
 * touch/coarse pointers never see it. Reduced motion needs no special state:
 * following a pointer is not an animation, and the overlay fades are already
 * collapsed by the global kill-switch. Listeners are React props, so unmount
 * teardown is automatic.
 */
import type { CSSProperties, HTMLAttributes, PointerEvent, ReactNode } from "react";
import { useRef } from "react";

export interface SpotlightCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Spotlight radius in px (feeds --spot-radius). */
  radius?: number;
}

export function SpotlightCard({ children, className = "", radius = 320, ...props }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const setSpot = (event: PointerEvent<HTMLDivElement>) => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    element.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  };

  const clearSpot = () => {
    ref.current?.style.removeProperty("--spot-x");
    ref.current?.style.removeProperty("--spot-y");
  };

  return (
    <div
      ref={ref}
      className={`spotlight-card relative ${className}`.trim()}
      style={{ "--spot-radius": `${radius}px` } as CSSProperties}
      onPointerMove={setSpot}
      onPointerLeave={clearSpot}
      {...props}
    >
      {children}
      {/* Decorative light layers sit above the card surface so the glow reads
          over the panel background; pointer-events-none keeps clicks/text
          selection untouched, aria-hidden keeps them out of the a11y tree. */}
      <div className="spotlight-glow pointer-events-none" aria-hidden="true" />
      <div className="spotlight-ring pointer-events-none" aria-hidden="true" />
    </div>
  );
}
