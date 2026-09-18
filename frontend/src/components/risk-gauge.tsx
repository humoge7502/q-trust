"use client";

interface RiskGaugeProps {
  score: number;
  level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  label?: string;
}

type Level = RiskGaugeProps["level"];

/**
 * Risk bands, split into the two things they actually are.
 *
 * `LEVEL_STYLES` used to bundle a background *and* a text colour and was then
 * applied to three elements, two of which should never have had the background.
 * That produced a real WCAG AA failure: the level caption ended up as
 * `#a16207` on a 10% tint of itself (≈4.3:1, below the 4.5:1 minimum), and the
 * same tint was painted behind the caption text outside the ring.
 *
 * The ring is decorative decoration, so a 10% tint is fine *there*; text keeps
 * the band colour on the card surface, where every band clears AA:
 *   critical 6.54:1 · high 5.18:1 · medium 4.92:1 · low 5.02:1 · none 4.78:1
 */
const LEVEL_SURFACE: Record<Level, string> = {
  CRITICAL: "bg-risk-critical/10",
  HIGH: "bg-risk-high/10",
  MEDIUM: "bg-risk-medium/10",
  LOW: "bg-risk-low/10",
  NONE: "bg-risk-none/10",
};

const LEVEL_TEXT: Record<Level, string> = {
  CRITICAL: "text-risk-critical",
  HIGH: "text-risk-high",
  MEDIUM: "text-risk-medium",
  LOW: "text-risk-low",
  NONE: "text-risk-none",
};

const LEVEL_STROKE: Record<Level, string> = {
  CRITICAL: "var(--color-risk-critical)",
  HIGH: "var(--color-risk-high)",
  MEDIUM: "var(--color-risk-medium)",
  LOW: "var(--color-risk-low)",
  NONE: "var(--color-risk-none)",
};

export default function RiskGauge({ score, level, label }: RiskGaugeProps) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c; // pure render — no effect

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`relative flex items-center justify-center rounded-full p-2 ${LEVEL_SURFACE[level] ?? LEVEL_SURFACE.NONE}`}
      >
        <svg
          width="140"
          height="140"
          viewBox="0 0 120 120"
          role="img"
          aria-label={`Risk score ${score} of 100 — ${level}`}
        >
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            className="text-neutral-border"
            strokeDasharray={c}
            strokeDashoffset={0}
            strokeLinecap="round"
            style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
          />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={LEVEL_STROKE[level] ?? LEVEL_STROKE.NONE}
            strokeWidth="10"
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
            style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-display text-3xl font-semibold tabular-nums ${LEVEL_TEXT[level] ?? LEVEL_TEXT.NONE}`}
          >
            {score}
          </span>
        </div>
      </div>
      {label ? <span className="text-micro text-muted-foreground">{label}</span> : null}
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-label font-semibold uppercase tracking-[0.16em] ring-1 ring-inset ring-current ${LEVEL_TEXT[level] ?? LEVEL_TEXT.NONE}`}
      >
        {level}
      </span>
    </div>
  );
}
