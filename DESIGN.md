# Q-Trust — Design System (DESIGN.md)

The locked visual system, captured 2026-10-24. Source of truth for tokens and
primitives: `frontend/src/app/globals.css` and `frontend/src/components/ui/`.
Refinements preserve this system; redesigns replace it deliberately
(impeccable doctrine). Audited against taste-skill's measured rules — the
waivers at the end are deliberate brand decisions, on the record.

## Structure

Two interlocking layers sharing one shell and type system:

- **Marketing layer** (dark chrome): `slate-950` ground, cyan-300 signal,
  violet/emerald secondary accents, editorial serif-free display type at
  extreme scale (`clamp(2.75rem, 8.6vw, 8.8rem)`, tracking −0.075em,
  leading 0.86).
- **Application layer** (light): `#f4f5f2` ground, `slate-950` ink, the
  semantic state palette below. `/scanner` and working surfaces live here.

## Tokens

- **Color**: brand `--color-qtrust-*` (50–950; 600+ for interactive fills,
  AA-checked). Risk: `--color-risk-{critical,high,medium,low,none}`. State
  (app layer): `--color-{success,danger,warning,info,neutral}` +
  `-surface`/`-border` pairs, each foreground checked against its OWN surface.
  Race tones: `--race-broken/-weakened/-safe`.
- **Type**: Inter Tight (display) · Inter (text) · JetBrains Mono (data
  readouts and code only — mono is the material for a cryptographic product).
  Body ≥ 14 px in the app layer, ≥ 16 px for running marketing copy.
  `tabular-nums` on every changing number.
- **Motion**: `--ease-brand: cubic-bezier(0.16,1,0.3,1)`,
  `--ease-brand-in`. UI feedback 100–250 ms; entrances via the `Reveal`
  component (16–32 px rise + opacity, 60–90 ms stagger); marketing moments may
  run longer. `.grow-in-x` (@starting-style + scaleX) for bar fills.
- **Radius**: one per nesting level; panels `rounded-2xl`, chips full-round.

## The craft floor (from the skill audits — all binding)

1. Never `transition: all`; never animate `width/height/top/left` —
   `transform`/`opacity` only (`clip-path` sanctioned).
2. Every animation ships with a reduced-motion path; the global kill-switch
   in `globals.css` stays authoritative.
3. Every interactive element has instant `:focus-visible`.
4. No `scale(0)` entrances (0.9–0.97 + opacity); `ease-out` family for
   entrances, `ease-in` never on UI.
5. Headlines set in ≤ 2 lines at every width (1440/768/390 verified by the
   taste inspector) — cut words first, then widen the measure, size last.
6. First screen answers "what is this" in ≥ 18 px alongside the headline.
7. No invented metrics, testimonials, or logos. No emoji as UI. No shadows on
   resting elements (tone steps instead); shadows only on true overlays and
   the floating product mock (`data-ui`).
8. Text ≥ 12 px from any viewport edge; content visible with scripting off.

## Primitives

`StatusPill`, `Panel`, `State`, `CodeBlock`, `VideoFrame` (poster required),
`MigrationRace` (signature; every number simulator-emitted), 
`DeadlineCountdown` (hydration-safe), `Reveal`, `VerifyBox`. App-layer
components consume the token layer — no raw palette utilities in new code
(the scanner dashboard was reduced from 101 to 4 as the proof).

## Deliberate waivers (on the record, per taste-skill's brand clause)

- **Eyebrow labels + tracked-caps micro-labels**: the editorial voice;
  banned by taste-skill, kept as brand (45 instances audited).
- **Index numbering (01/02/03)**: functional sequence markers in the
  workflow/race sections.
- **Hairline dividers**: the page rhythm of the marketing layer
  (`border-t` section tops).
- **Orb gradients**: the hero's two radial orbs (subtle, 0.2 alpha).
- **Three typefaces**: Inter/Inter Tight/JetBrains Mono with fixed roles.
- **14 px app-layer body**: data density is the product; running marketing
  copy is 16–18 px.

Changing any waiver is a redesign decision, not a refactor.

## 2026-11: Lattice refresh (design system v2)

Captured 2026-11-03 from the shipped tree (branch
`devesh/frontend-transformation`). This section extends the locked v1 system
above; it does not replace it. The v1 "Marketing layer" description (slate-950
ground, cyan-300 signal) now has named tokens — the values themselves did not
change.

### Tokens added (`@theme` in `frontend/src/app/globals.css`)

- **Night surface system** — the dark side of the theme, named once the way
  `--color-canvas` once named the light side: `--color-night` #020617 (the
  single dark canvas; was `bg-slate-950` everywhere), `--color-night-raised`
  #0b1220 (lifted cards/sheets), `--color-night-edge` #1e293b (decorative
  hairlines; carries no text). Ink ladder, each pair measured against
  `--color-night`: `--color-night-ink` #e2e8f0 = **16.4:1**,
  `--color-night-ink-soft` #94a3b8 = **7.9:1**, `--color-night-ink-faint`
  #64748b = **4.23:1 — reserved for non-text roles only** (placeholder tints,
  decorative strokes; below the 4.5:1 AA text minimum). Text on dark uses
  night-ink or night-ink-soft.
- **Quantum accent** — the cyan family that already carried every
  live/on-chain/verified cue as raw literals, now auditable like the risk
  scale: `--color-quantum` #22d3ee (cyan-400, primary accent on dark),
  `--color-quantum-soft` #67e8f9 (cyan-300, bright/hover),
  `--color-quantum-dim` #0e7490 (cyan-700, pressed/subdued edge).
- **Display type roles** — the marketing scale was per-section `clamp()`
  literals; it is now a token decision, with line-height and tracking applied
  automatically by Tailwind v4: `--text-hero` clamp(2.75rem, 8.6vw, 8.8rem) /
  leading 0.86 / −0.075em; `--text-display-xl` clamp(2.5rem, 5.5vw, 6rem) /
  0.9 / −0.06em; `--text-display-lg` clamp(2.25rem, 4.5vw, 4rem) / 0.95 /
  −0.055em.
- The state triplets (success/danger/warning/info/neutral) are unchanged. New
  CSS beside the tokens: `html.lenis-on` scroll handoff and the `.hero-line`
  staggered clip-rise choreography — both inert under reduced motion.

### Motion: division of labour

- **Entrances** stay with CSS + IntersectionObserver (`Reveal` /
  `scroll-effects.client.tsx`) — they work without JavaScript and are
  reduced-motion safe. Unchanged by this refresh.
- **GSAP + ScrollTrigger owns only what CSS cannot express**: scroll scrub
  and activation. `components/motion/workflow-story.client.tsx` scrubs the
  vertical rail and flips step-node state inside a `gsap.matchMedia()` scope
  of desktop × no-preference-motion; `components/ui/count-up.client.tsx`
  tweens a plain object and writes `textContent` directly, so high-frequency
  animation never touches React state.
- **Lenis** (`components/motion/smooth-scroll.client.tsx`) smooths story
  routes only — deliberately not mounted in the root layout, so app surfaces
  (scanner, dashboard, forms) and the e2e suite keep native scrolling.
  Guards, in order: `navigator.webdriver` → native;
  `prefers-reduced-motion: reduce` → native; any throw → native. Lenis is
  driven from GSAP's ticker so both systems share one clock.
- **WebGL lattice hero** (`components/motion/lattice-field.client.tsx`) — a
  hand-written WebGL1 shader (~3KB, no three.js; the LCP/CLS budgets and the
  honesty rules forbid a renderer dependency for a background). DPR capped
  (1.75, 1.25 below 768px), one fullscreen quad, drawing paused while the
  hero is offscreen or the tab is hidden, canvas absolutely positioned under
  the content so it can never affect layout. Progressive enhancement, in
  order: reduced motion → not mounted (the `.hero-grid` CSS stands alone);
  no WebGL context → CSS remains; context lost at runtime → drawing stops.
- Everything is dynamically imported — GSAP/Lenis never touch the initial
  bundle or the server build. `lib/motion.ts` is the single registration
  point.

### The token ratchet (binding, new)

No new raw palette utilities (`text-slate-600`, `bg-[#f4f5f2]` and friends).
The gate is `node scripts/lint_tokens.mjs` from the repo root: it counts raw
palette classes in `frontend/src`, records the number in
`.hallmark/token-baseline.json`, and fails only when the count increases.
Baseline at this refresh: **102**, down from the 752 recorded when the
ratchet was initialized. Each cleanup lowers it; nothing may raise it.

### Page-header pattern (copy this on new pages)

The unified app-layer header, as shipped on `/scanner`, `/v`, `/certify`,
`/dashboard` and `/vendors` (the `/scanner` header block names the pattern in
a comment):

- Eyebrow: `font-mono text-micro font-semibold uppercase tracking-[0.16em] text-muted-foreground`.
  The `/scanner` and `/certify` variant adds a `h-px w-10 bg-qtrust-600` dash
  and widens tracking to `tracking-[0.28em]`.
- Title: `font-display text-3xl font-semibold leading-[0.95] tracking-[-0.04em] text-foreground sm:text-4xl`.
- Lede: `mt-5 max-w-xl text-sm leading-6 text-muted-foreground sm:mt-6 sm:text-base sm:leading-7`,
  inside a `header.border-b.border-border.bg-canvas`.

### Waivers

The v1 waiver list above remains in force for everything it covered that
still exists: tracked-caps eyebrows and micro-labels (now the unified header
system), index numbering (01/02/03 — still the workflow story), hairline
dividers, the hero orbs, the three-typeface system, and the 14px app-layer
body. The orb-gradients waiver now sits on top of the WebGL lattice field.
