"use client";

/**
 * Pinned horizontal scroll tour (B9) for the /demo 7-clip feature tour.
 *
 * Division of labour: on desktop with motion allowed
 * (`gsap.matchMedia("(min-width: 1024px) and (prefers-reduced-motion: no-preference)")`)
 * the section pins and the track translates horizontally, scrub 0.6, driven by
 * loadGsap(). The pinned layout is added via the `tour-live` class only inside
 * that matchMedia context — it is presentation-only.
 *
 * Mobile, no-JS, and reduced-motion visitors get the same clips in a plain CSS
 * grid (the markup's default), no transforms, no pin — the component never
 * hides or duplicates content between presentations.
 *
 * The progress bar and slide counter are decorative (aria-hidden) and are
 * written via refs from the ScrollTrigger callback — no re-renders while
 * scrubbing.
 */
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { loadGsap, prefersReducedMotion } from "@/lib/motion";
import { Reveal } from "@/components/scroll-effects.client";
import { VideoFrame } from "@/components/ui/video-frame";

type Gsap = Awaited<ReturnType<typeof loadGsap>>["gsap"];

export interface TourClip {
  src: string;
  title: string;
  copy: string;
}

interface HorizontalTourProps {
  clips: TourClip[];
  /** Section heading copy, passed through verbatim from the server shell. */
  heading: ReactNode;
}

export function HorizontalTour({ clips, heading }: HorizontalTourProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const counterRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    let mm: ReturnType<Gsap["matchMedia"]> | null = null;

    void (async () => {
      try {
        const { gsap } = await loadGsap();
        if (cancelled) return;
        mm = gsap.matchMedia();
        mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
          const section = sectionRef.current;
          const track = trackRef.current;
          const viewport = track?.parentElement;
          if (!section || !track || !viewport) return;

          section.classList.add("tour-live");
          const total = clips.length;
          const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);

          const tween = gsap.to(track, {
            x: () => -distance(),
            ease: "none",
            scrollTrigger: {
              trigger: section,
              start: "top top",
              end: () => `+=${distance()}`,
              pin: true,
              scrub: 0.6,
              anticipatePin: 1,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                if (progressRef.current) {
                  progressRef.current.style.transform = `scaleX(${self.progress})`;
                }
                if (counterRef.current) {
                  const slide = Math.min(total, Math.max(1, Math.round(self.progress * (total - 1)) + 1));
                  counterRef.current.textContent = `${String(slide).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
                }
              },
            },
          });

          return () => {
            tween.scrollTrigger?.kill();
            tween.kill();
            section.classList.remove("tour-live");
          };
        });
      } catch {
        // GSAP failed to load: the static grid — already the no-JS state — is
        // the fallback. Fail silent, per lib/motion.ts convention.
      }
    })();

    return () => {
      cancelled = true;
      // Reverting the context kills the ScrollTrigger and reverts inline
      // styles; the tour-live class is removed by the context cleanup above.
      mm?.revert();
    };
  }, [clips.length]);

  return (
    <section
      ref={sectionRef}
      className="border-t border-night-edge bg-canvas text-foreground"
      aria-labelledby="tour-heading"
    >
      <div className="tour-viewport mx-auto max-w-[88rem] px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <Reveal>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <p className="text-micro font-bold uppercase tracking-[0.28em] text-muted-foreground">
                Feature tour
              </p>
              <h2
                id="tour-heading"
                className="mt-5 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
              >
                {heading}
              </h2>
            </div>
            <div className="tour-hud items-center gap-4" aria-hidden="true">
              <span
                ref={counterRef}
                className="font-mono text-xs tabular-nums text-muted-foreground"
              >
                01 / {String(clips.length).padStart(2, "0")}
              </span>
              <div className="tour-progress-track">
                <div ref={progressRef} className="tour-progress-fill" />
              </div>
            </div>
          </div>
        </Reveal>
        <div
          ref={trackRef}
          className="tour-track mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {clips.map((clip) => (
            <article key={clip.src} className="tour-slide flex h-full flex-col">
              <VideoFrame src={clip.src} title={clip.title} className="aspect-video">
                {clip.title}
              </VideoFrame>
              <h3 className="mt-4 text-lg font-semibold tracking-[-0.03em]">{clip.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{clip.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
