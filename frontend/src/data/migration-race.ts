/**
 * Real estate for the Migration Race visualization.
 *
 * Source of truth: `planner/qtrust_planner/outcome_sim.py` (SIM_SPEC_VERSION
 * "qrd-sim/1.0") run on the real scanned estate `real_gov_edu_2` from the
 * host-disjoint 42-estate corpus (`planner/data/real_cboms`). Both orderings
 * and every schedule number below are emitted by the simulator — nothing is
 * hand-authored. Regenerate with the outcome_sim module if the estate or
 * simulator spec changes.
 *
 * The estate is a government/education TLS scan: seven hosts, mostly
 * RSA-2048 certificates, one unknown 2048-bit algorithm, one ECDSA-P256.
 * Quantum-risk-days (QRD) = Σ exposure_weight_i × completion_day_i under
 * sequential migration (see EXPERIMENTS.md E-09).
 */

export type RiskRate = 0 | 0.2 | 0.5 | 1;

export interface RaceAsset {
  idx: number;
  algorithm: string;
  keySize: number;
  criticality: "low" | "medium" | "high" | "critical";
  vendorPqcReady: boolean;
  riskRate: RiskRate;
  durationDays: number;
  host: string;
}

export interface RaceStep {
  idx: number;
  completionDay: number;
  qrdAtCompletion: number;
}

export interface RaceStrategy {
  order: number[];
  totalQrd: number;
  makespanDays: number;
  steps: RaceStep[];
}

export interface MigrationRaceData {
  estate: {
    name: string;
    industry: string;
    nAssets: number;
    simSpecVersion: string;
    assets: RaceAsset[];
  };
  strategies: {
    priorityList: RaceStrategy;
    outcomeAware: RaceStrategy;
  };
  headline: {
    qrdPriorityList: number;
    qrdOutcomeAware: number;
    exposureSaved: number;
    exposureSavedPct: number;
  };
}

export const MIGRATION_RACE: MigrationRaceData = {
  estate: {
    name: "real_gov_edu_2",
    industry: "gov_edu",
    nAssets: 7,
    simSpecVersion: "qrd-sim/1.0",
    assets: [
      { idx: 0, algorithm: "UNKNOWN", keySize: 2048, criticality: "medium", vendorPqcReady: false, riskRate: 0.5, durationDays: 32.0, host: "uic.edu" },
      { idx: 1, algorithm: "RSA-2048", keySize: 2048, criticality: "medium", vendorPqcReady: false, riskRate: 1.0, durationDays: 32.0, host: "medicare.gov" },
      { idx: 2, algorithm: "RSA-2048", keySize: 2048, criticality: "medium", vendorPqcReady: false, riskRate: 1.0, durationDays: 32.0, host: "cornell.edu" },
      { idx: 3, algorithm: "ECDSA-P256", keySize: 256, criticality: "medium", vendorPqcReady: false, riskRate: 1.0, durationDays: 28.5, host: "umich.edu" },
      { idx: 4, algorithm: "RSA-2048", keySize: 2048, criticality: "medium", vendorPqcReady: false, riskRate: 1.0, durationDays: 32.0, host: "nih.gov" },
      { idx: 5, algorithm: "RSA-2048", keySize: 2048, criticality: "medium", vendorPqcReady: false, riskRate: 1.0, durationDays: 32.0, host: "stanford.edu" },
      { idx: 6, algorithm: "RSA-2048", keySize: 2048, criticality: "medium", vendorPqcReady: false, riskRate: 1.0, durationDays: 32.0, host: "mit.edu" },
    ],
  },
  strategies: {
    priorityList: {
      order: [0, 1, 2, 4, 5, 6, 3],
      totalQrd: 1753.0,
      makespanDays: 220.5,
      steps: [
        { idx: 0, completionDay: 32.0, qrdAtCompletion: 32.0 },
        { idx: 1, completionDay: 64.0, qrdAtCompletion: 160.0 },
        { idx: 2, completionDay: 96.0, qrdAtCompletion: 352.0 },
        { idx: 4, completionDay: 128.0, qrdAtCompletion: 608.0 },
        { idx: 5, completionDay: 160.0, qrdAtCompletion: 928.0 },
        { idx: 6, completionDay: 192.0, qrdAtCompletion: 1312.0 },
        { idx: 3, completionDay: 220.5, qrdAtCompletion: 1753.0 },
      ],
    },
    outcomeAware: {
      order: [3, 6, 5, 4, 2, 1, 0],
      totalQrd: 1522.5,
      makespanDays: 220.5,
      steps: [
        { idx: 3, completionDay: 28.5, qrdAtCompletion: 57.0 },
        { idx: 6, completionDay: 60.5, qrdAtCompletion: 178.0 },
        { idx: 5, completionDay: 92.5, qrdAtCompletion: 363.0 },
        { idx: 4, completionDay: 124.5, qrdAtCompletion: 612.0 },
        { idx: 2, completionDay: 156.5, qrdAtCompletion: 925.0 },
        { idx: 1, completionDay: 188.5, qrdAtCompletion: 1302.0 },
        { idx: 0, completionDay: 220.5, qrdAtCompletion: 1522.5 },
      ],
    },
  },
  headline: {
    qrdPriorityList: 1753.0,
    qrdOutcomeAware: 1522.5,
    exposureSaved: 230.5,
    exposureSavedPct: 15.1,
  },
};

/** Continuous quantum-risk-days accumulated by a strategy at day `t`:
 * exposure accrues at Σ weights of not-yet-completed assets per day. */
export function qrdAtDay(strategy: RaceStrategy, assets: RaceAsset[], day: number): number {
  let total = 0;
  for (const step of strategy.steps) {
    const weight = assets[step.idx].riskRate * ({ low: 1, medium: 2, high: 3, critical: 4 } as const)[assets[step.idx].criticality];
    total += weight * Math.max(0, Math.min(day, step.completionDay));
  }
  return total;
}
