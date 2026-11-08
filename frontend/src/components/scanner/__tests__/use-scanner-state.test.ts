import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { OperatorKeyRequiredError } from "@/lib/api";
import { useScannerState } from "../use-scanner-state";

/**
 * F-13 coverage: the scanner state hook owns one `useApiOperation` per proxy
 * call. These tests pin the merged read-outs the panels consume — result
 * shaping, the error vs operator-prompt split, and the shared result channel
 * between the path scan and the repo scan.
 */

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const SCAN_BODY = {
  target: "/workspace/projects/deploy/demo-estate",
  scanType: "full",
  timestamp: "2026-08-25T00:00:00Z",
  findings: [
    {
      file: "/workspace/projects/deploy/demo-estate/services/gateway/tls.py",
      algorithm: "RSA-2048",
      line: 10,
      severity: "HIGH",
      message: "RSA key material in use",
    },
  ],
};

describe("useScannerState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shapes a successful scan into a ScanResult with a client-side summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, SCAN_BODY));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useScannerState());

    await act(async () => {
      await result.current.runScan();
    });

    expect(result.current.scanLoading).toBe(false);
    expect(result.current.scanError).toBe("");
    expect(result.current.scanResult?.origin).toBe("path");
    expect(result.current.scanResult?.summary).toEqual({
      totalFindings: 1,
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0,
      algorithmsDetected: ["RSA-2048"],
    });
    // normalizeFinding lowercases severity and keeps the API fields.
    expect(result.current.scanResult?.findings[0].severity).toBe("high");
    expect(result.current.scanResult?.findings[0].algorithm).toBe("RSA-2048");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      target: "/workspace/projects/deploy/demo-estate",
      includeSource: true,
      includeManifests: true,
    });
  });

  it("surfaces a scan failure as error text, not the operator prompt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("proxy exploded")));
    const { result } = renderHook(() => useScannerState());

    await act(async () => {
      await result.current.runScan();
    });

    expect(result.current.scanError).toBe("proxy exploded");
    expect(result.current.operatorEndpoint).toBeNull();
    expect(result.current.scanResult).toBeNull();
    expect(result.current.scanLoading).toBe(false);
  });

  it("routes OperatorKeyRequiredError to the operator prompt instead of the error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new OperatorKeyRequiredError("/v1/scan/full")),
    );
    const { result } = renderHook(() => useScannerState());

    await act(async () => {
      await result.current.runScan();
    });

    expect(result.current.operatorEndpoint).toBe("/v1/scan/full");
    expect(result.current.scanError).toBe("");
  });

  it("the repo scan replaces the path-scan result and reports on its own channel", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, SCAN_BODY))
      .mockRejectedValueOnce(new Error("archive too large"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useScannerState());

    await act(async () => {
      await result.current.runScan();
    });
    expect(result.current.scanResult?.origin).toBe("path");

    // Separate acts: the run closure must observe the re-rendered repo input.
    await act(async () => {
      result.current.setRepoInput("owner/repo");
    });
    await act(async () => {
      await result.current.runRepoScan();
    });

    expect(result.current.repoError).toBe("archive too large");
    expect(result.current.scanError).toBe("");
    // Starting the repo scan cleared the path-scan result, and the failed repo
    // scan did not populate a new one.
    expect(result.current.scanResult).toBeNull();
    expect(result.current.repoLoading).toBe(false);
  });

  it("derives risk scores and the compliance percentage from the scan result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, SCAN_BODY))
      .mockResolvedValueOnce(
        mockResponse(200, {
          findings: [
            {
              ...SCAN_BODY.findings[0],
              algorithmClassification: "BROKEN",
              riskScore: 87.4,
              riskLevel: "HIGH",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse(200, {
          framework: "NIST_PQC",
          results: [],
          compliant: 3,
          nonCompliant: 1,
          total: 4,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useScannerState());

    await act(async () => {
      await result.current.runScan();
    });
    await act(async () => {
      await result.current.fetchRiskScores();
    });
    await act(async () => {
      await result.current.fetchCompliance();
    });

    expect(result.current.riskScores).toHaveLength(1);
    expect(result.current.riskScores[0].riskLevel).toBe("HIGH");
    expect(result.current.riskError).toBe("");
    expect(result.current.complianceReport?.scorePercent).toBe(75);
    expect(result.current.complianceError).toBe("");
    // The downstream calls received the normalized findings from the scan.
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).findings).toHaveLength(1);
  });

  it("guards the dependent calls when no scan result exists yet", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useScannerState());

    await act(async () => {
      await result.current.fetchRiskScores();
      await result.current.fetchCompliance();
      await result.current.fetchRoadmap();
      await result.current.createEvidence();
      await result.current.verifyLedger();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.riskScores).toEqual([]);
    expect(result.current.complianceReport).toBeNull();
    expect(result.current.roadmap).toBeNull();
    expect(result.current.evidenceLedger).toBeNull();
    expect(result.current.evidenceError).toBe("");
  });

  it("creates and verifies an evidence record for the current scan", async () => {
    const LEDGER = {
      version: "1",
      data: {
        scanResultHash: "dead",
        scanTarget: "/workspace/projects/deploy/demo-estate",
        findingsCount: 1,
        riskSummary: {
          totalFindings: 1,
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
          info: 0,
          algorithmsDetected: ["RSA-2048"],
        },
        timestamp: "2026-08-25T00:00:00Z",
      },
      integrityHash: "cafe",
      previousHash: "0000",
      chainIndex: 7,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(200, SCAN_BODY))
      .mockResolvedValueOnce(mockResponse(200, { ledger: LEDGER }))
      .mockResolvedValueOnce(
        mockResponse(200, { valid: true, expectedHash: "cafe", providedHash: "cafe" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    // jsdom does not ship WebCrypto; pin the digest the evidence hash needs.
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array([0xde, 0xad]).buffer),
      },
    });
    const { result } = renderHook(() => useScannerState());

    await act(async () => {
      await result.current.runScan();
    });
    await act(async () => {
      await result.current.createEvidence();
    });
    expect(result.current.evidenceLedger?.integrityHash).toBe("cafe");
    expect(result.current.evidenceLoading).toBe(false);
    expect(result.current.evidenceError).toBe("");

    await act(async () => {
      await result.current.verifyLedger();
    });
    expect(result.current.evidenceVerify?.valid).toBe(true);
    expect(result.current.verifyLoading).toBe(false);
    expect(result.current.evidenceError).toBe("");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      scanTarget: "/workspace/projects/deploy/demo-estate",
      findingsCount: 1,
    });
  });
});
