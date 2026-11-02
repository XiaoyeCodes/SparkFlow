"""Encode the entire introduction film as the looping GIF used by the README.

The generated binary belongs in GitHub Releases, outside Git history.
"""

import argparse
import json
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable or path")
    parser.add_argument("--source", type=Path, default=ROOT / "docs/media/sparkflow-intro.mp4")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/sparkflow-intro.gif")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    ffmpeg = shutil.which(args.ffmpeg)
    if not ffmpeg:
        parser.error("FFmpeg is required; add it to PATH or use --ffmpeg.")
    source = args.source.resolve()
    target = args.output.resolve()
    if not source.is_file():
        parser.error(f"Source video not found: {source}")
    if source == target:
        parser.error("Output must differ from the source video.")
    if target.suffix.lower() != ".gif":
        parser.error("Output must have a .gif extension.")
    if target.exists() and not args.overwrite:
        parser.error(f"Output already exists: {target}; use --overwrite to replace it.")

    target.parent.mkdir(parents=True, exist_ok=True)
    filters = (
        "fps=20,scale=960:-1:flags=lanczos,split[a][b];"
        "[a]palettegen=stats_mode=diff:max_colors=128[p];"
        "[b][p]paletteuse=dither=none:diff_mode=rectangle"
    )
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "warning", "-nostdin",
            "-y" if args.overwrite else "-n", "-i", str(source),
            "-filter_complex_threads", "1", "-filter_complex", filters,
            "-an", "-loop", "0", "-final_delay", "5", str(target),
        ],
        check=True,
    )
    print(json.dumps({"file": str(target), "bytes": target.stat().st_size, "fps": 20}))


if __name__ == "__main__":
    main()
