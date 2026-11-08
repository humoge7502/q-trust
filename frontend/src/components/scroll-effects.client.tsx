"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Entrance variants. "blur" is the default and matches the pre-variant
 * behaviour exactly; the others are pure CSS hidden-states in globals.css
 * (`html.js .reveal-*`), so no-JS visitors and reduced-motion users keep the
 * same fully-visible fallback for every variant.
 */
export type RevealVariant = "blur" | "rise" | "scale" | "slide-left";

/** Stagger step applied to Reveal children inside a `data-reveal-group`. */
const GROUP_STAGGER_MS = 90;

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  once?: boolean;
  variant?: RevealVariant;
}

const VARIANT_CLASS: Record<RevealVariant, string> = {
  blur: "",
  rise: "reveal-rise",
  scale: "reveal-scale",
  "slide-left": "reveal-slide-left",
};

export function Reveal({ children, className = "", delay = 0, once = true, variant = "blur" }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // Inside a `data-reveal-group` parent, this Reveal's index among the
  // group's direct `.reveal` children becomes an incremental delay. Computed
  // on mount (CSS cannot do sibling indexing) and merged with `delay`.
  const [staggerOffset, setStaggerOffset] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const group = element.closest<HTMLElement>("[data-reveal-group]");
    if (group) {
      const index = Array.from(group.querySelectorAll(":scope > .reveal")).indexOf(element);
      if (index > 0) setStaggerOffset(index * GROUP_STAGGER_MS);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) observer.unobserve(element);
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [once]);

  const variantClass = VARIANT_CLASS[variant];
  return (
    <div
      ref={ref}
      className={`reveal ${variantClass} ${visible ? "reveal-visible" : ""} ${className}`.trim()}
      style={{ "--reveal-delay": `${delay + staggerOffset}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function ScrollProgress() {
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? window.scrollY / max : 0;
      document.documentElement.style.setProperty("--scroll-progress", String(Math.min(1, Math.max(0, progress))));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="scroll-progress" aria-hidden="true" />;
}
