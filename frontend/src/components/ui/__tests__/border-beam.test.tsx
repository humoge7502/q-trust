import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { BorderBeam } from "@/components/ui/border-beam";

describe("BorderBeam", () => {
  it("renders a decorative, non-interactive orbit layer", () => {
    const { container } = render(<BorderBeam />);
    const beam = container.querySelector(".border-beam") as HTMLElement;

    expect(beam).toHaveAttribute("aria-hidden", "true");
    expect(beam).toHaveClass("pointer-events-none");
    expect(container.querySelector(".border-beam-orbit")).toBeInTheDocument();
  });

  it("maps the streak length onto a clamped arc angle", () => {
    const { container } = render(<BorderBeam />);
    expect(
      (container.querySelector(".border-beam") as HTMLElement).style.getPropertyValue(
        "--beam-arc",
      ),
    ).toBe("27deg"); // 120px on the 1600px reference perimeter

    const clampedDown = render(<BorderBeam size={10} />);
    expect(
      (clampedDown.container.querySelector(".border-beam") as HTMLElement).style.getPropertyValue(
        "--beam-arc",
      ),
    ).toBe("10deg");

    const clampedUp = render(<BorderBeam size={1000} />);
    expect(
      (clampedUp.container.querySelector(".border-beam") as HTMLElement).style.getPropertyValue(
        "--beam-arc",
      ),
    ).toBe("120deg");
  });

  it("offsets the phase through animation-delay on the orbit", () => {
    const { container } = render(<BorderBeam delay={2.5} />);
    const orbit = container.querySelector(".border-beam-orbit") as HTMLElement;
    expect(orbit.style.animationDelay).toBe("2.5s");
  });

  it("leaves the default phase untouched", () => {
    const { container } = render(<BorderBeam />);
    const orbit = container.querySelector(".border-beam-orbit") as HTMLElement;
    expect(orbit.style.animationDelay).toBe("");
  });

  it("merges an extra className", () => {
    const { container } = render(<BorderBeam className="extra" />);
    expect(container.querySelector(".border-beam")).toHaveClass("border-beam", "extra");
  });
});
