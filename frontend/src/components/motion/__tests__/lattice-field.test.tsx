import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { LatticeField } from "@/components/motion/lattice-field.client";

function installMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

describe("LatticeField", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders an aria-hidden canvas that never affects layout", () => {
    installMatchMedia(true);
    const { container } = render(<LatticeField className="hero-canvas" />);

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveClass("hero-canvas");
  });

  it("is not mounted for reduced-motion visitors (CSS hero stands alone)", () => {
    installMatchMedia(true);
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

    const { container } = render(<LatticeField />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
    expect(getContextSpy).not.toHaveBeenCalled();
  });

  it("fails silent without a WebGL context — the CSS treatment remains", () => {
    installMatchMedia(false);
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);

    const { container } = render(<LatticeField />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
    // No shader work happened, so no draw calls can leak.
    expect(
      vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results.filter(
        (result) => result.type === "return",
      ).length,
    ).toBe(1);
  });

  it("unmounts cleanly before the render loop starts", () => {
    installMatchMedia(false);
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);

    const { container, unmount } = render(<LatticeField />);
    expect(() => unmount()).not.toThrow();
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
  });
});
