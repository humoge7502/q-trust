import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { GateLoading, WalletGate, useMounted } from "@/components/wallet-gate";

vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () => <button type="button">Connect RainbowKit wallet</button>,
}));

function MountedProbe() {
  return <p>mounted:{String(useMounted())}</p>;
}

describe("WalletGate", () => {
  it("renders the load-bearing h1 and the page description", () => {
    render(
      <WalletGate description="Sign in with your wallet to open the migration dashboard." />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Connect your wallet" })).toBeInTheDocument();
    expect(
      screen.getByText("Sign in with your wallet to open the migration dashboard."),
    ).toBeInTheDocument();
  });

  it("offers the wallet connect control", () => {
    render(<WalletGate description="Connect to continue." />);
    expect(
      screen.getByRole("button", { name: "Connect RainbowKit wallet" }),
    ).toBeInTheDocument();
  });

  it("describes each gated surface through its own copy", () => {
    render(<WalletGate description="Scan gate copy." />);
    expect(screen.getByText("Scan gate copy.")).toBeInTheDocument();
  });
});

describe("GateLoading", () => {
  it("announces itself as a polite status region", () => {
    render(<GateLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.textContent).toContain("Checking wallet…");
  });
});

describe("useMounted", () => {
  it("is true once rendered on the client", () => {
    render(<MountedProbe />);
    expect(screen.getByText("mounted:true")).toBeInTheDocument();
  });
});
