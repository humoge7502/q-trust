/**
 * Shimmer text (B6) — a gradient sweep clipped to the text via
 * background-clip: text. Pure CSS presentation, server-safe; reduced motion
 * lands on the static gradient (explicit override in globals.css), so the
 * phrase stays fully legible. Base/accent resolve through overridable custom
 * properties: dark surfaces use the defaults (night-ink + quantum-soft), and
 * light surfaces pass darker inks, e.g.
 * `[--shimmer-base:var(--color-qtrust-700)] [--shimmer-accent:var(--color-quantum-dim)]`.
 */
import type { ReactNode } from "react";

export function ShimmerText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`shimmer-text ${className}`.trim()}>{children}</span>;
}
