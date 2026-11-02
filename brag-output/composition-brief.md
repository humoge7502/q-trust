# Hyperframes Composition Brief: Q-Trust

## Objective

Create a 21.5-second launch-style brag video for Q-Trust: a post-quantum cryptography migration and attestation protocol. The film should feel like a quiet, premium security product film: precise, evidence-led, and confident enough to end on a warm editorial canvas.

## Output

- Composition directory: `C:\Users\Devesh tiwari\q-trust-projects\q-trust\brag-output\composition\`
- Rendered video: `C:\Users\Devesh tiwari\q-trust-projects\q-trust\brag-output\brag.mp4`
- Format: landscape â€” 1920x1080
- Duration: 21.5 seconds

## Source Material

- Project root: `C:\Users\Devesh tiwari\q-trust-projects\q-trust`
- Primary files read: `frontend/src/app/page.tsx`, `frontend/src/app/globals.css`, `frontend/src/components/product-preview.client.tsx`, `frontend/src/components/verify-box.client.tsx`, `frontend/src/app/dashboard/page.tsx`, `frontend/src/lib/fonts.ts`, `README.md`
- Product name: Q-Trust
- Tagline / strongest claim: "Make trust verifiable."
- Key UI or visual moment to recreate: the Q-Trust workspace preview â€” scan rail, 284-asset inventory, risk scores, migration status pills, and the public on-chain verification surface.
- Copy that must appear verbatim:
  - `Make trust verifiable.`
  - `The cryptographic migration layer for teams that need evidence, not promises.`
  - `RSA / ECC signatures disallowed.` (summarizing the NIST IR 8547 badge)
  - `Scan the estate`, `Score the exposure`, `Attest the progress`
  - `Every algorithm, mapped.`, `Every exposure, ranked.`, `Every milestone, signed.`
  - `Evidence, not promises.`
  - `Start with what you can prove.`
  - `Base L2 ready`, `Hash-only on-chain`, `Open verification`
  - `No wallet required.`
  - `Attestation verified`

## Creative Direction

- Tone preset: `polished`
- Creative direction: quiet premium cyber product film, with the restraint of a security audit and one bright editorial release at the end.
- Interpretation: fewer scenes, longer holds, precise 0.3â€“0.6s entrances. The product UI is the hero. Type is large and calm. SFX are tactile, not cinematic bombast. The color palette is Q-Trust's actual cyan / violet / emerald on slate, then a warm paper close.
- Angle: RSA has a retirement date. The video starts with the public NIST window, then proves the migration with a working scan, a ranked estate, and a public on-chain record.
- Hook: `NIST IR 8547` and `2030â€”2035` slam into a dark grid; a sample exposure ledger settles beside it.
- Outro / punchline: on a warm paper canvas, `Evidence, not promises.` resolves into `Start with what you can prove.` and the Q-Trust mark.
- Avoid:
  - Generic SaaS language.
  - Abstract cyber filler, matrix rain, equalizer bars, or pulsing neon orbs.
  - Unrelated visual redesign.
  - Fake customer names, real user data, API keys, or internal URLs.

## Visual Identity

- Background: `#020617` (dark product surface) / `#f4f5f2` (light editorial close)
- Text: `#f8fafc` on dark / `#0f172a` on light
- Accent: `#67e8f9` cyan; `#6ee7b7` emerald; `#a78bfa` violet; `#0a675f` teal for interactive/light-surface accents
- Display font: Inter Tight 600 (local `assets/fonts/InterTight-latin.woff2`)
- Body font: Inter 400 (local `assets/fonts/Inter-latin.woff2`)
- Mono font: JetBrains Mono 400/600 (local `assets/fonts/JetBrainsMono-latin.woff2`)
- Visual references from the project:
  - Hero grid and radial orbs from `globals.css`
  - Oversized editorial headline treatment from `page.tsx`
  - Product preview workspace structure and sample rows from `product-preview.client.tsx`
  - Public verification card language from `verify-box.client.tsx`
  - Rounded Q-Trust shield mark from `assets/logo-rounded.png`
  - The light section's `#f4f5f2` canvas and teal accents from the marketing page

## Storyboard

Use `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **The deadline** â€” 3.7s â€” NIST IR 8547, 2030â€”2035, RSA/ECC disallowed, AI sample exposure ledger.
2. **The claim** â€” 4.2s â€” MAKE TRUST / VERIFIABLE, stage rail (Scan / Score / Attest), tagline.
3. **The workspace** â€” 6.2s â€” cursor presses Run scan, progress, 284 / 39 / 68%, three asset rows, risk rail.
4. **The proof** â€” 4.4s â€” on-chain record, hash, EIP-712, Base Sepolia, public verifier, verified seal.
5. **The record leaves the room** â€” 3.0s â€” light canvas, Evidence, not promises, Start with what you can prove, URL and badges.

## Audio

- Audio role: warm bed with sparse professional accents.
- Audio arc: low controlled pulse through the product proof; one bell at verification; air under the final editorial line.
- Music: `assets/music/bed.mp3` â€” `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`, 114.84 BPM, first 21.5s.
- Music treatment: fade in over 0.9s to 0.32; sit under UI; ease to 0.28 for the close; fade out over the final 1.0s. Use a `data-automation` volume lane, not a volume tween.
- Music cue guidance: bundled preset read. Strong cues at 1.60s, 3.70s, 5.80s, 9.50s, 12.65s, 17.91s. Lock major reveals to 3.70s, 9.50s, and 17.91s within Â±0.15s. Sequential text is revealed as a readable set, not one line per beat.
- Audio-reactive treatment: subtle. The global radial glows breathe with low-band RMS, and the cyan rim on the final seal lifts with treble. No equalizers, waveform bars, or music-note graphics.
- Audio-coupled moments:
  - 1.60s â€” soft impact as the hook ledger settles
  - 3.70s â€” headline reveal impact
  - 8.45s â€” cursor click on Run scan
  - 9.50s â€” scan completion impact
  - 12.65s â€” risk rail accent
  - 17.91s â€” verified seal bell
  - 18.50s â€” final light-canvas cut, music lets the bell ring
- SFX selection guidance: use low/medium high-frequency-risk sounds. Tactile clicks, soft impacts, one bell. No whooshes on every card; no SFX over the final line.
- SFX analysis guidance: `C:\Users\Devesh tiwari\AppData\Local\Temp\opencode\brag-skill\skills\brag\assets\sfx\sfx-analysis.md`
- Exact SFX choice: implementer may select from the copied `assets/sfx/` set; keep the density sparse and the volumes below the music bed's perceived level.
- Audio files: `assets/music/bed.mp3`, `assets/sfx/*.ogg`.

## Hyperframes Instructions

Load the composition-building Hyperframes domain skills â€” `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-cli`. /brag is its own workflow: do not enter the generic `hyperframes` entry-point intent interview and do not route into its generic promo / launch-video workflow. Prefer native Hyperframes conventions.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep every text line readable in the final render.
- Keep the video within 15â€“25 seconds.
- Include the planned music/SFX layer.
- Use one paused GSAP timeline registered on `window.__timelines["main"]`.
- Use local fonts, music, SFX, GSAP, and logo. No render-time network requests.
- Run `npx hyperframes check` before render â€” the single gate.
- Keep creation and rendering local.

## Implementation Notes

- Single `index.html`, one root, five direct-child scene clips, one global decorative layer outside the clips.
- Root: `data-composition-id="main"`, `data-width="1920"`, `data-height="1080"`, `data-duration="21.5"`.
- Clips: `0â€“3.7`, `3.7â€“7.9`, `7.9â€“14.1`, `14.1â€“18.5`, `18.5â€“21.5`.
- Sample data is clearly labeled `SAMPLE DATA`. No real organization, person, credential, or internal hostname is shown.
- Typography: local `@font-face` for all three fonts.
- No `<br>` in body copy; use block spans for deliberate display line breaks.
- Use `overflow: hidden` on the frame and avoid text over decorative glows.

