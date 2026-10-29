"""Build the lightweight README animation from the full-quality introduction film."""

import json
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/media/sparkflow-intro.mp4"
TARGET = ROOT / "docs/media/sparkflow-preview-hd.webp"
CUTS = [(4.5, 6.5), (10.5, 12.5), (16.5, 18.5), (40.0, 42.0)]


def main():
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("FFmpeg is required and must be available on PATH.")
    if not SOURCE.is_file():
        raise SystemExit(f"Source video not found: {SOURCE}")

    filters = [
        f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{index}]"
        for index, (start, end) in enumerate(CUTS)
    ]
    filters.append(
        "".join(f"[v{index}]" for index in range(len(CUTS)))
        + f"concat=n={len(CUTS)}:v=1:a=0,fps=30,"
        + "scale=1600:-1:flags=lanczos,format=yuv420p[out]"
    )
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-i", str(SOURCE), "-filter_complex", ";".join(filters),
            "-map", "[out]", "-an", "-c:v", "libwebp_anim",
            "-quality", "76", "-compression_level", "5", "-loop", "0",
            str(TARGET),
        ],
        check=True,
    )
    print(json.dumps({"file": str(TARGET), "bytes": TARGET.stat().st_size}))


if __name__ == "__main__":
    main()
