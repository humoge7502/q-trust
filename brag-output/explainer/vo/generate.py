import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(r"C:\Users\Devesh tiwari\q-trust-projects\q-trust\brag-output\explainer")
FFPROBE = Path(
    r"C:\Users\Devesh tiwari\AppData\Local\Microsoft\WinGet\Packages"
    r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffprobe.exe"
)


def duration(path: Path) -> float:
    out = subprocess.run(
        [str(FFPROBE), "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


async def main() -> None:
    spec = json.loads((ROOT / "vo" / "script.json").read_text(encoding="utf-8-sig"))
    out_dir = ROOT / "vo"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = []
    total = 0.0
    for line in spec["lines"]:
        target = out_dir / f"{line['id']}.mp3"
        communicate = edge_tts.Communicate(
            line["text"], spec["voice"], rate=line.get("rate", spec["rate"]), pitch=spec["pitch"]
        )
        words = []
        with open(target, "wb") as audio:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = chunk["offset"] / 10_000_000
                    words.append({
                        "text": chunk["text"],
                        "start": round(start, 3),
                        "end": round(start + chunk["duration"] / 10_000_000, 3),
                    })
        d = duration(target)
        total += d
        report.append({
            "id": line["id"],
            "scene": line["scene"],
            "duration": round(d, 3),
            "words": words,
        })
        print(f"{line['id']}  {line['scene']:<9} {d:6.2f}s  {len(words):2d} words")
    (out_dir / "timings.json").write_text(
        json.dumps({"lines": report, "total": round(total, 3)}, indent=2),
        encoding="utf-8",
    )
    print(f"\ntotal speech: {total:.2f}s")


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
asyncio.run(main())

