"use client";

/**
 * Count-up for the proof-section figures. IntersectionObserver fires once;
 * GSAP tweens a plain object and writes textContent directly — high-frequency
 * animation never touches React state. Reduced motion renders the final value
 * immediately (the server HTML already contains it, so this only affects
 * hydrated clients).
 */
import { useEffect, useRef } from "react";
import { loadGsap, prefersReducedMotion } from "@/lib/motion";

export function CountUp({ to, className }: { to: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return; // SSR markup already shows the final value
    let cleanup: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;

    void (async () => {
      try {
        const { gsap } = await loadGsap();
        const state = { value: 0 };
        const render = () => { el.textContent = String(Math.round(state.value)); };
        const tween = gsap.to(state, {
          value: to,
          duration: 1.6,
          ease: "power2.out",
          snap: { value: 1 },
          onUpdate: render,
          paused: true,
        });
        observer = new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting) {
            tween.play();
            observer?.disconnect();
          }
        }, { threshold: 0.4 });
        observer.observe(el);
        cleanup = () => { tween.kill(); };
      } catch {
        // GSAP failed to load: the figure stays at the server-rendered final
        // value (same as reduced motion). Fail silent, by design.
      }
    })();

    return () => { observer?.disconnect(); cleanup?.(); };
  }, [to]);

  return <span ref={ref} className={className}>{to}</span>;
}
