import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SiteHeader } from "@/components/site-header.client";

const { navState } = vi.hoisted(() => ({
  navState: { pathname: "/scanner" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const destinations = [
  { label: "Protocol", href: "/#workflow" },
  { label: "Scanner", href: "/scanner" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Vendors", href: "/vendors" },
  { label: "Verify", href: "/v" },
  { label: "Evidence", href: "/evidence" },
  { label: "Research", href: "/research" },
  { label: "Demo", href: "/demo" },
  { label: "Pricing", href: "/pricing" },
];

describe("SiteHeader", () => {
  afterEach(() => {
    navState.pathname = "/scanner";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the brand and every primary destination", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: /Q-Trust/ })).toHaveAttribute("href", "/");
    for (const { label, href } of destinations) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
    }
    // The docs link is external and points at the API origin's docs route.
    const docs = screen.getByRole("link", { name: /API docs/ });
    expect(docs.getAttribute("href")).toContain("/docs");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", "noreferrer");
  });

  it("marks the current route and leaves section links alone", () => {
    navState.pathname = "/scanner";
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Scanner" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // "/#workflow" has match: null — it never claims to be the current page.
    expect(screen.getByRole("link", { name: "Protocol" })).not.toHaveAttribute("aria-current");
  });

  it("matches nested routes as part of the section", () => {
    navState.pathname = "/v/0xabc";
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Verify" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Scanner" })).not.toHaveAttribute("aria-current");
  });

  it("opens the mobile navigation sheet and closes it again", () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    // Radix derives the accessible name from Dialog.Title, which overrides the
    // Dialog.Content aria-label — so the sheet is "Navigation menu".
    const sheet = screen.getByRole("dialog", { name: "Navigation menu" });
    expect(sheet).toHaveAttribute("aria-label", "Mobile navigation");

    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("links the launch affordance to the dashboard", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /Launch app/ })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
