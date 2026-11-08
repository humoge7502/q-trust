import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiError, fetchAssetVerification } from "@/lib/api";

/**
 * Regression coverage for badge-state classification (app/api/badge/[id]).
 *
 * The badge handler used to classify any failure whose message contained
 * "404" as NOT_FOUND. `ApiError.message` embeds the upstream detail verbatim
 * (`API 500: upstream returned 404 …`), so a genuine backend 500 that quoted
 * a "404" anywhere in its detail rendered a green-lie NOT FOUND badge instead
 * of the honest UNREACHABLE one. Classification must branch on
 * `ApiError.status` first and keep message matching only for status-less
 * errors (plain transport failures).
 */

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchAssetVerification: vi.fn() };
});

import { GET } from "@/app/api/badge/[id]/route";

const ASSET_ID = `0x${"ab".repeat(32)}`;

async function badgeText(): Promise<string> {
  const response = await GET(new Request("https://q-trust.test/api/badge/x"), {
    params: Promise.resolve({ id: ASSET_ID }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
  return response.text();
}

describe("badge route error classification", () => {
  beforeEach(() => {
    vi.mocked(fetchAssetVerification).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders NOT FOUND for a typed 404", async () => {
    vi.mocked(fetchAssetVerification).mockRejectedValue(new ApiError(404, "asset missing"));
    const svg = await badgeText();
    expect(svg).toContain("NOT FOUND");
    expect(svg).not.toContain("UNREACHABLE");
  });

  it("renders UNREACHABLE for a 500 whose message mentions 404", async () => {
    // The regression: the message contains "404" but the status is 500.
    vi.mocked(fetchAssetVerification).mockRejectedValue(
      new ApiError(500, "upstream reported 404 elsewhere"),
    );
    const svg = await badgeText();
    expect(svg).toContain("UNREACHABLE");
    expect(svg).not.toContain("NOT FOUND");
  });

  it("keeps message matching as the fallback for status-less errors", async () => {
    vi.mocked(fetchAssetVerification).mockRejectedValue(new Error("gateway responded 404"));
    const svg = await badgeText();
    expect(svg).toContain("NOT FOUND");
  });

  it("renders UNREACHABLE for a status-less failure without 404 in the message", async () => {
    vi.mocked(fetchAssetVerification).mockRejectedValue(new Error("upstream timed out"));
    const svg = await badgeText();
    expect(svg).toContain("UNREACHABLE");
  });
});
