/**
 * The planner panel is the demo's money path: a visitor must be able to go
 * from landing on /scanner to a rendered, ranked plan without editing JSON.
 * These tests pin the shipped flow — prefilled sample, one click, four rows —
 * and the two failure surfaces (bad JSON, planner down).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanningPanel } from "@/components/planning-panel";

const PLAN_RESPONSE = {
  planner_mode: "embedded-onnx",
  migration_order: [
    { rank: 1, asset_id: "asset-0002", algorithm: "ECC-P256", criticality: "High", pqc_ready: false, risk_score: 72, migrate_days: 1.5 },
    { rank: 2, asset_id: "asset-0001", algorithm: "RSA-2048", criticality: "Critical", pqc_ready: false, risk_score: 84, migrate_days: 1.5 },
    { rank: 3, asset_id: "asset-0003", algorithm: "AES-256", criticality: "Medium", pqc_ready: true, risk_score: 10, migrate_days: 0 },
    { rank: 4, asset_id: "asset-0004", algorithm: "SHA-256", criticality: "Low", pqc_ready: true, risk_score: 5, migrate_days: 0.5 },
  ],
  schedule: {
    feasible: true,
    days_available: 337,
    total_effort_days: 3.5,
    suggested_daily_rate: 1,
    windows: [
      { asset_id: "asset-0002", start: "2026-10-29", end: "2026-10-30" },
      { asset_id: "asset-0001", start: "2026-10-31", end: "2026-11-01" },
      { asset_id: "asset-0003", start: "2026-11-02", end: "2026-11-02" },
      { asset_id: "asset-0004", start: "2026-11-03", end: "2026-11-03" },
    ],
  },
  total_assets: 4,
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    clone() {
      return this;
    },
  });
}

describe("PlanningPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("ships a prefilled CBOM so one click renders the ranked plan", async () => {
    const fetchMock = mockFetch(200, PLAN_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    render(<PlanningPanel />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(JSON.parse(textarea.value).assets).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));

    await waitFor(() => expect(screen.getByTestId("plan-result")).toBeInTheDocument());
    expect(screen.getAllByTestId("plan-row")).toHaveLength(4);
    expect(screen.getByTestId("plan-result").getAttribute("data-planner-mode")).toBe("embedded-onnx");
    expect(screen.getAllByText("RSA-2048").length).toBeGreaterThan(0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/plans");
    expect(JSON.parse(init.body).cbom.assets).toHaveLength(4);
  });

  it("rejects invalid JSON without a network call", async () => {
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal("fetch", fetchMock);

    render(<PlanningPanel />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));

    await waitFor(() =>
      expect(screen.getByTestId("plan-error").textContent).toContain("not valid JSON"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows retry-safe copy when the planner is down", async () => {
    vi.stubGlobal("fetch", mockFetch(503, { error: "planner_unavailable" }));

    render(<PlanningPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));

    await waitFor(() =>
      expect(screen.getByTestId("plan-error").textContent).toContain(
        "The planner is temporarily unavailable",
      ),
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
