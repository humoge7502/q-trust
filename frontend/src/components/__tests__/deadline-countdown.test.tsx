import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { DeadlineCountdown } from "@/components/deadline-countdown";

describe("DeadlineCountdown", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the four canonical regulatory milestones", () => {
    render(<DeadlineCountdown />);
    expect(screen.getByText("CNSA 2.0 acquisitions")).toBeInTheDocument();
    expect(screen.getByText("Deprecation begins")).toBeInTheDocument();
    expect(screen.getByText("NSS classical cutoff")).toBeInTheDocument();
    expect(screen.getByText("Disallowed")).toBeInTheDocument();
  });

  it("labels the draft status of IR 8547 (no false certainty)", () => {
    render(<DeadlineCountdown />);
    expect(screen.getByText(/initial public draft/i)).toBeInTheDocument();
  });

  it("computes live day counters after mount, nearest deadline first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
    render(<DeadlineCountdown />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // 2026-10-23T12:00Z → 2027-01-01 is 69d12h ⇒ ceil 70 days;
    // → 2030-01-01 is 1165d12h ⇒ ceil 1,166.
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("1,166")).toBeInTheDocument();
    expect(
      screen.getByText(/70 days until the first binding date/i),
    ).toBeInTheDocument();
  });
});
