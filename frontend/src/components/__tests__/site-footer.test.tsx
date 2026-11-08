import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { SiteFooter } from "@/components/site-footer";
import { CHAIN } from "@/lib/config";

describe("SiteFooter", () => {
  it("renders the three link columns under accessible names", () => {
    render(<SiteFooter />);

    const product = screen.getByRole("navigation", { name: "Product" });
    expect(within(product).getByRole("link", { name: "Scanner" })).toHaveAttribute(
      "href",
      "/scanner",
    );
    expect(within(product).getByRole("link", { name: "Verify" })).toHaveAttribute("href", "/v");

    const resources = screen.getByRole("navigation", { name: "Resources" });
    expect(within(resources).getByRole("link", { name: "GitHub" })).toBeInTheDocument();
    expect(within(resources).getByRole("link", { name: "Evaluation integrity" })).toHaveAttribute(
      "href",
      "/research",
    );

    const protocol = screen.getByRole("navigation", { name: "Protocol" });
    expect(within(protocol).getByRole("link", { name: "Why Q-Trust" })).toHaveAttribute(
      "href",
      "/#why",
    );
    expect(within(protocol).getByRole("link", { name: "The operating loop" })).toHaveAttribute(
      "href",
      "/#workflow",
    );
  });

  it("opens external resources in a new tab and keeps internal ones in-app", () => {
    render(<SiteFooter />);

    for (const label of ["API reference", "Documentation", "GitHub", "Block explorer"]) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    for (const label of ["Scanner", "Dashboard", "Pricing", "Evaluation integrity"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("target");
    }
  });

  it("states the tagline and the hash-only on-chain promise", () => {
    render(<SiteFooter />);

    expect(
      screen.getByText(new RegExp(`Post-quantum migration assurance on ${CHAIN.name}\\.`)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Hash-only on-chain · evidence stays private/),
    ).toBeInTheDocument();
  });

  it("carries the license line and the chain identity bar", () => {
    const { container } = render(<SiteFooter />);

    const license = screen.getByText(/Q-Trust contributors · MIT licensed/);
    expect(license.textContent).toContain("©");
    expect(container.textContent).toContain(`${CHAIN.name} · chain id ${CHAIN.id}`);
  });

  it("links the brand mark back to the landing page", () => {
    render(<SiteFooter />);
    expect(screen.getAllByRole("link", { name: /Q-Trust/ })[0]).toHaveAttribute("href", "/");
  });
});
