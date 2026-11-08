import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { HorizontalTour } from "@/components/motion/horizontal-tour.client";
import type { TourClip } from "@/components/motion/horizontal-tour.client";

const clips: TourClip[] = [
  { src: "/media/one.mp4", title: "Scan the estate", copy: "Collect the cryptographic inventory." },
  { src: "/media/two.mp4", title: "Rank the exposure", copy: "Get an ordered migration plan." },
];

const { motionState } = vi.hoisted(() => ({
  motionState: { reduced: false },
}));

// No registerPlugin here: ScrollTrigger.enable needs window.matchMedia, and
// the mock factory runs before the per-test stubs are installed. The pinned
// contexts never execute in jsdom, so the unregistered plugin is fine.
vi.mock("@/lib/motion", async () => {
  const { gsap } = await import("gsap");
  const { ScrollTrigger } = await import("gsap/ScrollTrigger");
  return {
    prefersReducedMotion: () => motionState.reduced,
    loadGsap: async () => ({ gsap, ScrollTrigger }),
  };
});

function installMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      // The pinned desktop context requires min-width: 1024px; jsdom never
      // matches it, so the pinned GSAP path stays off in every test.
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

function installIntersection(visible: boolean) {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe = (element: Element) =>
        this.cb(
          [{ isIntersecting: visible, target: element } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = () => [];
    },
  );
}

describe("HorizontalTour", () => {
  afterEach(() => {
    motionState.reduced = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the heading and every clip in the static grid", () => {
    installMatchMedia(true);
    installIntersection(true);
    render(<HorizontalTour clips={clips} heading="Seven clips, one loop" />);

    expect(screen.getByRole("heading", { name: "Seven clips, one loop" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scan the estate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rank the exposure" })).toBeInTheDocument();
    expect(screen.getByText("Collect the cryptographic inventory.")).toBeInTheDocument();
    expect(screen.getByText("Get an ordered migration plan.")).toBeInTheDocument();
    // Each clip is a playable video, not an image or a link.
    expect(screen.getAllByRole("figure")).toHaveLength(clips.length);
  });

  it("exposes the section through the heading reference", () => {
    installMatchMedia(true);
    installIntersection(true);
    const { container } = render(<HorizontalTour clips={clips} heading="Feature tour" />);

    const section = container.querySelector("section");
    expect(section).toHaveAttribute("aria-labelledby", "tour-heading");
    expect(document.getElementById("tour-heading")?.textContent).toBe("Feature tour");
  });

  it("keeps the progress HUD decorative with the first slide", () => {
    installMatchMedia(true);
    installIntersection(true);
    const { container } = render(<HorizontalTour clips={clips} heading="HUD" />);

    const hud = container.querySelector(".tour-hud");
    expect(hud).toHaveAttribute("aria-hidden", "true");
    expect(hud?.textContent).toContain("01 / 02");
    // The scrub is ref-driven; the React markup never claims slide text twice.
    expect(screen.queryByText("02 / 02")).not.toBeInTheDocument();
  });

  it("never activates the pinned layout under reduced motion", async () => {
    installMatchMedia(true);
    installIntersection(true);
    motionState.reduced = true;
    const { container } = render(<HorizontalTour clips={clips} heading="Reduced" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const section = container.querySelector("section");
    expect(section).not.toHaveClass("tour-live");
    // The same clips stay reachable — nothing is hidden in the fallback.
    expect(screen.getByRole("heading", { name: "Scan the estate" })).toBeInTheDocument();
  });

  it("never activates the pinned layout below the desktop breakpoint", async () => {
    installMatchMedia(false);
    installIntersection(true);
    const { container } = render(<HorizontalTour clips={clips} heading="Narrow" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("section")).not.toHaveClass("tour-live");
  });
});
