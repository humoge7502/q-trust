"use client";

/**
 * Scanner dashboard state.
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): every
 * piece of scan / risk / compliance / roadmap / evidence / export / tab state,
 * plus the API calls that populate it. The dashboard shell calls this hook
 * once and passes the result down to the per-tab panels, so the state stays
 * shared across tabs exactly as before. No behaviour change.
 */
import { useState } from "react";
import { apiPostJson, OperatorKeyRequiredError } from "@/lib/api";
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
  type ComplianceFinding,
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
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState("");

  /* ---- Risk state ---- */
  const [riskScores, setRiskScores] = useState<ScoredFinding[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState("");

  /* ---- Compliance state ---- */
  const [complianceFramework, setComplianceFramework] = useState<string>(COMPLIANCE_FRAMEWORKS[0].value);
  const [complianceReport, setComplianceReport] = useState<ComplianceReport | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState("");

  /* ---- Roadmap state ---- */
  const [roadmapDailyRate, setRoadmapDailyRate] = useState("");
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [roadmapError, setRoadmapError] = useState("");

  /* ---- Evidence state ---- */
  const [evidenceLedger, setEvidenceLedger] = useState<EvidenceLedger | null>(null);
  const [evidenceVerify, setEvidenceVerify] = useState<EvidenceVerifyResult | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);

  /* ---- Export state ---- */
  const [exportLoading, setExportLoading] = useState<string | null>(null);

  /*
   * Active surface. Held in React rather than left to Radix's uncontrolled
   * default because the rail's contextual strip and the per-tab result badges
   * both read from it — one source of truth for "where am I and what exists
   * here".
   */
  const [tab, setTab] = useState<TabId>("scan");

  /*
   * Operator access fallback: `/v1/scan/*`, `/v1/roadmap/generate` and
   * `/v1/evidence/create` are public-compute via the same-origin proxy (the
   * server key is attached), so they work for anonymous visitors. If the proxy
   * ever refuses one — e.g. a deployment configured without a server key in
   * production — we surface an operator prompt instead of a bare error.
   */
  const [operatorEndpoint, setOperatorEndpoint] = useState<string | null>(null);

  function reportError(err: unknown, setError: (message: string) => void) {
    if (err instanceof OperatorKeyRequiredError) {
      setOperatorEndpoint(err.endpoint);
      setError("");
      return;
    }
    setError(err instanceof Error ? err.message : String(err));
  }

  /* ---- API calls ---- */

  async function runScan() {
    if (!target.trim()) return;
    setScanLoading(true);
    setScanError("");
    setOperatorEndpoint(null);
    setScanResult(null);
    try {
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
      setScanResult({
        ...data,
        findings,
        summary: summarizeFindings(findings),
      });
    } catch (err) {
      reportError(err, setScanError);
    } finally {
      setScanLoading(false);
    }
  }

  async function fetchRiskScores() {
    if (!scanResult) return;
    setRiskLoading(true);
    setRiskError("");
    try {
      const data = await apiPostJson<{ findings: ScoredFinding[] }>("/v1/risk/score", {
        findings: scanResult.findings,
      });
      setRiskScores(Array.isArray(data.findings) ? data.findings : []);
    } catch (err) {
      reportError(err, setRiskError);
    } finally {
      setRiskLoading(false);
    }
  }

  async function fetchCompliance() {
    if (!scanResult) return;
    setComplianceLoading(true);
    setComplianceError("");
    try {
      const data = await apiPostJson<{
        framework: string;
        results: ComplianceFinding[];
        compliant: number;
        nonCompliant: number;
        total: number;
      }>("/v1/compliance/evaluate", {
        findings: scanResult.findings,
        framework: complianceFramework,
      });
      setComplianceReport({
        ...data,
        // The evaluate endpoint returns counts only; percentage derived here.
        scorePercent: data.total > 0 ? Math.round((data.compliant / data.total) * 100) : 100,
      });
    } catch (err) {
      reportError(err, setComplianceError);
    } finally {
      setComplianceLoading(false);
    }
  }

  async function fetchRoadmap() {
    if (!scanResult) return;
    setRoadmapLoading(true);
    setRoadmapError("");
    setOperatorEndpoint(null);
    try {
      const rate = Number(roadmapDailyRate);
      const body: { findings: ScanFinding[]; dailyRate?: number } = {
        findings: scanResult.findings,
      };
      if (roadmapDailyRate.trim() !== "" && Number.isFinite(rate) && rate > 0) {
        body.dailyRate = rate;
      }
      const data = await apiPostJson<{ phases: RoadmapPhase[]; summary: RoadmapSummary }>(
        "/v1/roadmap/generate",
        body,
      );
      setRoadmap(data);
    } catch (err) {
      reportError(err, setRoadmapError);
    } finally {
      setRoadmapLoading(false);
    }
  }

  async function createEvidence() {
    if (!scanResult) return;
    setEvidenceLoading(true);
    setEvidenceError("");
    setOperatorEndpoint(null);
    setEvidenceVerify(null);
    try {
      const scanResultHash = await sha256Hex(JSON.stringify(scanResult.findings));
      const data = await apiPostJson<{ ledger: EvidenceLedger }>("/v1/evidence/create", {
        scanResultHash,
        scanTarget: scanResult.target,
        findingsCount: scanResult.findings.length,
        riskSummary: scanResult.summary,
      });
      setEvidenceLedger(data.ledger);
    } catch (err) {
      reportError(err, setEvidenceError);
    } finally {
      setEvidenceLoading(false);
    }
  }

  async function verifyLedger() {
    if (!evidenceLedger) return;
    setVerifyLoading(true);
    setEvidenceError("");
    try {
      const data = await apiPostJson<EvidenceVerifyResult>("/v1/evidence/verify", {
        ledger: evidenceLedger,
      });
      setEvidenceVerify(data);
    } catch (err) {
      reportError(err, setEvidenceError);
    } finally {
      setVerifyLoading(false);
    }
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
      reportError(err, setScanError);
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
      reportError(err, setScanError);
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
    scanLoading,
    scanResult,
    scanError,
    riskScores,
    riskLoading,
    riskError,
    complianceFramework,
    setComplianceFramework,
    complianceReport,
    complianceLoading,
    complianceError,
    roadmapDailyRate,
    setRoadmapDailyRate,
    roadmap,
    roadmapLoading,
    roadmapError,
    evidenceLedger,
    evidenceVerify,
    evidenceLoading,
    evidenceError,
    verifyLoading,
    exportLoading,
    tab,
    setTab,
    operatorEndpoint,
    runScan,
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
