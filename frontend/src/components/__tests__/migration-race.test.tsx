import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MigrationRace } from "@/components/migration-race";
import { MIGRATION_RACE, qrdAtDay } from "@/data/migration-race";

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

function installIntersection(visible: boolean) {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe = () =>
        this.cb(
          [
            {
              isIntersecting: visible,
              target: document.createElement("div"),
            },
          ] as unknown as IntersectionObserverEntry[],
          this as unknown as IntersectionObserver,
        );
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = () => [];
    },
  );
}

const raf = (cb: FrameRequestCallback) => {
  // Drive every scheduled frame immediately at the final timestamp so
  // animations complete synchronously in tests.
  cb(1e9);
  return 0;
};

describe("MigrationRace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders both strategy lanes and the estate context", () => {
    installReducedMotion(true);
    installIntersection(false);
    render(<MigrationRace />);
    expect(screen.getByText("Priority list")).toBeInTheDocument();
    expect(screen.getByText("Outcome-aware")).toBeInTheDocument();
    expect(
      screen.getAllByText(/real_gov_edu_2/).length,
      "asset key names the real estate",
    ).toBeGreaterThan(0);
  });

  it("shows the final exposure numbers under reduced motion (no animation)", async () => {
    installReducedMotion(true);
    installIntersection(false);
    render(<MigrationRace />);
    // The reduced-motion jump is deferred one macrotask (hydration-safe).
    await waitFor(() => expect(screen.getByText("1,753")).toBeInTheDocument());
    // Final counters equal the simulator's totals.
    expect(screen.getByText("1,753")).toBeInTheDocument();
    expect(screen.getByText("1,523")).toBeInTheDocument();
    // The outcome copy appears once the race stands finished.
    expect(
      screen.getByText(/fewer quantum-risk-days/),
    ).toBeInTheDocument();
  });

  it("completes the race when animation frames run", () => {
    installReducedMotion(false);
    installIntersection(true);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<MigrationRace />);
    expect(screen.getAllByText(/15\.1% less exposure/).length).toBeGreaterThan(0);
  });

  it("supports replay after finishing", async () => {
    installReducedMotion(true);
    installIntersection(false);
    render(<MigrationRace />);
    const replay = await screen.findByRole("button", { name: "Replay the race" });
    expect(replay).toBeInTheDocument();
    fireEvent.click(replay); // reduced motion: replay re-renders final state
    expect(screen.getByText("1,753")).toBeInTheDocument();
  });

  it("exposes a text alternative for the whole figure", () => {
    installReducedMotion(true);
    installIntersection(false);
    render(<MigrationRace />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("real_gov_edu_2");
    expect(img.getAttribute("aria-label")).toContain("1,753");
    expect(img.getAttribute("aria-label")).toContain("1,523");
  });
});

describe("qrdAtDay (data module)", () => {
  const { estate, strategies } = MIGRATION_RACE;

  it("returns zero before the race starts and the exact total at the end", () => {
    const end = strategies.priorityList.makespanDays;
    expect(qrdAtDay(strategies.priorityList, estate.assets, 0)).toBe(0);
    expect(qrdAtDay(strategies.priorityList, estate.assets, end)).toBeCloseTo(
      strategies.priorityList.totalQrd,
      5,
    );
    expect(qrdAtDay(strategies.outcomeAware, estate.assets, end)).toBeCloseTo(
      strategies.outcomeAware.totalQrd,
      5,
    );
  });

  it("is monotone non-decreasing in time for both strategies", () => {
    for (const s of [strategies.priorityList, strategies.outcomeAware]) {
      let prev = -1;
      for (let t = 0; t <= s.makespanDays; t += s.makespanDays / 50) {
        const v = qrdAtDay(s, estate.assets, t);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it("accrues exposure on every not-yet-migrated asset (hand-checked midpoint)", () => {
    // Day 32 = completion of asset 0 under the priority list. Exposure so far
    // = Σ w_i · min(32, C_i): asset0 (w=1, C=32) → 32; five RSA assets
    // (w=2, C>32) → 64 each; asset 3 (w=2, C=220.5) → 64. Total 416.
    expect(qrdAtDay(strategies.priorityList, estate.assets, 32)).toBeCloseTo(
      416,
      5,
    );
  });
});
