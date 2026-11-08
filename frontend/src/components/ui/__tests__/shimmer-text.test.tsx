import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ShimmerText } from "@/components/ui/shimmer-text";

describe("ShimmerText", () => {
  it("renders its text inside a single shimmer span", () => {
    render(<ShimmerText>Post-quantum, provable</ShimmerText>);

    const span = screen.getByText("Post-quantum, provable");
    expect(span).toBeInTheDocument();
    expect(span).toHaveClass("shimmer-text");
    expect(span.tagName).toBe("SPAN");
    expect(span.children).toHaveLength(0);
  });

  it("merges surface-specific ink overrides", () => {
    render(
      <ShimmerText className="[--shimmer-base:var(--color-qtrust-700)]">
        Light surface
      </ShimmerText>,
    );

    expect(screen.getByText("Light surface")).toHaveClass(
      "shimmer-text",
      "[--shimmer-base:var(--color-qtrust-700)]",
    );
  });

  it("keeps default inks when no className is passed", () => {
    render(<ShimmerText>Night surface</ShimmerText>);
    expect(screen.getByText("Night surface").className).toBe("shimmer-text");
  });
});
