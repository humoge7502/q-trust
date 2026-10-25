# Q-Trust — AI-Agent Design & Engineering Skill Registry

The project's skill system: which skills are installed, what each governs,
how they are applied, and which toolkits were **deliberately rejected** (with
reasons — so future sessions don't re-litigate or stack competing rules).
Clones live in the sibling `.skills-cache/` directory (outside git).

## Active skills (applied to this codebase)

| Skill | Source | Governs | How it's applied here |
|---|---|---|---|
| **taste-skill** | Leonxlnx/taste-skill | Anti-slop house rules from a 247-site measured study | `scripts/lint.mjs` (source patterns) + `scripts/inspect.mjs` (real-browser audit at 1440/768/390). Artifacts: `.taste-skill/inspect/`. Deliberate brand waivers are documented in DESIGN.md. |
| **impeccable** | pbakaus/impeccable | Modes (Persuade/Operate/Read/Experience), refine-vs-redesign doctrine, craft floor | Drove `PRODUCT.md` + `DESIGN.md` (the locked system). Mode column in PRODUCT.md's surface table. |
| **hallmark** | nutlope/hallmark | The Floor: hard bans (no `transition: all`, no width-animation, no emoji-as-UI, no invented metrics, focus-visible everywhere, reduced-motion fallbacks) | Binding floor for all new UI; violations are craft-bug class. |
| **emilkowalski/skills** (animate, improve-animations, animation-vocabulary) | emilkowalski/skills | Motion craft: purpose gate, easing tokens, `transform`/`opacity` only, frequency tiers, reduced motion | `--ease-brand` token system; `.grow-in-x` (@starting-style scaleX); Migration Race animation passes the never-ship checklist. |
| **vercel web-interface-guidelines** | vercel-labs/web-interface-guidelines | Interface quality checklist (forms, focus, typography, touch, safe areas) | Review gate for new surfaces; drove poster/edge-text/`touch-action`-class fixes. |
| **ui-ux-pro-max** | nextlevelbuilder/ui-ux-pro-max-skill | Searchable design intelligence (119 UX guidelines, palettes, font pairings) | Query via `python .skills-cache/ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux`. Drove command-palette (combobox/listbox a11y) and skeleton guidance. |
| **addyosmani agent-skills** (frontend-ui-engineering) | addyosmani/agent-skills | Production-quality UI: state patterns, skeletons-not-spinners, empty/error states, WCAG 2.1 AA, "no AI aesthetic" table | Drove scanner content-area skeletons; state-handling checklist for new components. |

## Deliberately rejected (do not add without a redesign decision)

| Toolkit | Why rejected |
|---|---|
| **Magic UI / Aceternity UI / React Bits** effects (spotlight cards, beams, animated borders, glows) | Their vocabulary is what the measured 247-site study scores *lower*; DESIGN.md's craft floor bans gradient/glow decoration. Adding them would invert the project's evidenced direction. |
| **GSAP / React Three Fiber** | No scroll-storytelling or 3D requirement; Emil's "cheapest tool that works" rule — CSS transitions + `@starting-style` cover current needs; R3F bundle cost unjustified. |
| **Framer Motion / Motion** | Same rule: no layout animations or gesture physics in current surfaces; revisit only if drag/shared-element needs appear. |
| **Storybook** | Component states are already covered by vitest + Playwright axe gates at two viewports; Storybook's maintenance cost isn't paid for yet. |
| Stacking additional overlapping design skills | The pasted-toolkit advice itself: competing rule sets reduce consistency. The registry above is the allowed set. |

## The workflow (how skills are applied here)

1. **Audit**: run `inspect.mjs <url>` (taste) + axe e2e + the Vercel checklist.
2. **Decide within DESIGN.md**: new UI consumes tokens/primitives; waivers are
   written down, never silent.
3. **Build** with the craft floor (hallmark) + motion rules (Emil) + state
   completeness (Addy: loading/empty/error/disabled/focus).
4. **Verify**: tsc, eslint (React-Compiler rules), vitest, Playwright
   a11y+smoke+CWV, re-run the taste inspector, and *look at the screenshots*.

## Session log

- 2026-10-23: taste/impeccable/hallmark/emil/vercel integrated; 13 measured
  fixes; PRODUCT.md + DESIGN.md locked.
- 2026-10-26: ui-ux-pro-max + addyosmani/frontend-ui-engineering integrated;
  command palette (⌘K) + scanner content skeletons shipped from their gaps.
