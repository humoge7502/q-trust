"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MIGRATION_RACE, qrdAtDay } from "@/data/migration-race";
import type { RaceAsset, RaceStrategy } from "@/data/migration-race";

/**
 * The Migration Race — the signature visualization of Q-Trust's outcome-based
 * planning (EXPERIMENTS.md E-09).
 *
 * Two migration plans execute the same real scanned estate while the quantum
 * exposure of each accrues in quantum-risk-days (QRD). The priority-list
 * ordering is the shipped rule formula; the outcome-aware ordering is the
 * simulation optimum the GNN found out-of-sample on this estate. Every
 * number is emitted by the transparent simulator (qrd-sim/1.0) — see
 * src/data/migration-race.ts.
 *
 * Accessibility: the animation respects prefers-reduced-motion (final state
 * renders immediately), the figure carries a full text alternative, exposure
 * is never encoded by colour alone (asset numbers + legend + table), and the
 * replay control is a real labelled button.
 */

const RACE_DURATION_MS = 7500;
const AXIS_HEIGHT = 28;
const LANE_LABEL_WIDTH = 148;
const LANE_HEIGHT = 56;
const LANE_GAP = 26;
const NUM_WIDTH = 132;

const CRITICALITY_WEIGHT: Record<RaceAsset["criticality"], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function exposureTone(rate: number): { fill: string; label: string } {
  if (rate >= 1) return { fill: "var(--race-broken)", label: "Shor-broken" };
  if (rate >= 0.5) return { fill: "var(--race-weakened)", label: "Weakened" };
  return { fill: "var(--race-safe)", label: "Low/none" };
}

function formatQrd(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

interface LaneBlocksProps {
  strategy: RaceStrategy;
  assets: RaceAsset[];
  width: number;
  makespan: number;
  day: number;
}

interface PositionedBlock {
  assetIdx: number;
  x: number;
  w: number;
  done: boolean;
  fill: string;
  showNumberInside: boolean;
}

function positionBlocks(
  strategy: RaceStrategy,
  assets: RaceAsset[],
  width: number,
  makespan: number,
  day: number,
): PositionedBlock[] {
  const scale = width / makespan;
  const blocks: PositionedBlock[] = [];
  let start = 0;
  for (const assetIdx of strategy.order) {
    const asset = assets[assetIdx];
    const x = start * scale;
    const w = asset.durationDays * scale;
    const step = strategy.steps.find((s) => s.idx === assetIdx);
    blocks.push({
      assetIdx,
      x,
      w,
      done: step ? day >= step.completionDay - 1e-9 : false,
      fill: exposureTone(asset.riskRate).fill,
      showNumberInside: w > 22,
    });
    start += asset.durationDays;
  }
  return blocks;
}

function LaneBlocks({ strategy, assets, width, makespan, day }: LaneBlocksProps) {
  const blocks = positionBlocks(strategy, assets, width, makespan, day);
  return (
    <g>
      {blocks.map((b) => (
        <g key={b.assetIdx}>
          <rect
            x={b.x}
            y={0}
            width={Math.max(b.w - 2, 2)}
            height={LANE_HEIGHT - 18}
            rx={4}
            fill={b.fill}
            fillOpacity={b.done ? 0.92 : 0.34}
            stroke={b.fill}
            strokeOpacity={b.done ? 0 : 0.75}
            strokeWidth={1.5}
          />
          <text
            x={b.showNumberInside ? b.x + b.w / 2 : Math.min(b.x + b.w / 2 + 8, width - 8)}
            y={(LANE_HEIGHT - 18) / 2 + 4}
            textAnchor="middle"
            fontSize={12}
            fontWeight={700}
            fill={b.showNumberInside && b.done ? "#020617" : b.fill}
            opacity={b.showNumberInside ? (b.done ? 1 : 0) : 1}
          >
            {b.assetIdx + 1}
          </text>
        </g>
      ))}
    </g>
  );
}

export function MigrationRace() {
  const { estate, strategies, headline } = MIGRATION_RACE;
  const assets = estate.assets;

  const [day, setDay] = useState(0);
  const [running, setRunning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Auto-start once when the section scrolls into view (never under reduced motion).
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const play = useCallback(() => {
    if (reducedMotion) {
      // Reduced motion must hold on replay too: jump straight to the result.
      setDay(strategies.priorityList.makespanDays);
      setRunning(false);
      return;
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setRunning(true);
    setDay(0);
    const t0 = performance.now();
    const tick = (now: number) => {
      const frac = Math.min((now - t0) / RACE_DURATION_MS, 1);
      setDay(frac * strategies.priorityList.makespanDays);
      if (frac < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setRunning(false);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [reducedMotion, strategies.priorityList.makespanDays]);

  useEffect(() => {
    // Deferred to a macrotask so neither branch sets state synchronously
    // during the effect (react-hooks/set-state-in-effect) — the auto-start
    // is invisible at human perception and reduced motion stays instant.
    const id = setTimeout(() => {
      if (inView && !reducedMotion) play();
      if (reducedMotion) setDay(strategies.priorityList.makespanDays);
    }, 0);
    return () => clearTimeout(id);
  }, [inView, reducedMotion, play, strategies.priorityList.makespanDays]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const finished = day >= strategies.priorityList.makespanDays - 1e-9;

  const livePriority = useMemo(
    () => qrdAtDay(strategies.priorityList, assets, day),
    [strategies.priorityList, assets, day],
  );
  const liveOutcome = useMemo(
    () => qrdAtDay(strategies.outcomeAware, assets, day),
    [strategies.outcomeAware, assets, day],
  );

  const width = 1000;
  const plotWidth = width - LANE_LABEL_WIDTH - NUM_WIDTH - 24;
  const svgHeight = AXIS_HEIGHT + LANE_HEIGHT * 2 + LANE_GAP + 8;
  const playheadX = LANE_LABEL_WIDTH + (day / strategies.priorityList.makespanDays) * plotWidth;

  const summary = `Migration race on real scanned estate ${estate.name} (${estate.nAssets} hosts, gov/edu). Priority-list plan finishes with ${formatQrd(headline.qrdPriorityList)} quantum-risk-days; the outcome-aware plan finishes with ${formatQrd(headline.qrdOutcomeAware)}, avoiding ${formatQrd(headline.exposureSaved)} risk-days (${headline.exposureSavedPct}% less exposure) under simulation qrd-sim/1.0.`;

  return (
    <div ref={containerRef} className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-400">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-[var(--race-broken)]" />
            Shor-broken (RSA, ECDSA…)
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-[var(--race-weakened)]" />
            Weakened (unknown)
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-[var(--race-safe)]" />
            Low / no exposure
          </span>
          <span>Filled block = migrated · outlined = waiting</span>
        </div>
        <button
          type="button"
          onClick={play}
          disabled={running && !finished}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-white transition hover:border-white/50 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50"
        >
          {finished ? "Replay the race" : running ? "Racing…" : "Play the race"}
        </button>
      </div>

      <figure className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
        <svg
          viewBox={`0 0 ${width} ${svgHeight}`}
          className="block w-full"
          role="img"
          aria-label={summary}
        >
          <defs>
            <linearGradient id="race-playhead" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.0" />
              <stop offset="12%" stopColor="#67e8f9" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#67e8f9" stopOpacity="0.15" />
            </linearGradient>
          </defs>

          {[
            { key: "priority", label: "Priority list", sub: "shipped formula", strategy: strategies.priorityList, live: livePriority, y: AXIS_HEIGHT },
            { key: "outcome", label: "Outcome-aware", sub: "GNN · simulation-optimal", strategy: strategies.outcomeAware, live: liveOutcome, y: AXIS_HEIGHT + LANE_HEIGHT + LANE_GAP },
          ].map((lane) => (
            <g key={lane.key} transform={`translate(0 ${lane.y})`}>
              <text x={0} y={12} fontSize={13} fontWeight={700} fill="#f8fafc">
                {lane.label}
              </text>
              <text x={0} y={28} fontSize={10.5} fill="#94a3b8">
                {lane.sub}
              </text>
              <text
                x={LANE_LABEL_WIDTH + plotWidth + 12}
                y={26}
                fontSize={22}
                fontWeight={700}
                fill={lane.key === "outcome" ? "#67e8f9" : "#f8fafc"}
                textAnchor="end"
                transform={`translate(${NUM_WIDTH}, 0)`}
              >
                {formatQrd(lane.live)}
              </text>
              <text
                x={LANE_LABEL_WIDTH + plotWidth + 12}
                y={41}
                fontSize={9.5}
                fill="#64748b"
                textAnchor="end"
                transform={`translate(${NUM_WIDTH}, 0)`}
              >
                risk-days
              </text>
              <g transform={`translate(${LANE_LABEL_WIDTH} ${34 - LANE_HEIGHT + 18})`}>
                <LaneBlocks
                  strategy={lane.strategy}
                  assets={assets}
                  width={plotWidth}
                  makespan={strategies.priorityList.makespanDays}
                  day={day}
                />
              </g>
            </g>
          ))}

          {/* Playhead */}
          <rect
            x={playheadX}
            y={AXIS_HEIGHT - 8}
            width={2}
            height={svgHeight - AXIS_HEIGHT - 4}
            fill="url(#race-playhead)"
            aria-hidden="true"
          />
          {/* Day axis */}
          <g transform={`translate(${LANE_LABEL_WIDTH} ${svgHeight - 8})`}>
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <text
                key={frac}
                x={frac * plotWidth}
                y={0}
                fontSize={10}
                fill="#64748b"
                textAnchor={frac === 0 ? "start" : frac === 1 ? "end" : "middle"}
              >
                day {Math.round(frac * strategies.priorityList.makespanDays)}
              </text>
            ))}
          </g>
        </svg>
        <figcaption className="border-t border-white/10 px-5 py-4 text-xs leading-6 text-slate-400">
          <span className="font-semibold text-slate-200">Asset key:</span>{" "}
          {estate.assets.map((a) => (
            <span key={a.idx} className="whitespace-nowrap">
              {a.idx + 1}={a.host.split(".")[0]}·{a.algorithm}
              {a.idx < estate.assets.length - 1 ? ", " : ". "}
            </span>
          ))}
          Real estate <code className="text-cyan-300">{estate.name}</code> from the
          host-disjoint scan corpus · simulator {estate.simSpecVersion}.
        </figcaption>
      </figure>

      <p className="mt-5 text-sm leading-7 text-slate-300" aria-live="polite">
        {finished ? (
          <>
            The outcome-aware plan finishes the same estate with{" "}
            <strong className="text-white">{formatQrd(headline.exposureSaved)} fewer quantum-risk-days</strong>{" "}
            ({headline.exposureSavedPct}% less exposure), because it front-loads the
            shortest high-exposure migrations instead of deferring them. Across all 42
            real estates: mean ratio 1.0000 vs 1.0473, Wilcoxon p&nbsp;=&nbsp;1.7×10⁻⁸
            (experiment E-09).
          </>
        ) : (
          <>Exposure accrues on every un-migrated asset, every day. Watch the two counters diverge.</>
        )}
      </p>
      <p className="sr-only">{summary}</p>
    </div>
  );
}
