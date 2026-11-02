"use client";

/**
 * Lenis smooth scroll for story routes. Deliberately NOT mounted in the root
 * layout: application surfaces (scanner tabs, dashboards, forms) read better
 * with native momentum, and the e2e suite scrolls those routes
 * programmatically — smoothing would make Playwright nondeterministic.
 *
 * Guards, in order:
 *   - `navigator.webdriver` (automation) → native scroll.
 *   - `prefers-reduced-motion: reduce` → native scroll.
 *   - WebGL-era rule: if anything throws, the page keeps scrolling natively.
 *
 * Lenis is driven from GSAP's ticker (the integration GSAP recommends), so
 * ScrollTrigger progress and scroll position advance on one clock.
 */
import { useEffect } from "react";
import { loadGsap, prefersReducedMotion } from "@/lib/motion";

export function SmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion() || navigator.webdriver) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    void (async () => {
      try {
        const [{ gsap, ScrollTrigger }, { default: Lenis }] = await Promise.all([
          loadGsap(),
          import("lenis"),
        ]);
        if (disposed) return;

        const html = document.documentElement;
        html.classList.add("lenis-on");
        const lenis = new Lenis({
          duration: 1.15,
          anchors: true,
          // Native wheel feel, slightly eased; Lenis handles touch natively
          // on mobile so there is no scroll-hijack there.
          easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        });
        lenis.on("scroll", ScrollTrigger.update);

        const tick = (time: number) => {
          lenis.raf(time * 1000);
        };
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);

        teardown = () => {
          gsap.ticker.remove(tick);
          lenis.destroy();
          html.classList.remove("lenis-on");
        };
      } catch {
        // Smooth scroll is a enhancement; native scrolling is always the
        // fallback. Nothing to report — fail silent by design here.
      }
    })();

    return () => {
      disposed = true;
      teardown?.();
    };
  }, []);

  return null;
}
