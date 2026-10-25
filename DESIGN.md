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
