import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SpotlightCard } from "@/components/ui/spotlight-card";

describe("SpotlightCard", () => {
  it("renders its children inside the spotlight surface", () => {
    render(
      <SpotlightCard>
        <p>Card content</p>
      </SpotlightCard>,
    );

    expect(screen.getByText("Card content")).toBeInTheDocument();
    expect(screen.getByText("Card content").parentElement).toHaveClass(
      "spotlight-card",
      "relative",
    );
  });

  it("publishes the configured radius as a custom property", () => {
    const { container } = render(<SpotlightCard radius={160}>x</SpotlightCard>);
    const card = container.querySelector(".spotlight-card") as HTMLElement;
    expect(card.style.getPropertyValue("--spot-radius")).toBe("160px");
  });

  it("defaults the radius to 320px", () => {
    const { container } = render(<SpotlightCard>x</SpotlightCard>);
    const card = container.querySelector(".spotlight-card") as HTMLElement;
    expect(card.style.getPropertyValue("--spot-radius")).toBe("320px");
  });

  it("tracks the pointer through CSS variables without React state", () => {
    const { container } = render(<SpotlightCard>x</SpotlightCard>);
    const card = container.querySelector(".spotlight-card") as HTMLElement;

    // jsdom rects are zero-origin, so the spotlight lands at the raw point.
    fireEvent.pointerMove(card, { clientX: 30, clientY: 10 });
    expect(card.style.getPropertyValue("--spot-x")).toBe("30px");
    expect(card.style.getPropertyValue("--spot-y")).toBe("10px");
  });

  it("clears the spotlight on pointer leave", () => {
    const { container } = render(<SpotlightCard>x</SpotlightCard>);
    const card = container.querySelector(".spotlight-card") as HTMLElement;

    fireEvent.pointerMove(card, { clientX: 30, clientY: 10 });
    fireEvent.pointerLeave(card);
    expect(card.style.getPropertyValue("--spot-x")).toBe("");
    expect(card.style.getPropertyValue("--spot-y")).toBe("");
  });

  it("keeps the light layers decorative and out of the a11y tree", () => {
    const { container } = render(<SpotlightCard>x</SpotlightCard>);

    for (const layer of container.querySelectorAll(".spotlight-glow, .spotlight-ring")) {
      expect(layer).toHaveAttribute("aria-hidden", "true");
      expect(layer).toHaveClass("pointer-events-none");
    }
  });

  it("merges className and spreads extra div props", () => {
    render(
      <SpotlightCard className="extra" data-testid="hero-card" id="hero">
        x
      </SpotlightCard>,
    );
    const card = screen.getByTestId("hero-card");
    expect(card).toHaveClass("spotlight-card", "extra");
    expect(card).toHaveAttribute("id", "hero");
  });
});
