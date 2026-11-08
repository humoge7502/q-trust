import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { PublicStatsClient, StatsTicker } from "@/components/stats-panel.client";
import { TESTS_AND_AUDITS } from "@/lib/public-stats";
import { CHAIN } from "@/lib/config";

const healthOk = { status: "ok", chain_id: CHAIN.id, relayer: "0xrelayer" };

function installReducedMotion(reduced: boolean) {
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

// The health check defers to idle time; jsdom has no idle callback, so the
// stub runs the check synchronously per mount and flushes with real timers.
function installIdleCallback() {
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
    cb();
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", vi.fn());
}

describe("PublicStatsClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installReducedMotion(true);
    installIdleCallback();
    sessionStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    // Unmount while the idle-callback stubs are still installed: the setup
    // file's afterEach runs later and would otherwise hit
    // window.cancelIdleCallback with the globals restored to jsdom's default.
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("renders the public stat band without waiting on the backend", () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => healthOk });
    render(<PublicStatsClient />);

    expect(screen.getByText("The system, in public")).toBeInTheDocument();
    expect(screen.getByText("Tests and audits")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    // Reduced motion keeps the server-rendered final value.
    expect(screen.getByText(String(TESTS_AND_AUDITS))).toBeInTheDocument();
    expect(screen.getByText(/Signals that make the protocol inspectable/)).toBeInTheDocument();
    expect(screen.getByText("Run a scan")).toHaveAttribute("href", "/scanner");
    expect(screen.getByText("Verify an asset")).toHaveAttribute("href", "/v");
  });

  it("shows API live once the health check succeeds", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => healthOk });
    render(<PublicStatsClient />);

    await waitFor(() => expect(screen.getByText("API live")).toBeInTheDocument());
    expect(
      screen.getByText(new RegExp(`Chain ID ${CHAIN.id} · API live`)),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/health$/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reports API unavailable when the health check fails", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<PublicStatsClient />);

    await waitFor(() => expect(screen.getByText("API unavailable")).toBeInTheDocument());
    expect(screen.getByText(/API offline/)).toBeInTheDocument();
  });

  it("caches the health payload per session and skips the refetch", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => healthOk });
    const first = render(<PublicStatsClient />);
    await waitFor(() => expect(screen.getByText("API live")).toBeInTheDocument());
    first.unmount();

    render(<PublicStatsClient />);
    expect(screen.getByText("API live")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("StatsTicker", () => {
  beforeEach(() => {
    installReducedMotion(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prints the chain identity and the hash-only promise", () => {
    render(<StatsTicker />);

    const ticker = screen.getByText(/Public verification layer · Hash-only on-chain/);
    expect(ticker.textContent).toContain(`${CHAIN.name} · ID ${CHAIN.id}`);
  });
});
