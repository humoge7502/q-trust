"use client";

/**
 * Single registration point for GSAP + ScrollTrigger.
 *
 * The marketing layer's animation division of labour:
 *   - CSS + IntersectionObserver (`scroll-effects.client.tsx`) owns entrance
 *     reveals — zero JS cost, works without JavaScript, already reduced-motion
 *     safe. It stays.
 *   - GSAP + ScrollTrigger owns what CSS cannot express: scrub-linked and
 *     pinned scroll storytelling. Components opt in per effect.
 *   - Lenis (`motion/smooth-scroll.client.tsx`) owns scroll smoothing on
 *     story routes, driven from GSAP's ticker so both systems share a clock.
 *
 * Everything is dynamically imported so GSAP/Lenis never touch the initial
 * bundle or the server build.
 */
let cached: Promise<{ gsap: typeof import("gsap")["gsap"]; ScrollTrigger: typeof import("gsap/ScrollTrigger")["ScrollTrigger"] }> | null = null;

export function loadGsap() {
  cached ??= (async () => {
    try {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      gsap.registerPlugin(ScrollTrigger);
      // ScrollTrigger measures positions at init; web fonts landing later
      // change text metrics and every trigger start/end. One refresh after
      // fonts settle fixes the drift (runs once — this whole init is inside
      // the cached promise). Retried if `cached` was reset by a failure.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        void document.fonts.ready.then(() => ScrollTrigger.refresh());
      }
      return { gsap, ScrollTrigger };
    } catch (error) {
      // A rejected promise would otherwise be cached forever: every later
      // caller would await the same failure and no retry could ever happen.
      cached = null;
      throw error;
    }
  })();
  return cached;
}

/** True when the visitor asked for reduced motion. Read once per call —
 *  callers should treat a change mid-session as out of scope. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
