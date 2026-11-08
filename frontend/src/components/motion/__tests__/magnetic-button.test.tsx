import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { gsap } from "gsap";

import { MagneticButton } from "@/components/motion/magnetic-button.client";

const { motionState } = vi.hoisted(() => ({
  motionState: { reduced: false, gsapFail: false, hoverFine: true },
}));

// No registerPlugin here: ScrollTrigger.enable needs window.matchMedia, and
// the mock factory runs before the per-test stubs are installed. The component
// only calls gsap.quickTo/gsap.to, which do not require the plugin.
vi.mock("@/lib/motion", async () => {
  const { gsap } = await import("gsap");
  const { ScrollTrigger } = await import("gsap/ScrollTrigger");
  return {
    prefersReducedMotion: () => motionState.reduced,
    loadGsap: async () => {
      if (motionState.gsapFail) throw new Error("blocked chunk");
      return { gsap, ScrollTrigger };
    },
  };
});

function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query.includes("prefers-reduced-motion")
          ? motionState.reduced
          : motionState.hoverFine,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

describe("MagneticButton", () => {
  afterEach(() => {
    motionState.reduced = false;
    motionState.gsapFail = false;
    motionState.hoverFine = true;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders its children inside a passthrough wrapper", () => {
    stubMatchMedia();
    render(
      <MagneticButton>
        <a href="/dashboard">Launch app</a>
      </MagneticButton>,
    );
    const link = screen.getByRole("link", { name: "Launch app" });
    expect(link.parentElement).toHaveClass("inline-flex");
  });

  it("merges a custom className with the wrapper", () => {
    stubMatchMedia();
    render(<MagneticButton className="extra">x</MagneticButton>);
    expect(screen.getByText("x")).toHaveClass("inline-flex", "extra");
  });

  it("pulls the child toward the pointer through gsap.quickTo", async () => {
    stubMatchMedia();
    const xTo = vi.fn();
    const yTo = vi.fn();
    const quickToSpy = vi
      .spyOn(gsap, "quickTo")
      .mockImplementation((_target, prop) =>
        (prop === "x" ? xTo : yTo) as unknown as ReturnType<typeof gsap.quickTo>,
      );

    render(
      <MagneticButton strength={10}>
        <span>child</span>
      </MagneticButton>,
    );
    const wrapper = screen.getByText("child").parentElement as HTMLElement;

    await waitFor(() => expect(quickToSpy).toHaveBeenCalledTimes(2));
    expect(quickToSpy).toHaveBeenCalledWith(wrapper, "x", expect.anything());
    expect(quickToSpy).toHaveBeenCalledWith(wrapper, "y", expect.anything());

    // jsdom rects are zero-origin, so the pull is clientX * 0.25 (capped at ±10).
    fireEvent.pointerMove(wrapper, { clientX: 30, clientY: -40 });
    expect(xTo).toHaveBeenCalledWith(7.5);
    expect(yTo).toHaveBeenCalledWith(-10);
  });

  it("stays a plain wrapper for reduced-motion visitors", async () => {
    stubMatchMedia();
    motionState.reduced = true;
    const quickToSpy = vi.spyOn(gsap, "quickTo").mockReturnValue(vi.fn() as unknown as ReturnType<typeof gsap.quickTo>);

    render(
      <MagneticButton>
        <span>child</span>
      </MagneticButton>,
    );
    // Let any pending microtasks settle before asserting nothing was wired.
    await waitFor(() => expect(screen.getByText("child")).toBeInTheDocument());
    expect(quickToSpy).not.toHaveBeenCalled();
  });

  it("stays a plain wrapper on coarse or no-hover pointers", async () => {
    stubMatchMedia();
    motionState.hoverFine = false;
    const quickToSpy = vi.spyOn(gsap, "quickTo").mockReturnValue(vi.fn() as unknown as ReturnType<typeof gsap.quickTo>);

    render(
      <MagneticButton>
        <span>child</span>
      </MagneticButton>,
    );
    await waitFor(() => expect(screen.getByText("child")).toBeInTheDocument());
    expect(quickToSpy).not.toHaveBeenCalled();
  });

  it("keeps the children reachable when GSAP cannot load", async () => {
    stubMatchMedia();
    motionState.gsapFail = true;
    const quickToSpy = vi.spyOn(gsap, "quickTo").mockReturnValue(vi.fn() as unknown as ReturnType<typeof gsap.quickTo>);

    render(
      <MagneticButton>
        <a href="/dashboard">Launch app</a>
      </MagneticButton>,
    );
    await waitFor(() => expect(screen.getByRole("link", { name: "Launch app" })).toBeInTheDocument());
    expect(quickToSpy).not.toHaveBeenCalled();
  });

  it("clears tweens and transforms on unmount", async () => {
    stubMatchMedia();
    vi.spyOn(gsap, "quickTo").mockReturnValue(vi.fn() as unknown as ReturnType<typeof gsap.quickTo>);
    const killSpy = vi.spyOn(gsap, "killTweensOf");

    const { unmount } = render(
      <MagneticButton>
        <span>child</span>
      </MagneticButton>,
    );
    // Capture the wrapper before unmounting: after unmount the subtree is
    // detached and no longer queryable through screen.
    const wrapper = screen.getByText("child").parentElement;
    await waitFor(() => expect(wrapper).toBeInTheDocument());
    unmount();
    expect(killSpy).toHaveBeenCalledWith(wrapper);
  });
});
