import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { VerifyBox } from "@/components/verify-box.client";
import { EXAMPLE_ASSET_ID } from "@/hooks/use-verify-asset";

const { navState } = vi.hoisted(() => ({
  navState: { push: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navState.push }),
}));

describe("VerifyBox", () => {
  afterEach(() => {
    navState.push.mockClear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the verify surface with its live badge and help copy", () => {
    render(<VerifyBox />);

    expect(screen.getByText("Verify an attestation")).toBeInTheDocument();
    expect(screen.getByText("Public, wallet-free, checked on-chain.")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText(/Paste a full asset ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Asset ID/)).toHaveAttribute("name", "assetId");
  });

  it("rejects an invalid asset ID with an accessible error", async () => {
    render(<VerifyBox />);

    const input = screen.getByLabelText(/Asset ID/);
    fireEvent.change(input, { target: { value: "not-an-asset-id" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/0x-prefixed 64-char hex/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "verify-error verify-help");
  });

  it("navigates to the asset page for a valid ID and shows the pending state", async () => {
    render(<VerifyBox />);

    const input = screen.getByLabelText(/Asset ID/);
    fireEvent.change(input, { target: { value: EXAMPLE_ASSET_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() =>
      expect(navState.push).toHaveBeenCalledWith(`/v/${EXAMPLE_ASSET_ID}`),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
  });

  it("clears the error as soon as the input changes", async () => {
    render(<VerifyBox />);

    const input = screen.getByLabelText(/Asset ID/);
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByRole("alert");

    fireEvent.change(input, { target: { value: EXAMPLE_ASSET_ID } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("fills the input from the use-the-example shortcut", () => {
    render(<VerifyBox />);

    const shortcut = screen.getByRole("button", { name: "use the example" });
    expect(shortcut).toBeInTheDocument();
    fireEvent.click(shortcut);

    const input = screen.getByLabelText(/Asset ID/) as HTMLInputElement;
    expect(input.value).toBe(EXAMPLE_ASSET_ID);
  });

  it("prints the independent verification command", () => {
    render(<VerifyBox />);

    const region = screen.getByRole("region", { name: "Independent verification command" });
    expect(region.textContent).toContain("qtrust verify");
    expect(screen.getByRole("link", { name: /Learn about asset IDs/ })).toHaveAttribute("href", "/v");
  });
});
