/**
 * Typography — self-hosted through `next/font`.
 *
 * Three roles, one source of truth (consumed by the `@theme` block in
 * `globals.css`):
 *
 *   --font-display   Inter Tight    oversized editorial headings
 *   --font-sans      Inter          body copy and UI
 *   --font-mono      JetBrains Mono hashes, IDs, technical metadata
 *
 * `next/font` downloads these at build time and serves them from `/_next`,
 * so no request leaves the origin on the critical path: the CSP
 * (`font-src 'self'`) stays tight and a third-party font host can never
 * become a single point of failure for first paint.
 *
 * `adjustFontFallback` (on by default) emits a metric-matched local fallback,
 * which is what keeps CLS near zero across the swap — `e2e/cwv-budget.spec.ts`
 * asserts CLS <= 0.1. `preload` is enabled only for the two faces that paint
 * above the fold; the mono face is decorative at first paint and would
 * otherwise add a third critical-path request for no measurable LCP gain.
 */
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";

export const fontSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const fontDisplay = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-jetbrains-mono",
});

/** All three CSS-variable classes, applied once on `<html>`. */
export const fontVariables = [
  fontSans.variable,
  fontDisplay.variable,
  fontMono.variable,
].join(" ");
