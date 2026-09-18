"use client";

import { useState } from "react";
import { Panel, PanelBody, PanelTitle } from "@/components/ui/panel";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

/**
 * Compliance rules table.
 *
 * The status chips previously used a 600-level foreground on a 15% tint of the
 * same hue (`text-green-600` on `bg-green-500/15`), measuring ~2.8:1 against the
 * 4.5:1 AA minimum — and rendered "compliant" in a different green and "failed"
 * in a different red than the rest of the application used for the same states.
 * Both are addressed by routing every status through `StatusPill`, whose tones
 * are measured against their own surfaces (ratios documented in `globals.css`).
 *
 * The `Rule` prop shape and all user-visible copy are unchanged.
 */

interface Rule {
  ruleId: string;
  ruleName: string;
  status: "COMPLIANT" | "NON_COMPLIANT" | "PARTIAL" | "NOT_APPLICABLE";
  evidence: string;
  recommendation: string;
}

interface CompliancePanelProps {
  framework: string;
  score: number;
  totalRules: number;
  compliantCount: number;
  nonCompliantCount: number;
  partialCount: number;
  rules: Rule[];
}

type RuleStatus = Rule["status"];

const STATUS_META: Record<RuleStatus, { tone: StatusTone; label: string }> = {
  COMPLIANT: { tone: "success", label: "Compliant" },
  NON_COMPLIANT: { tone: "danger", label: "Non-Compliant" },
  PARTIAL: { tone: "warning", label: "Partial" },
  NOT_APPLICABLE: { tone: "neutral", label: "N/A" },
};

/** Bar fills carry no text, so they use the solid state colours directly. */
const SCORE_TONE = (score: number): string =>
  score >= 80 ? "text-success" : score >= 50 ? "text-warning" : "text-danger";

function ScoreBar({
  compliant,
  partial,
  nonCompliant,
  total,
}: {
  compliant: number;
  partial: number;
  nonCompliant: number;
  total: number;
}) {
  if (total === 0) return null;
  const segments = [
    { value: compliant, className: "bg-success", label: "compliant" },
    { value: partial, className: "bg-warning", label: "partial" },
    { value: nonCompliant, className: "bg-danger", label: "non-compliant" },
  ];

  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={segments
        .filter((s) => s.value > 0)
        .map((s) => `${s.value} ${s.label}`)
        .join(", ")}
    >
      {segments.map((segment) =>
        segment.value > 0 ? (
          <div
            key={segment.label}
            className={`${segment.className} transition-all duration-500 motion-reduce:transition-none`}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

export default function CompliancePanel({
  framework,
  score,
  totalRules,
  compliantCount,
  nonCompliantCount,
  partialCount,
  rules,
}: CompliancePanelProps) {
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpandedRuleId((prev) => (prev === id ? null : id));

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelBody>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
              {framework}
            </h3>
            <span className={`font-display text-2xl font-semibold tabular-nums ${SCORE_TONE(score)}`}>
              {score}%
            </span>
          </div>
          <div className="mt-4">
            <ScoreBar
              compliant={compliantCount}
              partial={partialCount}
              nonCompliant={nonCompliantCount}
              total={totalRules}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-micro text-muted-foreground">
            <span>
              {compliantCount}/{totalRules} compliant
            </span>
            <span>{partialCount} partial</span>
            <span>{nonCompliantCount} non-compliant</span>
          </div>
        </PanelBody>
      </Panel>

      <Panel className="overflow-hidden">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <caption className="sr-only">Compliance rules assessment</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="px-4 py-3 font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Rule ID
                </th>
                <th scope="col" className="px-4 py-3 font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-mono text-label font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const meta = STATUS_META[rule.status] ?? STATUS_META.NOT_APPLICABLE;
                const isExpanded = expandedRuleId === rule.ruleId;
                return (
                  <tr key={rule.ruleId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-micro text-muted-foreground">
                      {rule.ruleId}
                    </td>
                    <td className="px-4 py-3 text-foreground">{rule.ruleName}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggle(rule.ruleId)}
                        aria-expanded={isExpanded}
                        aria-controls={`rule-detail-${rule.ruleId}`}
                        className="text-micro font-medium text-qtrust-600 underline underline-offset-4 transition hover:text-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
                      >
                        {isExpanded ? "Hide" : "Show"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile card fallback */}
        <div className="divide-y divide-border md:hidden" role="list" aria-label="Compliance rules">
          {rules.map((rule) => {
            const meta = STATUS_META[rule.status] ?? STATUS_META.NOT_APPLICABLE;
            const isExpanded = expandedRuleId === rule.ruleId;
            return (
              <div key={rule.ruleId} className="p-4" role="listitem">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-micro text-muted-foreground">{rule.ruleId}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">{rule.ruleName}</div>
                  </div>
                  <StatusPill tone={meta.tone} className="shrink-0">
                    {meta.label}
                  </StatusPill>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(rule.ruleId)}
                  aria-expanded={isExpanded}
                  aria-controls={`rule-detail-${rule.ruleId}`}
                  className="mt-2 text-micro font-medium text-qtrust-600 underline underline-offset-4 transition hover:text-qtrust-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-qtrust-600"
                >
                  {isExpanded ? "Hide details" : "Show details"}
                </button>
              </div>
            );
          })}
        </div>

        {rules.map((rule) => {
          if (expandedRuleId !== rule.ruleId) return null;
          return (
            <div
              key={`detail-${rule.ruleId}`}
              id={`rule-detail-${rule.ruleId}`}
              className="border-t border-border bg-muted/40 px-4 py-4"
            >
              <PanelTitle className="mb-3">{rule.ruleId}</PanelTitle>
              <div className="grid gap-4 text-sm md:grid-cols-2">
                <div>
                  <PanelTitle as="h4" className="mb-1.5 block">
                    Evidence
                  </PanelTitle>
                  <p className="leading-6 text-foreground">{rule.evidence || "—"}</p>
                </div>
                <div>
                  <PanelTitle as="h4" className="mb-1.5 block">
                    Recommendation
                  </PanelTitle>
                  <p className="leading-6 text-foreground">{rule.recommendation || "—"}</p>
                </div>
              </div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
