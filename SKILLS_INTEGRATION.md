# Skills Integration — Q-Trust

**Date:** 2026-10-24
**Purpose:** Record every skill installed for this project, its source, what it contributes, and where it is applied. This makes the toolchain reproducible and auditable.

## How skills are installed (two directories)

The `skills` CLI (`npx skills add`) installs into the **universal** `.agents/skills/` directory (read by Cline, Codex, Cursor, Copilot, OpenCode, Claude Code). WorkBuddy reads `.workbuddy-ai/skills/` (project) and `~/.workbuddy-ai/skills/` (user). Every skill is **copied** from `.agents/skills/` into `.workbuddy-ai/skills/` so both harnesses see it:

```bash
npx -y skills add <owner/repo> -y -s '<skill>'   # installs to .agents/skills/
cp -r .agents/skills/* .workbuddy-ai/skills/      # bridge into WorkBuddy
```

> PromptScript-format skills (taste-skill, hallmark, emilkowalski) do **not** support `--global`; they must be installed at project level (no `-g`).

## Installed skills (21)

### Design / frontend (13)

| Skill | Source | Contributes to Q-Trust | Applied |
|---|---|---|---|
| **impeccable** | `pbakaus/impeccable` (user-level) | 30-reference design toolkit: audit, critique, harden, optimize, polish, a11y, motion, typography, color | Design review of `/scanner`, `/research`, `/compare` |
| **design-taste-frontend** | `Leonxlnx/taste-skill` | Anti-slop art direction from 247 gallery sites; real-browser inspector; look-and-fix loop | Section composition + house-style check on marketing pages |
| **hallmark** | `nutlope/hallmark` | 16-rule "Floor" (token-only colour, no `transition: all`, no `100vw`, focus-visible, reduced-motion, no invented metrics) + `sloplint.mjs` | **Ran `sloplint` on `frontend/src` → 214 → 194 fails**; fixed gate 33 |
| **emil-design-eng** | `emilkowalski/skills` | Design-engineering craft bar (spacing, states, micro-interaction) | Motion/state review of interactive panels |
| **mobile-native** | `emilkowalski/skills` | The CSS/meta fixes that make a web app feel native (sticky hover, 100vh, tap highlight, safe-area) | Mobile pass on `/scanner`, bottom nav |
| **animate** / **animation-performance** / **animation-vocabulary** | `emilkowalski/skills` | Motion vocabulary + perf (transform/opacity only) | Motion audit of the scanner + demo |
| **find-animation-opportunities** | `emilkowalski/skills` | Proposes where motion adds meaning (read-only) | Candidate list for `/research` + `/compare` |
| **improve-animations** / **review-animations** | `emilkowalski/skills` | Prioritized motion audit + review against a craft bar | Review of existing transitions |
| **apple-design** | `emilkowalski/skills` | Apple HIG patterns for polish/consistency | Reference for control states |
| **break-ui** | `emilkowalski/skills` | Stress-test layouts at breakpoints | Responsive stress test |
| **ask-sonner** | `emilkowalski/skills` | Toast/notification patterns | Toast UX review |
| **prototype** / **pick-ui-library** | `emilkowalski/skills` | Multi-variant UI prototypes; library selection | Component-choice reference |

### Security / testing / stack (8)

| Skill | Source | Contributes to Q-Trust | Applied |
|---|---|---|---|
| **solidity-security** | `wshobson/agents` | Solidity threat model: reentrancy, upgrade safety, access control, oracle/price, signature replay | **SEC-04/SEC-05** recommendations (slither/echidna, storage-layout diff) |
| **property-based-testing** | `trailofbits/skills` | Hypothesis/property methodology from Trail of Bits | **QUAL-02**: deepen inspector evidence-chain + parser tests |
| **vercel-react-best-practices** | `vercel-labs/agent-skills` | React 19 / Next.js 15 patterns (server/client split, memo, streaming, data fetching) | **QUAL-01/PERF**: `any` cleanup, `scanner-dashboard` split guidance |
| **supabase-postgres-best-practices** | `supabase/agent-skills` | Postgres schema/index/query patterns, RLS, connection pooling | **ARCH-03**: indexer leader-election + idempotent upserts |
| **impeccable** (also design) | — | — | — |

> Count: 13 design + 8 stack = 21 entries (impeccable counted once in design).

## Where each audit's output lives

| Artifact | Produced by | Content |
|---|---|---|
| `.hallmark/sloplint.json` | `hallmark/scripts/sloplint.mjs` | Full 194-finding Floor audit (gate, file, line, evidence, fix) |
| `.hallmark/token-baseline.json` | `scripts/lint_tokens.mjs` | Raw-palette ratchet baseline (847) |
| `COMPREHENSIVE_ANALYSIS_AND_ROADMAP.md` | synthesis | All findings mapped to severity/priority/effort/timeline |

## What was actually changed this pass (skill-driven)

1. **A11y (hallmark gate 33):** 20 `<svg>` elements lacked `aria-hidden`/`aria-label`. Fixed `icons.tsx` (16 icons — decorative by default, caller-overridable), the scanner spinner + checkmark, the provenance arrow, and the header menu/close icons. **sloplint gate 33: 20 → 0; total 214 → 194.** Verified: `tsc` clean, frontend **150/150** tests pass.
2. **Design-token ratchet:** new `scripts/lint_tokens.mjs` + `.hallmark/token-baseline.json` (847) wired into the `frontend` CI job — the raw-palette count can no longer grow. Implements hallmark Floor rule 1 / sloplint gate 48.
3. **Analysis corrections:** verified CI already gates Playwright/forge/qtrust-ai; corrected the (wrong) "not CI-gated" claim; confirmed the real gap is no slither/echidna.

## Reproduce the audits

```bash
# Full Floor audit (hallmark)
node .agents/skills/hallmark/scripts/sloplint.mjs frontend/src --scope app --tier floor --json > .hallmark/sloplint.json

# Design-token ratchet
node scripts/lint_tokens.mjs            # check
node scripts/lint_tokens.mjs --update   # lower baseline after cleanup

# Dependency advisories (the exact CI gate)
cd frontend && npm audit --omit=dev --audit-level=high
```

## Maintenance

- **Update skills:** `npx -y skills update` (or re-add). Re-copy to `.workbuddy-ai/skills/` after updates.
- **Lower the token baseline** only when you have actually removed raw palette classes (`--update`).
- **Do not** delete `.agents/skills/` or `.workbuddy-ai/skills/` — they are the installed toolchain, not cache.
