"use client";

/**
 * Magnetic wrapper (B8) — pulls its child (a Button or link) toward the
 * cursor within ±10px using GSAP quickTo on x/y (compositor-only transforms),
 * and springs the child back on pointer leave. GSAP is loaded through
 * loadGsap() — never at module top level.
 *
 * Strict opt-in: the effect bails for prefers-reduced-motion visitors and for
 * coarse/no-hover pointers, leaving a plain passthrough wrapper (inline-flex,
 * no styles of its own), so keyboard and touch behaviour are untouched.
 *
 * ease-brand is a CSS cubic-bezier; GSAP's expo.out is its closest built-in
 * curve, used for both the pull and the spring-back.
 */
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { loadGsap, prefersReducedMotion } from "@/lib/motion";

type Gsap = Awaited<ReturnType<typeof loadGsap>>["gsap"];

export function MagneticButton({
  children,
  className = "",
  strength = 10,
}: {
  children: ReactNode;
  className?: string;
  /** Maximum pull distance in px. */
  strength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersReducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let cancelled = false;
    let detach: (() => void) | undefined;

    void (async () => {
      try {
        const { gsap } = await loadGsap();
        if (cancelled || ref.current !== element) return;

        const xTo = gsap.quickTo(element, "x", { duration: 0.35, ease: "expo.out" });
        const yTo = gsap.quickTo(element, "y", { duration: 0.35, ease: "expo.out" });
        const clamp = (value: number) => Math.max(-strength, Math.min(strength, value));

        const onMove = (event: PointerEvent) => {
          const rect = element.getBoundingClientRect();
          // Proportional pull toward the cursor, capped at ±strength.
          xTo(clamp((event.clientX - (rect.left + rect.width / 2)) * 0.25));
          yTo(clamp((event.clientY - (rect.top + rect.height / 2)) * 0.25));
        };
        const onLeave = () => {
          gsap.to(element, { x: 0, y: 0, duration: 0.6, ease: "expo.out" });
        };

        element.addEventListener("pointermove", onMove);
        element.addEventListener("pointerleave", onLeave);
        detach = () => {
          element.removeEventListener("pointermove", onMove);
          element.removeEventListener("pointerleave", onLeave);
          gsap.killTweensOf(element);
          gsap.set(element, { clearProps: "x,y" });
        };
      } catch {
        // GSAP failed to load: the wrapper stays a plain passthrough, exactly
        // like the no-motion path. Fail silent, per lib/motion.ts convention.
      }
    })();

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [strength]);

  return (
    <span ref={ref} className={`inline-flex ${className}`.trim()}>
      {children}
    </span>
  );
}
