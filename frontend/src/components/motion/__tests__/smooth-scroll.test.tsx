import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { SmoothScroll } from "@/components/motion/smooth-scroll.client";

const { motionState, lenisInstances, tickerSpies } = vi.hoisted(() => ({
  motionState: { reduced: false, gsapFail: false, webdriver: false },
  lenisInstances: [] as Array<{
    options: Record<string, unknown>;
    on: ReturnType<typeof vi.fn>;
    raf: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  tickerSpies: {
    add: vi.fn(),
    remove: vi.fn(),
    lagSmoothing: vi.fn(),
  },
}));

vi.mock("@/lib/motion", () => ({
  prefersReducedMotion: () => motionState.reduced,
  loadGsap: async () => {
    if (motionState.gsapFail) throw new Error("blocked chunk");
    return {
      gsap: { ticker: tickerSpies },
      ScrollTrigger: { update: vi.fn() },
    };
  },
}));

vi.mock("lenis", () => {
  const Mock = vi.fn().mockImplementation(function (this: object, options: Record<string, unknown>) {
    lenisInstances.push({
      options,
      on: vi.fn(),
      raf: vi.fn(),
      destroy: vi.fn(),
    });
    return lenisInstances[lenisInstances.length - 1];
  });
  return { default: Mock };
});

function stubWebdriver(value: boolean) {
  Object.defineProperty(window.navigator, "webdriver", {
    value,
    configurable: true,
  });
}

describe("SmoothScroll", () => {
  afterEach(() => {
    motionState.reduced = false;
    motionState.gsapFail = false;
    motionState.webdriver = false;
    stubWebdriver(false);
    lenisInstances.length = 0;
    tickerSpies.add.mockClear();
    tickerSpies.remove.mockClear();
    tickerSpies.lagSmoothing.mockClear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.className = "";
  });

  it("renders nothing (native scroll stays untouched at rest)", () => {
    const { container } = render(<SmoothScroll />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays native for reduced-motion visitors", async () => {
    motionState.reduced = true;
    render(<SmoothScroll />);
    await act(async () => {});
    expect(lenisInstances).toHaveLength(0);
    expect(tickerSpies.add).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains("lenis-on")).toBe(false);
  });

  it("stays native under automation (navigator.webdriver)", async () => {
    stubWebdriver(true);
    render(<SmoothScroll />);
    await act(async () => {});
    expect(lenisInstances).toHaveLength(0);
    expect(document.documentElement.classList.contains("lenis-on")).toBe(false);
  });

  it("drives Lenis from the GSAP ticker on one clock", async () => {
    render(<SmoothScroll />);
    await act(async () => {});

    expect(lenisInstances).toHaveLength(1);
    const lenis = lenisInstances[0];
    expect(lenis.options).toMatchObject({ duration: 1.15, anchors: true });
    expect(document.documentElement.classList.contains("lenis-on")).toBe(true);

    // ScrollTrigger.update is wired as the scroll listener; the tick pumps
    // Lenis' raf from GSAP's ticker with the seconds→ms conversion.
    expect(lenis.on).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(tickerSpies.add).toHaveBeenCalledTimes(1);
    const tick = tickerSpies.add.mock.calls[0][0] as (time: number) => void;
    tick(2);
    expect(lenis.raf).toHaveBeenCalledWith(2000);
    expect(tickerSpies.lagSmoothing).toHaveBeenCalledWith(0);
  });

  it("restores native scroll and the html class on unmount", async () => {
    const { unmount } = render(<SmoothScroll />);
    await act(async () => {});
    const lenis = lenisInstances[0];
    unmount();
    expect(lenis.destroy).toHaveBeenCalledTimes(1);
    expect(tickerSpies.remove).toHaveBeenCalledWith(tickerSpies.add.mock.calls[0][0]);
    expect(document.documentElement.classList.contains("lenis-on")).toBe(false);
  });

  it("fails silent when GSAP cannot load — the page keeps native scroll", async () => {
    motionState.gsapFail = true;
    render(<SmoothScroll />);
    await act(async () => {});
    expect(lenisInstances).toHaveLength(0);
    expect(document.documentElement.classList.contains("lenis-on")).toBe(false);
  });
});
