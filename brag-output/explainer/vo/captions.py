"""Build caption cues from the recorded voice-over timings.

edge-tts only returns sentence boundaries, so within a line each cue's share of
the audio is estimated from its character weight plus a small punctuation pause.
The result is accurate to a few tenths of a second and, more importantly,
deterministic: re-running this after a script edit regenerates both the cues and
their absolute in/out times.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust\brag-output\explainer")
VO_START = {
    "vo-01": 0.35,
    "vo-02": 9.95,
    "vo-03": 20.25,
    "vo-04": 31.75,
    "vo-05": 44.55,
    "vo-06": 53.25,
    "vo-07": 65.65,
    "vo-08": 76.35,
    "vo-09": 87.75,
}

CUES: dict[str, list[str]] = {
    "vo-01": [
        "The algorithms protecting most of today's data",
        "are already <b>obsolete</b>.",
        "Attackers are recording traffic now,",
        "waiting for the day they can read it.",
    ],
    "vo-02": [
        "Q-Trust is the operating system for the migration.",
        "Scan the estate.",
        "Rank the exposure.",
        "Plan the move.",
        "Anchor the evidence.",
        "Let <b>anyone</b> verify it.",
    ],
    "vo-03": [
        "It starts with a scan.",
        "Q-Trust reads source code and dependency manifests,",
        "and maps every algorithm in use.",
        "Here: <b>twenty findings</b> across three services.",
    ],
    "vo-04": [
        "Each finding gets a harvest-now-decrypt-later score.",
        "The gateway's RSA key: <b>eighty-four</b>.",
        "The payments key, <b>the same</b>.",
        "The mobile exchange uses <b>ML-KEM-768</b> &mdash; and scores ten.",
    ],
    "vo-05": [
        "The planner turns those scores into an ordered roadmap:",
        "what to migrate first,",
        "and which evidence each step must produce.",
    ],
    "vo-06": [
        "Every step writes an evidence record.",
        "<b>Only its hash</b> goes on chain, to Base Sepolia.",
        "The evidence never leaves the organization.",
        "Anyone can check the hash.",
        "No one can read the file.",
    ],
    "vo-07": [
        "Paste an asset ID, and Q-Trust reads the registry directly.",
        "<b>No wallet. No account.</b>",
        "The record is verified,",
        "and the transaction is public.",
    ],
    "vo-08": [
        "Vendors publish the same way.",
        "Connect a wallet, sign the claim with EIP-712,",
        "and Q-Trust relays it gaslessly.",
        "But only for wallets holding the <b>vendor role</b>.",
    ],
}


def weight(cue: str) -> float:
    text = re.sub(r"<[^>]+>", "", cue)
    base = len(text.replace(" ", ""))
    pause = 0.0
    if text.rstrip().endswith((".", "!", "?")):
        pause = 11.0
    elif text.rstrip().endswith((",", ";", ":")):
        pause = 5.0
    if "&mdash;" in cue or "\u2014" in cue:
        pause += 4.0
    return base + pause


def main() -> None:
    timings = json.loads((ROOT / "vo" / "timings.json").read_text(encoding="utf-8"))
    rows = []
    for line in timings["lines"]:
        cues = CUES.get(line["id"])
        if not cues:
            continue
        start_abs = VO_START[line["id"]]
        duration = line["duration"]
        weights = [weight(c) for c in cues]
        total = sum(weights)
        cursor = start_abs
        for index, (cue, w) in enumerate(zip(cues, weights)):
            share = duration * (w / total)
            end = cursor + share
            # Small gap between cues so they never overlap mid-crossfade.
            out = end - 0.05 if index < len(cues) - 1 else end
            rows.append((cursor, out, cue))
            cursor = end

    html = []
    for start, end, cue in rows:
        html.append(
            f'          <div class="cue" data-in="{start:.2f}" data-out="{end:.2f}">{cue}</div>'
        )
    block = "\n".join(html)

    index_path = ROOT / "index.html"
    html_doc = index_path.read_text(encoding="utf-8")
    pattern = re.compile(r"(<!-- CAPTIONS:START -->)(.*?)(<!-- CAPTIONS:END -->)", re.S)
    if not pattern.search(html_doc):
        raise SystemExit("caption markers not found in index.html")
    html_doc = pattern.sub(lambda m: f"{m.group(1)}\n{block}\n          {m.group(3)}", html_doc)
    index_path.write_text(html_doc, encoding="utf-8")

    (ROOT / "vo" / "captions.json").write_text(
        json.dumps([{"start": round(s, 2), "end": round(e, 2), "text": t} for s, e, t in rows], indent=2),
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} cues")
    for s, e, t in rows:
        print(f"  {s:6.2f} -> {e:6.2f}  {re.sub(r'<[^>]+>', '', t)}")


if __name__ == "__main__":
    main()
