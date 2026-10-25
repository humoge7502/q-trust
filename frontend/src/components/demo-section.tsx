import Link from "next/link";
import { Reveal } from "@/components/scroll-effects.client";
import { VideoFrame } from "@/components/ui/video-frame";
import { ArrowRightIcon } from "@/app/icons";

/**
 * Homepage video block — puts the narrated walkthrough where a visitor lands,
 * turning the abstract "verifiable trust" pitch into something they can watch.
 */
export function DemoSection() {
  return (
    <section className="bg-slate-950 text-white" aria-labelledby="demo-section-heading">
      <div className="mx-auto max-w-[88rem] px-5 py-20 sm:px-8 sm:py-28 lg:px-12 lg:py-32">
        <Reveal>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">
                See it run
              </p>
              <h2
                id="demo-section-heading"
                className="mt-6 text-4xl font-semibold leading-[0.93] tracking-[-0.06em] sm:text-6xl"
              >
                From scan to proof, <span className="text-slate-400">on film.</span>
              </h2>
              <p className="mt-7 max-w-md text-sm leading-7 text-slate-400">
                Three minutes from an invisible cryptographic estate to a record
                anyone can verify on-chain. Watch the full loop, then run it on
                your own.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/demo"
                  className="group inline-flex items-center gap-3 rounded-full bg-cyan-300 px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                >
                  Watch the full demo
                  <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
                <Link
                  href="/scanner"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                >
                  Run a scan
                </Link>
              </div>
            </div>
            <Reveal delay={100}>
              <VideoFrame
                src="/media/qtrust-demo.mp4"
                poster="/media/qtrust-demo-poster.jpg"
                title="Q-Trust full product walkthrough"
                className="aspect-video"
              />
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
