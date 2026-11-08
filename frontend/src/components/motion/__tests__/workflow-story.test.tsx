import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { WorkflowStory } from "@/components/motion/workflow-story.client";

const { motionState } = vi.hoisted(() => ({
  motionState: { reduced: false },
}));

// No registerPlugin here: ScrollTrigger.enable needs window.matchMedia, and
// the mock factory runs before the per-test stubs are installed. The desktop
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
      // The scrubbed rail runs inside a min-width: 1024px context; jsdom never
      // matches it, so GSAP stays out of the test and the static layout is
      // exactly what is asserted.
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

describe("WorkflowStory", () => {
  afterEach(() => {
    motionState.reduced = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the operating loop with all three steps", () => {
    installMatchMedia(false);
    installIntersection(true);
    render(<WorkflowStory />);

    expect(screen.getByRole("heading", { name: "See what you actually run." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Turn exposure into a sequence." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Make progress portable." })).toBeInTheDocument();
    expect(screen.getByText("Scan")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Attest")).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
  });

  it("labels the section by its heading", () => {
    installMatchMedia(false);
    installIntersection(true);
    const { container } = render(<WorkflowStory />);

    const section = container.querySelector("section");
    expect(section).toHaveAttribute("aria-labelledby", "workflow-heading");
    expect(document.getElementById("workflow-heading")?.textContent).toMatch(/Less theatre\./);
    expect(document.getElementById("workflow-heading")?.textContent).toMatch(/More traceability\./);
  });

  it("carries the per-step meta copy and counters", () => {
    installMatchMedia(false);
    installIntersection(true);
    render(<WorkflowStory />);

    expect(screen.getByText("12+ source languages / 10+ manifest formats")).toBeInTheDocument();
    expect(screen.getByText("NIST / CNSA / GNN-ranked")).toBeInTheDocument();
    expect(screen.getByText("EIP-712 / UUPS / hash-only")).toBeInTheDocument();
    expect(screen.getByText("01 / 03")).toBeInTheDocument();
    expect(screen.getByText("02 / 03")).toBeInTheDocument();
    expect(screen.getByText("03 / 03")).toBeInTheDocument();
  });

  it("keeps the static token layout for reduced-motion visitors", () => {
    installMatchMedia(true);
    installIntersection(true);
    motionState.reduced = true;
    const { container } = render(<WorkflowStory />);

    // The decorative rail exists (aria-hidden) but GSAP never touched it:
    // no inline scaleY transform is applied by the component itself.
    const rail = container.querySelector("div[aria-hidden='true']");
    expect(rail).toBeInTheDocument();
    expect(rail).not.toHaveAttribute("style");
    // All content stays visible — nothing is hidden in the fallback.
    expect(screen.getByRole("heading", { name: "See what you actually run." })).toBeInTheDocument();
  });
});
