# Q-Trust launch video (`brag` workflow)

The Q-Trust launch film, built with the
[`brag`](https://github.com/latent-spaces/brag) workflow as a
[HyperFrames](https://hyperframes.heygen.com) composition.

| File | What it is |
|---|---|
| `brag.mp4` | Rendered master — 1920x1080, 30 fps, 21.5 s, H.264 + AAC, -18.7 LUFS integrated / -3.1 dBFS true peak |
| `brag.jpg` | Poster frame (20.2 s, the light finale) |
| `brag-plan.md` | Creative contract: narrative, scene timing, copy, audio direction |
| `composition-brief.md` | Implementation brief for the composition |
| `composition/` | The HyperFrames composition (HTML + CSS + assets) |

## Scenes

| Window | Scene |
|---|---|
| 0.0 – 3.7 s | The deadline — NIST IR 8547, `2030—2035` |
| 3.7 – 7.9 s | The claim — "Make trust verifiable", scan / score / attest |
| 7.9 – 14.1 s | The workspace — 284 assets, 39 at risk, 68 % PQC ready |
| 14.1 – 18.5 s | The proof — public verifier, no wallet, verified seal |
| 18.5 – 21.5 s | The finale — the light editorial canvas, `q-trust-nu.vercel.app` |

The on-screen data is the real seeded workspace and the real Base Sepolia
records (migration `0x014e6d93…a794fe8e`, verification tx
`0x2070b8ec…7d16ee`). No mock numbers are shown in the product surfaces.

## Explainer (narrated, 92.6 s)

| File | What it is |
|---|---|
| `explainer.mp4` | Rendered explainer - 1920x1080, 30 fps, 1:32.6, H.264 + AAC, -18.0 LUFS integrated / -2.7 dBTP |
| `explainer.jpg` | Poster frame (1:30.6, the finale with the live URL) |
| `explainer/` | HyperFrames composition, VO script + audio, captions, captured UI frames |

Nine scenes:

| Window | Scene |
|---|---|
| 0.0 - 9.6 s | Harvest now, decrypt later - the recorder, the 2030-2035 deadline |
| 9.6 - 19.9 s | The operating loop - scan, rank, plan, anchor, verify |
| 19.9 - 31.4 s | Scan - the live scanner against the demo estate (20 findings, 3 services) |
| 31.4 - 44.2 s | Rank - real risk scores (RSA 84, ECDSA 84, ML-KEM-768 10) |
| 44.2 - 52.9 s | Plan - the roadmap with effort, cost and completion date |
| 52.9 - 65.3 s | Anchor - the hash-only record on Base Sepolia |
| 65.3 - 76.0 s | Verify - the public verdict, no wallet required |
| 76.0 - 87.4 s | Vendor - connected wallet, gasless attestations, EIP-712, VENDOR_ROLE, zero gas |
| 87.4 - 92.6 s | Finale - "Make trust verifiable", the live URL |

The product tour uses real 1600x900 captures of the running app
(`frontend/scripts/capture-explainer-ui.mjs`) against
`deploy/demo-estate`, and the seeded Base Sepolia record. Voiceover: nine
edge-tts clips (`en-US-AndrewNeural`, -2 % rate, -4 Hz pitch; line 4 at
+12 % to fit), 84.46 s of speech, mixed under `bed.mp3` at 0.30 with
captions generated from `vo/timings.json`. Rebuild the voice with
`vo/generate.py`, regenerate captions with `vo/captions.py`.

### Re-render the explainer

```bash
cd explainer
npx hyperframes check
npx hyperframes render -o ../explainer.mp4 --quality delivery --fps 30
```

The check passes with 0 errors; contrast is 95/95 WCAG AA, layout and motion
report no issues. The three remaining warnings are advisory (single-file
composition size / nested sections).

`explainer/assets/music/bed.mp3` is the same third-party library track as the
teaser (first 87.6 s), not committed - restore it before re-rendering.

## Re-render

```bash
cd composition
npx hyperframes check                                   # lint + runtime + layout + motion + contrast
npx hyperframes render -o ../brag.mp4 --quality delivery --fps 30
```

`npx hyperframes check` currently reports 0 errors across lint, runtime,
layout and motion, with 156/156 WCAG AA contrast checks passing.

### Assets

`assets/music/bed.mp3` is not committed — it is a third-party library track.
Restore it from `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`
(first 21.5 s) before re-rendering. The local fonts (Inter, Inter Tight,
JetBrains Mono), the SFX and the logo are committed under `composition/assets/`.
