"use client";

/**
 * The "operating loop" workflow story — the moved `WorkflowSection` from the
 * landing page, now a client component so GSAP can layer on what CSS cannot
 * express: the vertical rail scrubbed by scroll position, and per-step node
 * activation as each article crosses into view.
 *
 * Division of labour (mirrors `lib/motion.ts`): `Reveal` stays the entrance
 * system for every element; GSAP only drives the rail scale and the node-chip
 * state flip, inside a `matchMedia` context scoped to desktop and
 * no-preference motion. Reduced-motion and mobile visitors get the static
 * token-styled layout, unchanged.
 */
import { useEffect, useRef } from "react";
import { BeakerIcon, CpuChipIcon, ShieldCheckIcon } from "@/app/icons";
import { Reveal } from "@/components/scroll-effects.client";
import { loadGsap, prefersReducedMotion } from "@/lib/motion";

type Gsap = Awaited<ReturnType<typeof loadGsap>>["gsap"];
type KillableTrigger = { kill: () => void };

const steps = [
  { number: "01", label: "Scan", title: "See what you actually run.", copy: "Collect a cryptographic inventory from code, dependencies, endpoints, binaries, and configs. Export CycloneDX or SARIF for the tools you already use.", meta: "12+ source languages / 10+ manifest formats", icon: BeakerIcon },
  { number: "02", label: "Plan", title: "Turn exposure into a sequence.", copy: "Score the estate against migration policy, compliance frameworks, and business context. Get an ordered plan instead of another undifferentiated list.", meta: "NIST / CNSA / GNN-ranked", icon: CpuChipIcon },
  { number: "03", label: "Attest", title: "Make progress portable.", copy: "Anchor evidence hashes, migration steps, and vendor claims to Base. Anyone with the asset ID can independently verify the record.", meta: "EIP-712 / UUPS / hash-only", icon: ShieldCheckIcon },
];

export function WorkflowStory() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const stepsWrapRef = useRef<HTMLDivElement | null>(null);
  const articleRefs = useRef<Array<HTMLElement | null>>([]);
  const nodeRefs = useRef<Array<HTMLDivElement | null>>([]);

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
          const triggers: KillableTrigger[] = [];

          // The rail draws itself downward as the story scrolls past.
          const rail = railRef.current;
          const wrap = stepsWrapRef.current;
          if (rail && wrap) {
            const tween = gsap.fromTo(
              rail,
              { scaleY: 0 },
              {
                scaleY: 1,
                ease: "none",
                transformOrigin: "top",
                scrollTrigger: { trigger: wrap, start: "top 70%", end: "bottom 55%", scrub: 0.4 },
              },
            );
            if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
          }

          // Each numbered node lights up when its step enters the reading zone.
          // GSAP animates plain values, so the colors are hex literals — they
          // are token-locked, not drift:
          // #67e8f9 = --color-quantum-soft; #020617 = --color-night;
          // rgba(103,232,249,0.9) = quantum-soft at 90% (the node border tint).
          articleRefs.current.forEach((article, index) => {
            const node = nodeRefs.current[index];
            if (!article || !node) return;
            const tween = gsap.to(node, {
              backgroundColor: "#67e8f9",
              color: "#020617",
              borderColor: "rgba(103,232,249,0.9)",
              duration: 0.35,
              scrollTrigger: { trigger: article, start: "top 62%", toggleActions: "play none none reverse" },
            });
            if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
          });

          return () => {
            triggers.forEach((trigger) => trigger.kill());
          };
        });
      } catch {
        // GSAP failed to load (rejected dynamic import, blocked chunk): the
        // static token-styled layout — already the no-JS state — is the
        // fallback. Fail silent, like smooth-scroll.client.tsx.
      }
    })();

    return () => {
      cancelled = true;
      // Reverting the context reverts inline styles and kills any
      // ScrollTrigger the cleanup above did not already reach.
      mm?.revert();
    };
  }, []);

  return (
    <section id="workflow" className="bg-night text-night-ink" aria-labelledby="workflow-heading">
      <div className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-36">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-quantum-soft">The operating loop</p>
            <h2 id="workflow-heading" className="mt-6 text-4xl font-semibold leading-[0.93] tracking-[-0.06em] sm:text-6xl">
              Less theatre.<br />
              <span className="text-night-ink-soft">More traceability.</span>
            </h2>
          </div>
        </Reveal>
        <div className="relative mt-16" ref={stepsWrapRef}>
          <div
            ref={railRef}
            className="absolute left-[1.05rem] top-8 hidden h-[calc(100%-4rem)] w-px bg-gradient-to-b from-quantum-soft via-qtrust-400 to-qtrust-300 opacity-50 lg:block"
            aria-hidden="true"
          />
          {steps.map((step, index) => (
            <Reveal key={step.number} delay={index * 100}>
              <article
                ref={(el) => { articleRefs.current[index] = el; }}
                className="relative grid gap-7 border-t border-white/15 py-9 lg:grid-cols-[7rem_1fr_0.9fr] lg:gap-10 lg:py-12"
              >
                <div className="flex items-start gap-5 lg:block">
                  <div
                    ref={(el) => { nodeRefs.current[index] = el; }}
                    className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border border-quantum-soft/50 bg-night text-[10px] font-bold text-quantum-soft"
                  >
                    {step.number}
                  </div>
                  <div className="mt-1 hidden text-[10px] font-bold uppercase tracking-[0.2em] text-night-ink-soft lg:block">{step.label}</div>
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <step.icon className="h-5 w-5 text-quantum-soft" aria-hidden="true" />
                    <h3 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{step.title}</h3>
                  </div>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-night-ink-soft">{step.copy}</p>
                </div>
                <div className="flex items-end justify-between gap-5 border-l border-white/10 pl-5 lg:flex-col lg:justify-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-night-ink-soft">{step.meta}</div>
                  <span className="text-xs font-semibold text-quantum-soft">0{index + 1} / 03</span>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
