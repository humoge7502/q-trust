"use client";

/**
 * Scanner dashboard state.
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): every
 * piece of scan / risk / compliance / roadmap / evidence / export / tab state,
 * plus the API calls that populate it. The dashboard shell calls this hook
 * once and passes the result down to the per-tab panels, so the state stays
 * shared across tabs exactly as before.
 *
 * F-13: each proxy call (scan, repo scan, risk, compliance, roadmap, evidence
 * create / verify) now owns its loading / error / operator-key prompt through
 * `useApiOperation` instead of a hand-rolled loading-error-operator cycle per
 * call. The consumed return shape is unchanged — the panels still read the
 * same flat fields — with the per-operation states merged into those read-outs.
 */
import { useState } from "react";
import { apiPostJson, scanRepository } from "@/lib/api";
import { useApiOperation } from "@/hooks/use-api-operation";
import {
  buildCbom,
  buildSarif,
  COMPLIANCE_FRAMEWORKS,
  DEMO_ESTATE,
  downloadBlob,
  normalizeFinding,
  safeName,
  sha256Hex,
  summarizeFindings,
  type ComplianceReport,
  type EvidenceLedger,
  type EvidenceVerifyResult,
  type Roadmap,
  type RoadmapPhase,
  type RoadmapSummary,
  type ScanFinding,
  type ScanResult,
  type ScoredFinding,
  type TabId,
} from "./shared";

export function useScannerState() {
  /* ---- Scan state ---- */
  // Pre-filled with a mounted demo target so the first click produces a real
  // scan; visitors can pick another sample or type any allowed path.
  const [target, setTarget] = useState(DEMO_ESTATE);
  const [scanSource, setScanSource] = useState(true);
  const [scanManifest, setScanManifest] = useState(true);

  /*
   * One operation per proxy call (F-13): the hook owns loading, the error text
   * and the operator-key prompt for that call. The path scan and the repo scan
   * both populate the single displayed result, so each clears the other's data
   * before running — previously one shared `scanResult` was nulled at the
   * start of either run.
   */
  const pathScanOp = useApiOperation<ScanResult>();
  const repoScanOp = useApiOperation<ScanResult>();

  /* ---- Public-repository scan state ---- */
  const [repoInput, setRepoInput] = useState("");

  /* ---- Risk state ---- */
  const riskOp = useApiOperation<ScoredFinding[]>();

  /* ---- Compliance state ---- */
  const [complianceFramework, setComplianceFramework] = useState<string>(COMPLIANCE_FRAMEWORKS[0].value);
  const complianceOp = useApiOperation<ComplianceReport>();

  /* ---- Roadmap state ---- */
  const [roadmapDailyRate, setRoadmapDailyRate] = useState("");
  const roadmapOp = useApiOperation<Roadmap>();

  /* ---- Evidence state ---- */
  const evidenceCreateOp = useApiOperation<EvidenceLedger>();
  const evidenceVerifyOp = useApiOperation<EvidenceVerifyResult>();

  /* ---- Export state ---- */
  const [exportLoading, setExportLoading] = useState<string | null>(null);
  // Exports are client-side blob downloads, not proxy calls, so they keep
  // their own plain flag; a (rare) failure still surfaces on the scan tab's
  // error line via the merged `scanError` below, as it did before.
  const [exportError, setExportError] = useState("");

  /*
   * Active surface. Held in React rather than left to Radix's uncontrolled
   * default because the rail's contextual strip and the per-tab result badges
   * both read from it — one source of truth for "where am I and what exists
   * here".
   */
  const [tab, setTab] = useState<TabId>("scan");

  /* ---- Derived read-outs (the shape the panels consume) ---- */

  const scanResult = pathScanOp.data ?? repoScanOp.data;
  const evidenceLedger = evidenceCreateOp.data;

  /*
   * Operator access fallback: `/v1/scan/*`, `/v1/roadmap/generate` and
   * `/v1/evidence/create` are public-compute via the same-origin proxy (the
   * server key is attached), so they work for anonymous visitors. If the proxy
   * ever refuses one — e.g. a deployment configured without a server key in
   * production — the operation surfaces an operator prompt instead of a bare
   * error. The prompt is per operation now; this merged read keeps the single
   * field the panels compare against.
   */
  const operatorEndpoint =
    pathScanOp.operatorEndpoint ??
    repoScanOp.operatorEndpoint ??
    riskOp.operatorEndpoint ??
    complianceOp.operatorEndpoint ??
    roadmapOp.operatorEndpoint ??
    evidenceCreateOp.operatorEndpoint ??
    evidenceVerifyOp.operatorEndpoint;

  /* ---- API calls ---- */

  async function runScan() {
    if (!target.trim()) return;
    repoScanOp.setData(null);
    setExportError("");
    await pathScanOp.run(async () => {
      const data = await apiPostJson<{
        target: string;
        scanType: string;
        timestamp: string;
        findings: ScanFinding[];
      }>("/v1/scan/full", {
        target: target.trim(),
        includeSource: scanSource,
        includeManifests: scanManifest,
      });
      const findings = data.findings.map((finding) => normalizeFinding(finding, target.trim()));
      return {
        ...data,
        findings,
        summary: summarizeFindings(findings),
        origin: "path",
      } satisfies ScanResult;
    });
  }

  /** Scan a public GitHub repository without a local checkout. */
  async function runRepoScan() {
    if (!repoInput.trim()) return;
    pathScanOp.setData(null);
    await repoScanOp.run(async () => {
      const data = await scanRepository<ScanFinding>({
        repo: repoInput.trim(),
        scanType: "full",
      });
      const label = data.repo;
      const findings = data.findings.map((finding) => normalizeFinding(finding, label));
      return {
        target: label,
        scanType: data.scanType,
        timestamp: data.timestamp,
        findings,
        summary: summarizeFindings(findings),
        origin: "repo",
        filesScanned: data.filesScanned,
      } satisfies ScanResult;
    });
  }

  async function fetchRiskScores() {
    if (!scanResult) return;
    await riskOp.run(async () => {
      const data = await apiPostJson<{ findings: ScoredFinding[] }>("/v1/risk/score", {
        findings: scanResult.findings,
      });
      return Array.isArray(data.findings) ? data.findings : [];
    });
  }

  async function fetchCompliance() {
    if (!scanResult) return;
    await complianceOp.run(async () => {
      const data = await apiPostJson<{
        framework: string;
        results: ComplianceReport["results"];
        compliant: number;
        nonCompliant: number;
        total: number;
      }>("/v1/compliance/evaluate", {
        findings: scanResult.findings,
        framework: complianceFramework,
      });
      return {
        ...data,
        // The evaluate endpoint returns counts only; percentage derived here.
        scorePercent: data.total > 0 ? Math.round((data.compliant / data.total) * 100) : 100,
      };
    });
  }

  async function fetchRoadmap() {
    if (!scanResult) return;
    await roadmapOp.run(async () => {
      const rate = Number(roadmapDailyRate);
      const body: { findings: ScanFinding[]; dailyRate?: number } = {
        findings: scanResult.findings,
      };
      if (roadmapDailyRate.trim() !== "" && Number.isFinite(rate) && rate > 0) {
        body.dailyRate = rate;
      }
      return apiPostJson<{ phases: RoadmapPhase[]; summary: RoadmapSummary }>(
        "/v1/roadmap/generate",
        body,
      );
    });
  }

  async function createEvidence() {
    if (!scanResult) return;
    // Creating a record invalidates a previous verification result — and the
    // verify operation's error, which previously lived in the shared
    // evidence-error string.
    evidenceVerifyOp.clear();
    await evidenceCreateOp.run(async () => {
      const scanResultHash = await sha256Hex(JSON.stringify(scanResult.findings));
      const data = await apiPostJson<{ ledger: EvidenceLedger }>("/v1/evidence/create", {
        scanResultHash,
        scanTarget: scanResult.target,
        findingsCount: scanResult.findings.length,
        riskSummary: scanResult.summary,
      });
      return data.ledger;
    });
  }

  async function verifyLedger() {
    if (!evidenceLedger) return;
    await evidenceVerifyOp.run(async () => {
      const data = await apiPostJson<EvidenceVerifyResult>("/v1/evidence/verify", {
        ledger: evidenceLedger,
      });
      return data;
    });
  }

  async function exportCbom() {
    if (!scanResult) return;
    setExportLoading("cbom");
    try {
      downloadBlob(
        JSON.stringify(buildCbom(scanResult), null, 2),
        `cbom-${safeName(scanResult.target)}.json`,
        "application/json",
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportLoading(null);
    }
  }

  async function exportSarif() {
    if (!scanResult) return;
    setExportLoading("sarif");
    try {
      downloadBlob(
        JSON.stringify(buildSarif(scanResult), null, 2),
        `sarif-${safeName(scanResult.target)}.sarif`,
        "application/sarif+json",
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportLoading(null);
    }
  }

  function exportJson() {
    if (!scanResult) return;
    setExportLoading("json");
    try {
      downloadBlob(
        JSON.stringify(scanResult, null, 2),
        `scan-${safeName(scanResult.target)}.json`,
        "application/json",
      );
    } finally {
      setExportLoading(null);
    }
  }

  return {
    target,
    setTarget,
    scanSource,
    setScanSource,
    scanManifest,
    setScanManifest,
    scanLoading: pathScanOp.loading,
    scanResult,
    // Path-scan failures and export failures used to share one error string;
    // both still surface on this line.
    scanError: pathScanOp.error || exportError,
    repoInput,
    setRepoInput,
    repoLoading: repoScanOp.loading,
    repoError: repoScanOp.error,
    riskScores: riskOp.data ?? [],
    riskLoading: riskOp.loading,
    riskError: riskOp.error,
    complianceFramework,
    setComplianceFramework,
    complianceReport: complianceOp.data,
    complianceLoading: complianceOp.loading,
    complianceError: complianceOp.error,
    roadmapDailyRate,
    setRoadmapDailyRate,
    roadmap: roadmapOp.data,
    roadmapLoading: roadmapOp.loading,
    roadmapError: roadmapOp.error,
    evidenceLedger,
    evidenceVerify: evidenceVerifyOp.data,
    evidenceLoading: evidenceCreateOp.loading,
    // Create and verify previously shared one error string; the merged read
    // keeps the single field the panel renders.
    evidenceError: evidenceCreateOp.error || evidenceVerifyOp.error,
    verifyLoading: evidenceVerifyOp.loading,
    exportLoading,
    tab,
    setTab,
    operatorEndpoint,
    runScan,
    runRepoScan,
    fetchRiskScores,
    fetchCompliance,
    fetchRoadmap,
    createEvidence,
    verifyLedger,
    exportCbom,
    exportSarif,
    exportJson,
  };
}

export type ScannerState = ReturnType<typeof useScannerState>;
