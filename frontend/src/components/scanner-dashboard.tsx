"use client";

/**
 * Scanner dashboard — scan targets for PQC vulnerabilities, view risk scores,
 * compliance status, migration roadmap, and evidence records.
 *
 * Endpoints used are the ones that actually exist on the backend:
 *   POST /v1/scan/full            POST /v1/risk/score
 *   POST /v1/compliance/evaluate  POST /v1/roadmap/generate
 *   POST /v1/evidence/create      POST /v1/evidence/verify
 * Panels marked "(client-side)" are computed locally from fetched data.
 */
import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { apiPostJson, OperatorKeyRequiredError } from "@/lib/api";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import SideChannelPanel from "@/components/side-channel-panel";
import { PlanningPanel } from "@/components/planning-panel";
import { MigrationRace } from "@/components/migration-race";
import QuantumThreatPanel from "@/components/quantum-threat-panel";
import AnomalyPanel from "@/components/anomaly-panel";
import RLPlanViewer from "@/components/rl-plan-viewer";
import { OperatorAccessInline, OperatorAccessPanel } from "@/components/operator-access";
import {
  ActivityIcon,
  BeakerIcon,
  ChartBarIcon,
  CpuChipIcon,
  DocumentCheckIcon,
  RadarIcon,
  RouteIcon,
  ShieldCheckIcon,
  XCircleIcon,
  ClockIcon,
} from "@/app/icons";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ScanFinding {
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

interface ScanSummary {
  totalFindings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  algorithmsDetected: string[];
}

/** Shape returned by POST /v1/scan/full (summary is computed client-side). */
interface ScanResult {
  target: string;
  scanType: string;
  timestamp: string;
  findings: ScanFinding[];
  summary: ScanSummary;
}

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

/** Shape returned by POST /v1/risk/score. */
interface ScoredFinding extends ScanFinding {
  algorithmClassification: string;
  riskScore: number;
  riskLevel: RiskLevel;
}

interface ComplianceFinding extends ScanFinding {
  compliance: { compliant: boolean; reason: string };
}

/** Shape returned by POST /v1/compliance/evaluate (+ client-side score). */
interface ComplianceReport {
  framework: string;
  results: ComplianceFinding[];
  compliant: number;
  nonCompliant: number;
  total: number;
  scorePercent: number;
}

/** Shape returned by POST /v1/roadmap/generate. */
interface RoadmapPhase {
  phase: number;
  title: string;
  priority: string;
  estimatedDays: number;
  findings: ScanFinding[];
}

interface RoadmapSummary {
  totalFindings: number;
  totalDays: number;
  totalCost: number;
  dailyRate: number;
  completionDate: string;
}

interface Roadmap {
  phases: RoadmapPhase[];
  summary: RoadmapSummary;
}

/** Shape returned by POST /v1/evidence/create. */
interface EvidenceLedger {
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
interface EvidenceVerifyResult {
  valid: boolean;
  expectedHash: string;
  providedHash: string;
}

/* -------------------------------------------------------------------------- */
/*  Tab configuration                                                          */
/* -------------------------------------------------------------------------- */

type TabId = "scan" | "risk" | "compliance" | "roadmap" | "evidence" | "sidechannel" | "planner" | "lab";

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
const TABS: {
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

const COMPLIANCE_FRAMEWORKS = [
  { value: "NIST", label: "NIST SP 800-131A" },
  { value: "CNSA", label: "CNSA 2.0" },
] as const;

/**
 * Directories mounted into the local scanner container. Exposed as one-click
 * presets so a first-time visitor does not have to guess a server-side path.
 */
const DEMO_ESTATE = "/workspace/projects/deploy/demo-estate";

const SAMPLE_TARGETS = [
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
function severityTone(s: string): StatusTone {
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

function complianceTone(status: string): StatusTone {
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

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-current" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "scan";
}

async function sha256Hex(input: string): Promise<string> {
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
function normalizeFinding(finding: ScanFinding, root: string): ScanFinding {
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
function basename(file: string): string {
  const parts = file.split("/");
  return parts[parts.length - 1] || file;
}

function summarizeFindings(findings: ScanFinding[]): ScanSummary {
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
function buildCbom(result: ScanResult): Record<string, unknown> {
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
function buildSarif(result: ScanResult): Record<string, unknown> {
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

/* -------------------------------------------------------------------------- */
/*  Presentational shell                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One panel shape for every surface below the rail.
 *
 * The old markup repeated `rounded-xl border border-border bg-card p-6 shadow-sm`
 * eight times with a mono eyebrow and a paragraph of endpoint documentation, so
 * every tab looked like the same grey form and the endpoint prose competed with
 * the actual content. Here the header is a separate band with a numbered step, a
 * real heading, and the endpoint note demoted to a single muted line.
 */
function Panel({
  index,
  title,
  copy,
  aside,
  children,
}: {
  index: string;
  title: string;
  copy: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 border-b border-border bg-[#fbfbfa] px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="font-mono text-label uppercase tracking-[0.22em] text-muted-foreground">
            {index}
          </p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-[-0.03em] text-slate-950">
            {title}
          </h2>
          <p className="mt-1.5 max-w-xl text-micro leading-5 text-muted-foreground">{copy}</p>
        </div>
        {aside ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{aside}</div>
        ) : null}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

/** Severity bands, in escalating order — the order the rail stacks them. */
const SEVERITY_BANDS = [
  { key: "critical", label: "Critical", swatch: "bg-risk-critical", fill: "#b91c1c" },
  { key: "high", label: "High", swatch: "bg-risk-high", fill: "#c2410c" },
  { key: "medium", label: "Medium", swatch: "bg-risk-medium", fill: "#a16207" },
  { key: "low", label: "Low", swatch: "bg-risk-low", fill: "#15803d" },
  { key: "info", label: "Info", swatch: "bg-risk-none", fill: "#64748b" },
] as const;

/**
 * Result headline: one large number, then the severity mix as a single stacked
 * bar with a legend.
 *
 * Replaces a row of five equally-weighted pills, which gave "1 critical" and
 * "13 info" the same visual mass. The stacked bar makes the shape of the estate
 * legible at a glance; the legend keeps the exact counts available.
 */
function SeveritySummary({ summary }: { summary: ScanSummary }) {
  const total = summary.totalFindings;
  const bands = SEVERITY_BANDS.map((band) => ({ ...band, count: summary[band.key] }));
  const ariaMix = bands
    .filter((band) => band.count > 0)
    .map((band) => `${band.count} ${band.label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="rounded-xl border border-border bg-[#fbfbfa] p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div>
          <p className="text-label font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Findings
          </p>
          <p className="mt-1.5 text-5xl font-semibold leading-none tracking-[-0.06em] text-slate-950 tabular-nums">
            {total}
          </p>
          <p className="mt-2.5 text-micro text-muted-foreground">
            {summary.algorithmsDetected.length} distinct algorithm
            {summary.algorithmsDetected.length === 1 ? "" : "s"} detected
          </p>
        </div>

        <div className="min-w-[15rem] flex-1">
          {total > 0 ? (
            <>
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
                role="img"
                aria-label={`Severity mix: ${ariaMix}`}
              >
                {bands
                  .filter((band) => band.count > 0)
                  .map((band) => (
                    <span
                      key={band.key}
                      style={{
                        width: `${(band.count / total) * 100}%`,
                        backgroundColor: band.fill,
                      }}
                    />
                  ))}
              </div>
              <ul className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-1.5 sm:grid-cols-3">
                {bands.map((band) => (
                  <li key={band.key} className="flex items-center gap-2 text-micro">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${band.swatch}`}
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{band.label}</span>
                    <span className="ml-auto font-mono font-semibold text-foreground tabular-nums">
                      {band.count}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-micro leading-6 text-muted-foreground">
              No quantum-vulnerable algorithms were detected in this target.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Algorithm distribution.
 *
 * Deliberately not a `<table>`: `scripts/full-audit.mjs` counts
 * `table tbody tr` on the Scan tab and expects exactly the 20 finding rows, so
 * a second table here would break a real assertion. Bars also read better —
 * the question is "which algorithm dominates", not "what is the exact count of
 * the fourth row".
 */
function AlgorithmMix({ findings }: { findings: ScanFinding[] }) {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (!finding.algorithm) continue;
    counts.set(finding.algorithm, (counts.get(finding.algorithm) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (rows.length === 0) return null;
  const max = rows[0][1];

  return (
    <div className="mt-4 rounded-xl border border-border p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-slate-950">
          Algorithm mix
        </h3>
        <p className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground">
          by occurrence
        </p>
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map(([algorithm, count]) => (
          <li key={algorithm} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3">
            <span className="truncate font-mono text-micro text-foreground" title={algorithm}>
              {algorithm}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-neutral-surface">
              <span
                className="block h-full rounded-full bg-qtrust-600"
                style={{ width: `${Math.max((count / max) * 100, 4)}%` }}
              />
            </span>
            <span className="text-right font-mono text-micro font-semibold text-foreground tabular-nums">
              {count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Severity → the left rail colour on a finding row. */
const SEVERITY_RAIL: Record<string, string> = {
  critical: "border-l-risk-critical",
  high: "border-l-risk-high",
  medium: "border-l-risk-medium",
  low: "border-l-risk-low",
  info: "border-l-slate-300",
};

/**
 * Coverage toggle.
 *
 * A real `<input type="checkbox">` kept in the DOM (visually hidden) so the
 * control still announces as a checkbox, still responds to Space, and still
 * reports its state to assistive technology — the pill is only the rendering.
 */
function CoverageToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-micro font-medium transition focus-within:ring-2 focus-within:ring-qtrust-600 focus-within:ring-offset-1 ${
        checked
          ? "border-qtrust-600 bg-qtrust-50 text-qtrust-700"
          : "border-border bg-white text-muted-foreground hover:border-slate-400"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${
          checked ? "border-qtrust-600 bg-qtrust-600" : "border-slate-300 bg-white"
        }`}
        aria-hidden="true"
      >
        {checked ? (
          <svg
            viewBox="0 0 24 24"
            className="h-2.5 w-2.5"
            fill="none"
            stroke="#ffffff"
            aria-hidden="true"
            focusable="false"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
        ) : null}
      </span>
      {label}
    </label>
  );
}

/**
 * Numbered eyebrow for the tabs whose child panels already carry their own
 * card and heading. Adding a second heading here would duplicate the title;
 * the step number keeps them in the same numbered system as the rest.
 */
function SurfaceEyebrow({ index }: { index: string }) {
  return (
    <p className="font-mono text-label uppercase tracking-[0.22em] text-muted-foreground">{index}</p>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function ScannerDashboard() {
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

  /* ---- Render ---- */

  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0];

  /**
   * Per-tab result badges. A badge only appears when something actually exists
   * behind the tab, so it always answers "is there anything in there?" — never
   * a decorative zero. Rendered as a `::after` from `data-badge` so the tab's
   * text content (and therefore its accessible name) stays exactly the label.
   */
  const badges: Partial<Record<TabId, string>> = {};
  if (scanResult) badges.scan = String(scanResult.summary.totalFindings);
  if (riskScores.length > 0) badges.risk = String(riskScores.length);
  if (complianceReport) badges.compliance = `${complianceReport.scorePercent}%`;
  if (roadmap) badges.roadmap = String(roadmap.phases.length);
  if (evidenceVerify?.valid) badges.evidence = "✓";

  const riskMix = (() => {
    const counts = new Map<string, number>();
    for (const score of riskScores) {
      counts.set(score.riskLevel, (counts.get(score.riskLevel) ?? 0) + 1);
    }
    return (["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"] as const)
      .map((level) => ({ level, count: counts.get(level) ?? 0 }))
      .filter((entry) => entry.count > 0);
  })();

  return (
    <Tabs.Root value={tab} onValueChange={(value) => setTab(value as TabId)}>
      {/* Surface bar: states up front that nothing here needs credentials, and
          keeps the operator key reachable without making it the first thing a
          visitor reads. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="flex items-center gap-2 text-micro text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          Public surface
          <span aria-hidden="true">·</span>
          <span>no key, no wallet, no account</span>
        </p>
        <OperatorAccessPanel variant="strip" />
      </div>

      {/* Segmented rail.
          Desktop: a wrapping flex row. Eight labelled tabs do not fit 375px in
          one row, and the original single-row rail was silently clipped by the
          document's `overflow-x: clip` — no scrollbar, no affordance, trailing
          tabs unreachable. On phones it becomes a two-column grid instead, which
          is tidier than a ragged wrap and keeps every tab visible and tappable. */}
      <Tabs.List
        aria-label="Scanner surfaces"
        className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex sm:flex-wrap sm:items-center"
      >
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const badge = badges[entry.id];
          return (
            <Tabs.Trigger
              key={entry.id}
              value={entry.id}
              data-badge={badge || undefined}
              className="qtab group inline-flex items-center justify-start gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-muted-foreground transition duration-150 ease-out hover:bg-neutral-surface hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 focus-visible:ring-offset-1 data-[state=active]:bg-slate-950 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=active]:hover:bg-slate-950 sm:px-3 sm:text-[13px]"
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-data-[state=active]:opacity-100"
                aria-hidden="true"
              />
              {entry.label}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>

      {/* Contextual strip — what the active surface is for, and what state it is
          already holding. This is the difference between eight labels and a
          product: the rail says where you are, this says what you will find. */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 border-t border-border pt-3">
        <p className="max-w-2xl text-micro leading-5 text-muted-foreground">
          <span className="mr-2 font-mono text-label uppercase tracking-[0.2em] text-muted-foreground">
            {activeTab.step}
          </span>
          {activeTab.purpose}
        </p>
        <p className="font-mono text-label uppercase tracking-[0.14em] text-muted-foreground">
          {scanResult
            ? `${scanResult.summary.totalFindings} findings · ${scanResult.summary.algorithmsDetected.length} algorithms`
            : "no scan yet"}
        </p>
      </div>

      {/* ==================== 01 · SCAN ==================== */}
      <Tabs.Content value="scan" className="mt-5 focus-visible:outline-none">
        <Panel
          index="01 / inventory"
          title="Cryptographic Asset Scan"
          copy="POST /v1/scan/full — parses source files and dependency manifests into CBOM findings."
        >
          {/* Console-style target bar. A directory path is a command argument,
              so it is presented as one instead of as a boxed form field with a
              label above it. */}
          <div className="rounded-xl bg-slate-950 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pl-2 font-mono text-sm leading-none text-cyan-300" aria-hidden="true">
                ❯
              </span>
              <label htmlFor="scan-target" className="sr-only">
                Target directory
              </label>
              <input
                id="scan-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runScan()}
                placeholder="/workspace/projects/backend/src"
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-2 font-mono text-sm text-white placeholder:text-slate-400 focus:outline-none"
              />
              <Button
                onClick={() => void runScan()}
                disabled={scanLoading || !target.trim()}
                className="h-9 shrink-0 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-200 focus-visible:ring-cyan-200 focus-visible:ring-offset-slate-950"
              >
                {scanLoading && <Spinner />}
                {scanLoading ? "Scanning…" : "Run scan"}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Try
            </span>
            {SAMPLE_TARGETS.map((sample) => {
              const active = target === sample.path;
              return (
                <button
                  key={sample.path}
                  type="button"
                  onClick={() => setTarget(sample.path)}
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-1 font-mono text-micro transition ${
                    active
                      ? "border-slate-950 bg-slate-950 text-white"
                      : "border-border bg-white text-muted-foreground hover:border-slate-400 hover:text-slate-950"
                  }`}
                >
                  {sample.label}
                </button>
              );
            })}
          </div>

          <fieldset className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
            <legend className="sr-only">Scan coverage</legend>
            <CoverageToggle checked={scanSource} onChange={setScanSource} label="Source code" />
            <CoverageToggle
              checked={scanManifest}
              onChange={setScanManifest}
              label="Dependency manifests"
            />
          </fieldset>

          {scanError && <p className="mt-3 text-xs text-danger">{scanError}</p>}
          {operatorEndpoint === "/v1/scan/full" && (
            <OperatorAccessInline endpoint={operatorEndpoint} onSaved={() => void runScan()} />
          )}

          {scanResult && (
            <div className="mt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-sm font-semibold tracking-[-0.02em] text-slate-950">
                  Results
                </h3>
                <p className="font-mono text-label uppercase tracking-[0.16em] text-muted-foreground">
                  summary computed client-side
                </p>
              </div>

              <div className="mt-3">
                <SeveritySummary summary={scanResult.summary} />
              </div>

              <AlgorithmMix findings={scanResult.findings} />

              {/* Findings table — the only table on this surface: the audit
                  counts `table tbody tr` here and expects the finding rows. */}
              <div className="mt-4 hidden overflow-x-auto rounded-xl border border-border md:block">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Scan findings</caption>
                  <thead>
                    <tr className="border-b border-border bg-[#fbfbfa] text-label uppercase tracking-[0.14em] text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 font-semibold">File</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Line</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Algorithm</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Severity</th>
                      <th scope="col" className="px-4 py-2.5 font-semibold">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanResult.findings.map((f, i) => (
                      <tr
                        key={i}
                        className="border-b border-slate-100 transition-colors last:border-0 hover:bg-[#fbfbfa]"
                      >
                        <td
                          className="max-w-[220px] truncate px-4 py-2.5 font-mono text-foreground"
                          title={f.file}
                        >
                          {basename(f.file) || "-"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground tabular-nums">
                          {f.line ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-foreground">{f.algorithm}</td>
                        <td className="px-4 py-2.5">
                          <StatusPill tone={severityTone(f.severity ?? "")}>
                            {f.severity ?? "unknown"}
                          </StatusPill>
                        </td>
                        <td className="max-w-[240px] truncate px-4 py-2.5 text-muted-foreground">
                          {f.message}
                        </td>
                      </tr>
                    ))}
                    {scanResult.findings.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                          No findings — no quantum-vulnerable algorithms detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile card fallback for findings */}
              <div className="mt-4 space-y-2 md:hidden" role="list" aria-label="Scan findings">
                {scanResult.findings.map((f, i) => (
                  <div
                    key={i}
                    className={`rounded-xl border border-border border-l-2 bg-white p-3 ${
                      SEVERITY_RAIL[(f.severity ?? "").toLowerCase()] ?? "border-l-slate-300"
                    }`}
                    role="listitem"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-mono text-xs font-medium text-foreground">
                        {f.file}:{f.line ?? "—"}
                      </span>
                      <StatusPill tone={severityTone(f.severity ?? "")} className="shrink-0">
                        {f.severity ?? "unknown"}
                      </StatusPill>
                    </div>
                    <div className="mt-1 text-xs font-medium text-foreground">{f.algorithm}</div>
                    {f.message ? (
                      <div className="mt-1 text-xs text-muted-foreground">{f.message}</div>
                    ) : null}
                  </div>
                ))}
                {scanResult.findings.length === 0 && (
                  <div className="rounded-xl border border-border bg-white p-6 text-center text-sm text-muted-foreground">
                    No findings — no quantum-vulnerable algorithms detected.
                  </div>
                )}
              </div>

              {/* Exports */}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <span className="mr-1 text-label font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Export
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void exportCbom()}
                  disabled={exportLoading === "cbom"}
                >
                  {exportLoading === "cbom" ? <Spinner /> : null}
                  CycloneDX CBOM
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void exportSarif()}
                  disabled={exportLoading === "sarif"}
                >
                  {exportLoading === "sarif" ? <Spinner /> : null}
                  SARIF 2.1
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportJson()}
                  disabled={exportLoading === "json"}
                >
                  {exportLoading === "json" ? <Spinner /> : null}
                  Raw JSON
                </Button>
                <span className="text-micro text-muted-foreground">
                  CBOM and SARIF are generated client-side from the returned findings.
                </span>
              </div>
            </div>
          )}
        </Panel>
      </Tabs.Content>

      {/* ==================== 02 · RISK SCORES ==================== */}
      <Tabs.Content value="risk" className="mt-5 focus-visible:outline-none">
        <Panel
          index="02 / exposure"
          title="Quantum Risk Scores"
          copy="POST /v1/risk/score — classifies every finding and scores the exposure 0–100."
          aside={
            scanResult ? (
              <Button
                onClick={() => void fetchRiskScores()}
                disabled={riskLoading}
                size="sm"
                className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
              >
                {riskLoading && <Spinner />}
                {riskLoading ? "Calculating…" : "Calculate risk scores"}
              </Button>
            ) : null
          }
        >
          {!scanResult ? (
            <p className="text-sm text-muted-foreground">
              Run a scan first to generate risk scores.
            </p>
          ) : (
            <>
              {riskError && <p className="text-xs text-danger">{riskError}</p>}

              {riskLoading && (
                <div aria-busy="true" aria-label="Calculating risk scores" className="mt-4 space-y-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-40 w-full" />
                </div>
              )}

              {riskScores.length > 0 && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-mono text-label uppercase tracking-[0.18em] text-muted-foreground">
                      {riskScores.length} scored
                    </span>
                    <span className="h-3 w-px bg-slate-200" aria-hidden="true" />
                    {riskMix.map((entry) => (
                      <StatusPill key={entry.level} tone={severityTone(entry.level)}>
                        {entry.count} {entry.level.toLowerCase()}
                      </StatusPill>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">Quantum risk scores</caption>
                      <thead>
                        <tr className="border-b border-border bg-[#fbfbfa] text-label uppercase tracking-[0.14em] text-muted-foreground">
                          <th scope="col" className="px-4 py-2.5 font-semibold">File</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Line</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Algorithm</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Quantum vulnerable</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Classification</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Risk level</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-semibold">Score</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riskScores.map((r, i) => {
                          const broken =
                            r.algorithmClassification === "BROKEN" ||
                            r.algorithmClassification === "WEAKENED";
                          return (
                            <tr
                              key={i}
                              className="border-b border-slate-100 transition-colors last:border-0 hover:bg-[#fbfbfa]"
                            >
                              <td
                                className="max-w-[160px] truncate px-4 py-2.5 font-mono text-foreground"
                                title={r.file}
                              >
                                {basename(r.file)}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-muted-foreground tabular-nums">
                                {r.line ?? "—"}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-foreground">{r.algorithm}</td>
                              <td className="px-4 py-2.5">
                                {broken ? (
                                  <span className="inline-flex items-center gap-1 text-danger">
                                    <XCircleIcon className="h-3.5 w-3.5" aria-hidden="true" /> Yes
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-success">
                                    <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> No
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-micro text-muted-foreground">
                                {r.algorithmClassification}
                              </td>
                              <td className="px-4 py-2.5">
                                <StatusPill tone={severityTone(r.riskLevel)}>{r.riskLevel}</StatusPill>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">
                                {r.riskScore.toFixed(0)}
                              </td>
                              <td className="max-w-[200px] truncate px-4 py-2.5 text-muted-foreground">
                                {r.message}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="space-y-2 md:hidden" role="list" aria-label="Risk scores">
                    {riskScores.map((r, i) => {
                      const broken =
                        r.algorithmClassification === "BROKEN" ||
                        r.algorithmClassification === "WEAKENED";
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-border bg-white p-3"
                          role="listitem"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs text-foreground">
                              {r.file}:{r.line ?? "—"}
                            </span>
                            <StatusPill tone={severityTone(r.riskLevel)}>{r.riskLevel}</StatusPill>
                          </div>
                          <div className="mt-1 text-xs font-medium text-foreground">
                            {r.algorithm} · {r.algorithmClassification}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            {broken ? (
                              <span className="inline-flex items-center gap-1 text-danger">
                                <XCircleIcon className="h-3 w-3" aria-hidden="true" /> Vulnerable
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-success">
                                <ShieldCheckIcon className="h-3 w-3" aria-hidden="true" /> Safe
                              </span>
                            )}
                            <span className="font-mono text-muted-foreground tabular-nums">
                              score {r.riskScore.toFixed(0)}
                            </span>
                          </div>
                          {r.message ? (
                            <div className="mt-1 truncate text-xs text-muted-foreground">{r.message}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </Panel>
      </Tabs.Content>

      {/* ==================== 03 · COMPLIANCE ==================== */}
      <Tabs.Content value="compliance" className="mt-5 focus-visible:outline-none">
        <Panel
          index="03 / policy"
          title="Compliance Assessment"
          copy="POST /v1/compliance/evaluate — one verdict and one reason per finding, under the framework you pick."
          aside={
            scanResult ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-micro font-medium text-muted-foreground">
                  Framework
                  <select
                    value={complianceFramework}
                    onChange={(e) => setComplianceFramework(e.target.value)}
                    className="mt-1 block rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-foreground focus-visible:border-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600/20"
                  >
                    {COMPLIANCE_FRAMEWORKS.map((fw) => (
                      <option key={fw.value} value={fw.value}>
                        {fw.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  onClick={() => void fetchCompliance()}
                  disabled={complianceLoading}
                  size="sm"
                  className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
                >
                  {complianceLoading && <Spinner />}
                  {complianceLoading ? "Evaluating…" : "Evaluate"}
                </Button>
              </div>
            ) : null
          }
        >
          {!scanResult ? (
            <p className="text-sm text-muted-foreground">Run a scan first to evaluate compliance.</p>
          ) : (
            <>
              {complianceError && <p className="text-xs text-danger">{complianceError}</p>}
              {complianceLoading && (
                <div aria-busy="true" aria-label="Evaluating compliance" className="mt-4 space-y-3">
                  <Skeleton className="h-5 w-52" />
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              )}

              {complianceReport && (
                <div>
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
                    <div className="relative h-28 w-28 shrink-0">
                      <svg className="h-28 w-28 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                        <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#e2e8f0" strokeWidth="2.5" />
                        <circle
                          cx="18"
                          cy="18"
                          r="15.9155"
                          fill="none"
                          stroke={
                            complianceReport.scorePercent >= 80
                              ? "#15803d"
                              : complianceReport.scorePercent >= 50
                                ? "#a16207"
                                : "#b91c1c"
                          }
                          strokeWidth="2.5"
                          strokeDasharray={`${complianceReport.scorePercent} ${100 - complianceReport.scorePercent}`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="font-mono text-2xl font-semibold text-slate-950 tabular-nums">
                          {complianceReport.scorePercent}%
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-label uppercase tracking-[0.2em] text-muted-foreground">
                        {complianceReport.framework} verdict
                      </p>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                        <span className="inline-flex items-baseline gap-1.5">
                          <span className="font-mono text-xl font-semibold text-success tabular-nums">
                            {complianceReport.compliant}
                          </span>
                          <span className="text-muted-foreground">compliant</span>
                        </span>
                        <span className="inline-flex items-baseline gap-1.5">
                          <span className="font-mono text-xl font-semibold text-danger tabular-nums">
                            {complianceReport.nonCompliant}
                          </span>
                          <span className="text-muted-foreground">non-compliant</span>
                        </span>
                      </div>
                      <p className="mt-2 text-micro leading-5 text-muted-foreground">
                        {complianceReport.total} findings evaluated. Percentage derived
                        client-side from the server&rsquo;s counts.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 hidden overflow-x-auto rounded-xl border border-border md:block">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">Compliance findings</caption>
                      <thead>
                        <tr className="border-b border-border bg-[#fbfbfa] text-label uppercase tracking-[0.14em] text-muted-foreground">
                          <th scope="col" className="px-4 py-2.5 font-semibold">File</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Algorithm</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                          <th scope="col" className="px-4 py-2.5 font-semibold">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {complianceReport.results.map((r, i) => (
                          <tr
                            key={i}
                            className="border-b border-slate-100 transition-colors last:border-0 hover:bg-[#fbfbfa]"
                          >
                            <td className="max-w-[180px] truncate px-4 py-2.5 font-mono text-foreground">
                              {r.file}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-foreground">{r.algorithm}</td>
                            <td className="px-4 py-2.5">
                              <StatusPill
                                tone={complianceTone(r.compliance?.compliant ? "pass" : "fail")}
                              >
                                {r.compliance?.compliant ? "pass" : "fail"}
                              </StatusPill>
                            </td>
                            <td className="max-w-[320px] px-4 py-2.5 text-muted-foreground">
                              {r.compliance?.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 space-y-2 md:hidden" role="list" aria-label="Compliance findings">
                    {complianceReport.results.map((r, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-border bg-white p-3"
                        role="listitem"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs text-foreground">{r.file}</span>
                          <StatusPill
                            tone={complianceTone(r.compliance?.compliant ? "pass" : "fail")}
                          >
                            {r.compliance?.compliant ? "pass" : "fail"}
                          </StatusPill>
                        </div>
                        <div className="mt-1 text-xs font-medium text-foreground">{r.algorithm}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{r.compliance?.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Panel>
      </Tabs.Content>

      {/* ==================== 04 · ROADMAP ==================== */}
      <Tabs.Content value="roadmap" className="mt-5 focus-visible:outline-none">
        <Panel
          index="04 / sequence"
          title="Migration Roadmap"
          copy="POST /v1/roadmap/generate — phases, effort, cost and a completion date."
          aside={
            scanResult ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-micro font-medium text-muted-foreground">
                  Daily rate ($, optional)
                  <input
                    type="number"
                    min="1"
                    value={roadmapDailyRate}
                    onChange={(e) => setRoadmapDailyRate(e.target.value)}
                    placeholder="1500"
                    className="mt-1 block w-32 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-foreground placeholder:text-slate-400 focus-visible:border-qtrust-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600/20"
                  />
                </label>
                <Button
                  onClick={() => void fetchRoadmap()}
                  disabled={roadmapLoading}
                  size="sm"
                  className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
                >
                  {roadmapLoading && <Spinner />}
                  {roadmapLoading ? "Planning…" : "Generate roadmap"}
                </Button>
              </div>
            ) : null
          }
        >
          {!scanResult ? (
            <p className="text-sm text-muted-foreground">
              Run a scan first to generate a migration roadmap.
            </p>
          ) : (
            <>
              {roadmapError && <p className="text-xs text-danger">{roadmapError}</p>}
              {roadmapLoading && (
                <div aria-busy="true" aria-label="Generating roadmap" className="mt-4 space-y-3">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )}
              {operatorEndpoint === "/v1/roadmap/generate" && (
                <OperatorAccessInline
                  endpoint={operatorEndpoint}
                  onSaved={() => void fetchRoadmap()}
                />
              )}

              {roadmap && (
                <div>
                  <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-slate-200 sm:grid-cols-3">
                    <div className="bg-[#fbfbfa] p-5">
                      <p className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Total effort
                      </p>
                      <p className="mt-2 font-mono text-3xl font-semibold leading-none text-slate-950 tabular-nums">
                        {roadmap.summary.totalDays}{" "}
                        <span className="text-base font-normal text-muted-foreground">days</span>
                      </p>
                    </div>
                    <div className="bg-[#fbfbfa] p-5">
                      <p className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Estimated cost
                      </p>
                      <p className="mt-2 font-mono text-3xl font-semibold leading-none text-slate-950 tabular-nums">
                        ${roadmap.summary.totalCost.toLocaleString()}
                      </p>
                    </div>
                    <div className="bg-[#fbfbfa] p-5">
                      <p className="text-label font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Est. completion
                      </p>
                      <p className="mt-2 flex items-center gap-2 font-mono text-lg font-semibold text-slate-950">
                        <ClockIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {new Date(roadmap.summary.completionDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <ol className="mt-6 space-y-3">
                    {roadmap.phases.map((phase) => (
                      <li
                        key={phase.phase}
                        className="relative rounded-xl border border-border bg-white p-4 pl-14 transition-colors hover:border-slate-300"
                      >
                        <div
                          className="absolute left-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 font-mono text-micro font-semibold text-cyan-300 tabular-nums"
                          aria-hidden="true"
                        >
                          {phase.phase}
                        </div>
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                          <div>
                            <h3 className="text-sm font-semibold text-slate-950">{phase.title}</h3>
                            <StatusPill tone={severityTone(phase.priority)} className="mt-1.5">
                              {phase.priority}
                            </StatusPill>
                          </div>
                          <span className="inline-flex items-center gap-1 font-mono text-micro text-muted-foreground tabular-nums">
                            <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            {phase.estimatedDays}d
                          </span>
                        </div>

                        {phase.findings.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {phase.findings.slice(0, 8).map((f, i) => (
                              <span
                                key={i}
                                className="rounded bg-neutral-surface px-1.5 py-0.5 font-mono text-label text-muted-foreground"
                              >
                                {f.file}
                              </span>
                            ))}
                            {phase.findings.length > 8 && (
                              <span className="self-center text-label text-muted-foreground">
                                +{phase.findings.length - 8} more
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}
        </Panel>

        {/*
          Why ordering matters: the signature outcome visualization beside the
          roadmap it explains. Every number is emitted by the qrd-sim/1.0
          simulator on a real scanned estate (E-09); the dark slab keeps the
          race's own tone context inside the light app layer.
        */}
        <div className="mt-4">
          <Panel
            index="04 · exposure"
            title="Why this order?"
            copy="While the programme runs, every un-migrated asset keeps accumulating quantum risk. Ordering changes the total."
          >
            <div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white sm:p-7">
              <MigrationRace />
            </div>
          </Panel>
        </div>
      </Tabs.Content>

      {/* ==================== 05 · EVIDENCE ==================== */}
      <Tabs.Content value="evidence" className="mt-5 focus-visible:outline-none">
        <Panel
          index="05 / proof"
          title="Evidence Record"
          copy="POST /v1/evidence/create then /v1/evidence/verify. Records are created per request — the backend does not persist them."
          aside={
            <Button
              onClick={() => void createEvidence()}
              disabled={evidenceLoading || !scanResult}
              size="sm"
              className="rounded-lg bg-qtrust-600 px-4 text-white hover:bg-qtrust-700"
            >
              {evidenceLoading && <Spinner />}
              {!scanResult ? "Run a scan first" : evidenceLoading ? "Creating…" : "Create evidence record"}
            </Button>
          }
        >
          {evidenceError && <p className="text-xs text-danger">{evidenceError}</p>}
          {operatorEndpoint === "/v1/evidence/create" && (
            <OperatorAccessInline
              endpoint={operatorEndpoint}
              onSaved={() => void createEvidence()}
            />
          )}

          {evidenceLedger && (
            <div className="rounded-xl border border-border bg-[#fbfbfa] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-label uppercase tracking-[0.2em] text-muted-foreground">
                    Integrity hash
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-slate-950">
                      {evidenceLedger.integrityHash.slice(0, 16)}…
                    </span>
                    {evidenceVerify?.valid ? (
                      <StatusPill tone="success" icon={<ShieldCheckIcon className="h-3 w-3" />}>
                        verified
                      </StatusPill>
                    ) : evidenceVerify && !evidenceVerify.valid ? (
                      <StatusPill tone="danger" icon={<XCircleIcon className="h-3 w-3" />}>
                        mismatch
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">unverified</StatusPill>
                    )}
                  </div>
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-micro text-muted-foreground sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Scan ID</dt>
                      <dd className="truncate font-mono text-foreground">
                        {safeName(evidenceLedger.data.scanTarget)}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Findings</dt>
                      <dd className="font-mono text-foreground tabular-nums">
                        {evidenceLedger.data.findingsCount}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Created</dt>
                      <dd className="text-foreground">
                        {new Date(evidenceLedger.data.timestamp).toLocaleString()}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Version</dt>
                      <dd className="font-mono text-foreground">
                        v{evidenceLedger.version}, index #{evidenceLedger.chainIndex}
                      </dd>
                    </div>
                  </dl>
                  {evidenceVerify && !evidenceVerify.valid && (
                    <p className="mt-2 text-micro text-danger">
                      Expected {evidenceVerify.expectedHash.slice(0, 16)}… but got{" "}
                      {evidenceVerify.providedHash.slice(0, 16)}…
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  <button
                    onClick={() => void verifyLedger()}
                    disabled={verifyLoading || Boolean(evidenceVerify?.valid)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-success hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600 disabled:opacity-50"
                  >
                    {verifyLoading ? <Spinner /> : null}
                    {evidenceVerify?.valid ? "Verified" : verifyLoading ? "Verifying…" : "Verify"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!evidenceLedger && !evidenceError && (
            <div className="rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No evidence record yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-micro leading-5 text-muted-foreground">
                An evidence record hashes the latest scan result into an append-only
                ledger entry, so the findings can be checked later without being
                republished. Run a scan, then create the record.
              </p>
            </div>
          )}
        </Panel>
      </Tabs.Content>

      {/* ==================== 06 · SIDE CHANNEL ==================== */}
      <Tabs.Content value="sidechannel" className="mt-5 focus-visible:outline-none">
        <SurfaceEyebrow index="06 / leakage" />
        <div className="mt-3 max-w-xl">
          <SideChannelPanel />
        </div>
      </Tabs.Content>

      {/* ==================== 07 · AI PLANNER ==================== */}
      <Tabs.Content value="planner" className="mt-5 focus-visible:outline-none">
        <SurfaceEyebrow index="07 / ordering" />
        <div className="mt-3 max-w-3xl">
          <PlanningPanel />
        </div>
      </Tabs.Content>

      {/* ==================== 08 · AI & GPU LAB ==================== */}
      <Tabs.Content value="lab" className="mt-5 focus-visible:outline-none">
        <SurfaceEyebrow index="08 / lab" />
        <div className="mt-3 space-y-4">
          <QuantumThreatPanel />
          <AnomalyPanel />
          <RLPlanViewer />
        </div>
      </Tabs.Content>
    </Tabs.Root>
  );
}
