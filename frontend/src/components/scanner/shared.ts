/**
 * Shared types, tab registry and pure helpers for the scanner dashboard.
 *
 * Extracted verbatim from scanner-dashboard.tsx (TD-01 decomposition): the
 * finding/report shapes returned by the scanner endpoints, the tab registry
 * that drives the rail, and the severity/normalization/summary helpers.
 * Nothing here renders JSX — the shared presentational pieces live in
 * `shared-ui.tsx`. No behaviour change.
 */
import type { ComponentType, SVGProps } from "react";
import type { StatusTone } from "@/components/ui/status-pill";
import {
  ActivityIcon,
  BeakerIcon,
  ChartBarIcon,
  CpuChipIcon,
  DocumentCheckIcon,
  RadarIcon,
  RouteIcon,
  ShieldCheckIcon,
} from "@/app/icons";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ScanFinding {
  type?: string;
  file: string;
  algorithm: string;
  line?: number;
  severity?: string;
  message?: string;
  /**
   * API-native fields. The scanner speaks the CBOM vocabulary (`host`,
   * `asset_type`, `criticality`, `metadata.lines`), while the tables below
   * speak the UI vocabulary above. Keeping both means downstream calls
   * (/v1/risk/score, /v1/compliance/evaluate) still receive the original
   * finding while the table can render it without blank cells.
   */
  asset_type?: string;
  host?: string | null;
  port?: number | null;
  key_type?: string | null;
  key_size?: number | null;
  criticality?: string | null;
  metadata?: {
    language?: string;
    lines?: Array<string | number>;
    line?: number;
    total_matches?: number;
  } | null;
  [key: string]: unknown;
}

export interface ScanSummary {
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  algorithmsDetected: string[];
}

/** Shape returned by POST /v1/scan/full (summary is computed client-side). */
export interface ScanResult {
  target: string;
  scanType: string;
  timestamp: string;
  findings: ScanFinding[];
  summary: ScanSummary;
}

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

/** Shape returned by POST /v1/risk/score. */
export interface ScoredFinding extends ScanFinding {
  algorithmClassification: string;
  riskScore: number;
  riskLevel: RiskLevel;
}

export interface ComplianceFinding extends ScanFinding {
  compliance: { compliant: boolean; reason: string };
}

/** Shape returned by POST /v1/compliance/evaluate (+ client-side score). */
export interface ComplianceReport {
  framework: string;
  results: ComplianceFinding[];
  compliant: number;
  nonCompliant: number;
  total: number;
  scorePercent: number;
}

/** Shape returned by POST /v1/roadmap/generate. */
export interface RoadmapPhase {
  phase: number;
  title: string;
  priority: string;
  estimatedDays: number;
  findings: ScanFinding[];
}

export interface RoadmapSummary {
  totalFindings: number;
  totalDays: number;
  totalCost: number;
  dailyRate: number;
  completionDate: string;
}

export interface Roadmap {
  phases: RoadmapPhase[];
  summary: RoadmapSummary;
}

/** Shape returned by POST /v1/evidence/create. */
export interface EvidenceLedger {
  version: string;
  data: {
    scanResultHash: string;
    scanTarget: string;
    findingsCount: number;
    riskSummary: ScanSummary;
    timestamp: string;
  };
  integrityHash: string;
  previousHash: string;
  chainIndex: number;
}

/** Shape returned by POST /v1/evidence/verify. */
export interface EvidenceVerifyResult {
  valid: boolean;
  expectedHash: string;
  providedHash: string;
}

/* -------------------------------------------------------------------------- */
/*  Tab configuration                                                          */
/* -------------------------------------------------------------------------- */

export type TabId = "scan" | "risk" | "compliance" | "roadmap" | "evidence" | "sidechannel" | "planner" | "lab";

type TabIcon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Tab registry.
 *
 * `label` is load-bearing: `scripts/full-audit.mjs` asserts the exact eight
 * accessible names, so nothing may be added inside a trigger that contributes
 * text — the icons are SVG-only for that reason, and the result counts are
 * rendered as a CSS `::after` badge from `data-badge` (pseudo-element content
 * is not part of `textContent`, so the accessible name stays clean).
 *
 * `purpose` is what turns eight labels into a product: the strip under the rail
 * explains the active surface and names the endpoint behind it, so a visitor
 * never has to guess which tab does what or whether a tab needs a key.
 */
export const TABS: {
  id: TabId;
  label: string;
  icon: TabIcon;
  step: string;
  purpose: string;
}[] = [
  {
    id: "scan",
    label: "Scan",
    icon: RadarIcon,
    step: "01",
    purpose:
      "Parse a directory into CycloneDX-style findings. Open to every visitor — no key, no wallet.",
  },
  {
    id: "risk",
    label: "Risk Scores",
    icon: ChartBarIcon,
    step: "02",
    purpose:
      "Classify each finding as BROKEN, WEAKENED or INVENTORY and score the exposure 0–100.",
  },
  {
    id: "compliance",
    label: "Compliance",
    icon: ShieldCheckIcon,
    step: "03",
    purpose:
      "Evaluate the same inventory against NIST SP 800-131A or CNSA 2.0, with a reason per control.",
  },
  {
    id: "roadmap",
    label: "Roadmap",
    icon: RouteIcon,
    step: "04",
    purpose:
      "Sequence the remediation into phases with effort, cost and a completion date.",
  },
  {
    id: "evidence",
    label: "Evidence",
    icon: DocumentCheckIcon,
    step: "05",
    purpose:
      "Hash the scan result into a tamper-evident ledger record, then verify the hash.",
  },
  {
    id: "sidechannel",
    label: "Side Channel",
    icon: ActivityIcon,
    step: "06",
    purpose:
      "Estimate timing-leakage probability for an implementation profile and get a verdict.",
  },
  {
    id: "planner",
    label: "AI Planner",
    icon: CpuChipIcon,
    step: "07",
    purpose:
      "Rank migration order from a CBOM using the GNN planner — structure, not a static sort.",
  },
  {
    id: "lab",
    label: "AI & GPU Lab",
    icon: BeakerIcon,
    step: "08",
    purpose:
      "Quantum threat estimates, CBOM anomaly scoring and the RL migration planner, GPU-backed.",
  },
];

export const COMPLIANCE_FRAMEWORKS = [
  { value: "NIST", label: "NIST SP 800-131A" },
  { value: "CNSA", label: "CNSA 2.0" },
] as const;

/**
 * Directories mounted into the local scanner container. Exposed as one-click
 * presets so a first-time visitor does not have to guess a server-side path.
 */
export const DEMO_ESTATE = "/workspace/projects/deploy/demo-estate";

export const SAMPLE_TARGETS = [
  { label: "Demo estate", path: DEMO_ESTATE },
  { label: "API gateway", path: `${DEMO_ESTATE}/services/api-gateway` },
  { label: "Payments", path: `${DEMO_ESTATE}/services/payments` },
  { label: "Mobile", path: `${DEMO_ESTATE}/services/mobile` },
] as const;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Severity → semantic tone.
 *
 * These helpers used to return raw Tailwind class pairs
 * (`bg-rose-100 text-rose-700`, `bg-sky-100 text-sky-700`, …) that no other part
 * of the application shared: "critical" was rose here, red in the anomaly
 * panel and the compliance chips, and risk-critical in the gauge. Returning a
 * tone instead means every chip in the product is rendered by `StatusPill`
 * against a measured AA-safe surface.
 *
 * The information design is unchanged — `medium` keeps the brand accent and
 * `high` keeps its caution colour, so the bands stay distinguishable.
 */
export function severityTone(s: string): StatusTone {
  switch (s.toLowerCase()) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "accent";
    case "low":
      return "success";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

export function complianceTone(status: string): StatusTone {
  switch (status) {
    case "pass":
      return "success";
    case "fail":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "neutral";
  }
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "scan";
}

export async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable in this context — cannot hash scan evidence.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  source_crypto_usage: "Source usage",
  dependency_manifest: "Dependency manifest",
  certificate: "Certificate",
  tls_endpoint: "TLS endpoint",
  library: "Library",
};

/** Strip the scan root so tables show `ast_scanner.py`, not the whole path. */
function relativeToRoot(file: string, root: string): string {
  const base = root.replace(/\/+$/, "");
  if (!base) return file;
  if (file.startsWith(`${base}/`)) return file.slice(base.length + 1);
  return file;
}

function firstReportedLine(finding: ScanFinding): number | undefined {
  const lines = finding.metadata?.lines;
  if (Array.isArray(lines) && lines.length > 0) {
    const first = Number(lines[0]);
    if (Number.isFinite(first)) return first;
  }
  // Some detectors report a single `metadata.line` instead of `lines`.
  const single = Number(finding.metadata?.line);
  return Number.isFinite(single) ? single : undefined;
}

/** One-line, human description of a finding built from CBOM fields. */
function describeFinding(finding: ScanFinding): string {
  const parts: string[] = [];
  const kind = finding.asset_type ?? finding.type;
  if (kind) parts.push(ASSET_TYPE_LABELS[kind] ?? kind.replaceAll("_", " "));
  if (finding.key_type) parts.push(finding.key_type);
  if (typeof finding.key_size === "number" && finding.key_size > 0) {
    parts.push(`${finding.key_size}-bit`);
  }
  const matches = finding.metadata?.total_matches;
  if (typeof matches === "number" && matches > 0) {
    parts.push(`${matches} match${matches === 1 ? "" : "es"}`);
  }
  return parts.join(" · ") || "Cryptographic asset detected";
}

/**
 * Translate a scanner finding into the shape the tables render.
 *
 * Never drops the original fields: the same object is posted back to
 * /v1/risk/score and /v1/compliance/evaluate, which read `algorithm`,
 * `key_size` and `first_seen` directly.
 */
export function normalizeFinding(finding: ScanFinding, root: string): ScanFinding {
  const file = finding.file ?? finding.host ?? "";
  return {
    ...finding,
    type: finding.type ?? finding.asset_type,
    file: relativeToRoot(file, root),
    line: finding.line ?? firstReportedLine(finding),
    severity: (finding.severity ?? finding.criticality ?? "unknown").toLowerCase(),
    message: finding.message ?? describeFinding(finding),
  };
}

/** Last path segment, for dense tables; the full path stays in the title. */
export function basename(file: string): string {
  const parts = file.split("/");
  return parts[parts.length - 1] || file;
}

export function summarizeFindings(findings: ScanFinding[]): ScanSummary {
  const algorithms = new Set<string>();
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let info = 0;
  for (const f of findings) {
    if (f.algorithm) algorithms.add(f.algorithm);
    switch ((f.severity ?? "").toLowerCase()) {
      case "critical":
        critical++;
        break;
      case "high":
        high++;
        break;
      case "medium":
        medium++;
        break;
      case "low":
        low++;
        break;
      default:
        info++;
    }
  }
  return {
    totalFindings: findings.length,
    critical,
    high,
    medium,
    low,
    info,
    algorithmsDetected: Array.from(algorithms).sort(),
  };
}

/* Client-side CycloneDX-style CBOM generated from the returned findings. */
export function buildCbom(result: ScanResult): Record<string, unknown> {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "Q-Trust", name: "Q-Trust Scanner Dashboard", version: "1.0" }],
      properties: [
        { name: "qtrust:generatedBy", value: "client-side export from scan findings" },
        { name: "qtrust:scanTarget", value: result.target },
        { name: "qtrust:scanTimestamp", value: result.timestamp },
      ],
    },
    components: result.findings.map((f, i) => ({
      type: "cryptographic-asset",
      "bom-ref": `qtrust-finding-${i + 1}`,
      name: f.algorithm,
      properties: [
        ...(f.file ? [{ name: "qtrust:file", value: f.file }] : []),
        ...(f.line !== undefined ? [{ name: "qtrust:line", value: String(f.line) }] : []),
        ...(f.severity ? [{ name: "qtrust:severity", value: f.severity }] : []),
        ...(f.message ? [{ name: "qtrust:message", value: f.message }] : []),
      ],
    })),
  };
}

/* Client-side SARIF 2.1.0 generated from the returned findings. */
export function buildSarif(result: ScanResult): Record<string, unknown> {
  return {
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Q-Trust PQC Scanner",
            version: "1.0",
            properties: { generatedBy: "client-side export from scan findings" },
          },
        },
        invocations: [{ endTimeUtc: new Date().toISOString() }],
        results: result.findings.map((f) => ({
          ruleId: f.algorithm,
          level:
            f.severity === "critical" || f.severity === "high"
              ? "error"
              : f.severity === "medium"
                ? "warning"
                : "note",
          message: { text: f.message ?? `${f.algorithm} usage detected` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                ...(f.line !== undefined ? { region: { startLine: f.line } } : {}),
              },
            },
          ],
        })),
      },
    ],
  };
}
