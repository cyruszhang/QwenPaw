# -*- coding: utf-8 -*-
"""Pillow-per-frame text-overlay renderer for intro / outro scenes.

Why Pillow + per-frame and not ffmpeg ``drawtext``: drawtext's
animated-alpha support is uneven across ffmpeg builds (libavfilter
quirks around the ``alpha`` expression), and the director-skill
production hardened this Pillow approach across v1→v4. Slower (~10s
for a 5-second 30fps intro on M-series), but reliable everywhere.

Flow:
  ffmpeg → extract frames as PNG → for each frame compute alpha for
  every overlay (fade in/out) → Pillow draws shadow + text → ffmpeg
  re-encodes the frame sequence and muxes the original Wan audio back.

Font lookup falls back through common system locations; macOS users get
SF Pro / Helvetica, Linux users get DejaVu Sans. See FONT_CANDIDATES.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ffmpeg_recipes import (
    encode_frames_with_audio,
    extract_frames,
    probe_duration,
    probe_video_info,
)
from spec import OverlaySpec

logger = logging.getLogger(__name__)


FPS = 30

# Fallback font search — first hit wins. macOS first since that's the
# dev environment; Linux second for CI.
FONT_CANDIDATES = [
    # macOS
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/SFNSDisplay.ttf",
    # Linux
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
]


def _resolve_font_path() -> str:
    """Return the first font that exists, or raise."""
    for cand in FONT_CANDIDATES:
        if Path(cand).is_file():
            return cand
    raise FileNotFoundError(
        "No usable font found. Tried:\n  " + "\n  ".join(FONT_CANDIDATES),
    )


def _alpha_for(t: float, duration: float, spec: OverlaySpec) -> float:
    """Compute the per-frame alpha (0.0..1.0) for an overlay at time t.

    Fade in over ``spec.fade_in_s`` from the start; fade out over
    ``spec.fade_out_s`` before the end. Holds at 1.0 between.
    """
    alpha = 1.0
    if spec.fade_in_s > 0 and t < spec.fade_in_s:
        alpha = t / spec.fade_in_s
    if spec.fade_out_s > 0 and t > duration - spec.fade_out_s:
        alpha = max(0.0, (duration - t) / spec.fade_out_s)
    return max(0.0, min(1.0, alpha))


def render_overlays_on_video(
    raw_video: Path,
    overlays: list[OverlaySpec],
    output: Path,
    *,
    work_dir: Path | None = None,
    fps: int = FPS,
) -> None:
    """Apply a list of text overlays to a video, preserving audio.

    Args:
        raw_video: Input MP4 (typically ``{##}_{name}_raw.mp4`` from
            Stage 03 — the Wan output with its ambient audio track).
        overlays: List of OverlaySpec — order doesn't matter; alpha is
            computed independently per overlay per frame.
        output: Target MP4 (typically ``{##}_{name}_text.mp4``).
        work_dir: Optional dir for extracted/edited frames. When None,
            uses ``output.parent / f".{output.stem}_frames"``. Cleaned
            up on success.
        fps: Sample/re-encode rate. Default 30.
    """
    if not raw_video.exists():
        raise FileNotFoundError(f"raw_video not found: {raw_video}")
    if not overlays:
        # No overlays → just copy the file.
        shutil.copy2(raw_video, output)
        return

    font_path = _resolve_font_path()
    duration = _probe_duration_s(raw_video)
    logger.info(
        f"Overlay render: {raw_video.name} → {output.name} "
        f"({duration:.2f}s, {len(overlays)} overlay(s))",
    )

    if work_dir is None:
        work_dir = output.parent / f".{output.stem}_frames"
    in_frames = work_dir / "in"
    out_frames = work_dir / "out"
    in_frames.mkdir(parents=True, exist_ok=True)
    out_frames.mkdir(parents=True, exist_ok=True)

    # Extract every input frame.
    _run(extract_frames(raw_video, in_frames, fps=fps))
    frame_files = sorted(in_frames.glob("frame_*.png"))
    if not frame_files:
        raise RuntimeError(f"No frames extracted from {raw_video}")

    # Per-frame Pillow draw.
    n = len(frame_files)
    for i, frame_path in enumerate(frame_files):
        t = i / fps
        img = Image.open(frame_path).convert("RGBA")
        draw = ImageDraw.Draw(img)
        w, h = img.size

        for spec in overlays:
            alpha = _alpha_for(t, duration, spec)
            if alpha <= 0.0:
                continue
            font = ImageFont.truetype(font_path, spec.font_size)
            bbox = draw.textbbox((0, 0), spec.text, font=font)
            text_w = bbox[2] - bbox[0]
            x = (w - text_w) // 2
            y = int(h * spec.y_ratio)

            # Shadow: black, lighter alpha, offset 3px down-right.
            draw.text(
                (x + 3, y + 3), spec.text, font=font,
                fill=(0, 0, 0, int(180 * alpha)),
            )
            # Text: white.
            draw.text(
                (x, y), spec.text, font=font,
                fill=(255, 255, 255, int(255 * alpha)),
            )

        out_path = out_frames / f"frame_{i + 1:04d}.png"
        img.convert("RGB").save(out_path)

    # Re-encode the edited frames; preserve the original audio if the
    # raw scene has one. Seedance / HappyHorse return silent video, so
    # detect first and skip the audio map when absent.
    has_audio = _has_audio_stream(raw_video)
    _run(encode_frames_with_audio(
        frame_pattern=str(out_frames / "frame_%04d.png"),
        audio_source=raw_video,
        output=output,
        fps=fps,
        has_audio=has_audio,
    ))

    # Clean up the frame work dir on success.
    shutil.rmtree(work_dir, ignore_errors=True)

    logger.info(
        f"Overlay render done: {output.name} "
        f"({n} frames, font={Path(font_path).name})",
    )


def _probe_duration_s(media: Path) -> float:
    """ffprobe a media file's duration in seconds (float)."""
    res = subprocess.run(
        probe_duration(media),
        capture_output=True, text=True, check=True,
    )
    return float(res.stdout.strip())


def _has_audio_stream(media: Path) -> bool:
    """True iff ``media`` has at least one audio stream.

    Probes via ``probe_video_info`` (which prints one row per stream
    in csv form including ``codec_type``) and looks for ``audio``.
    """
    res = subprocess.run(
        probe_video_info(media),
        capture_output=True, text=True, check=False,
    )
    return "audio" in (res.stdout or "")


def _run(argv: list[str]) -> None:
    """Run an ffmpeg / ffprobe argv list, raising on non-zero exit."""
    logger.debug("$ %s", " ".join(argv))
    res = subprocess.run(argv, capture_output=True, text=True)
    if res.returncode != 0:
        # Surface the last 20 stderr lines — ffmpeg errors are usually
        # buried at the bottom.
        tail = "\n".join(res.stderr.splitlines()[-20:])
        raise RuntimeError(
            f"Command failed (rc={res.returncode}):\n"
            f"  $ {' '.join(argv[:6])}...\n"
            f"---stderr tail---\n{tail}",
        )


if __name__ == "__main__":
    # Smoke test: python overlays_render.py <input.mp4> <output.mp4>
    logging.basicConfig(level=logging.INFO)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    sample = [
        OverlaySpec("Hello, world", 0.30, 56, 0.5, 0.0),
        OverlaySpec("smoke test", 0.42, 26, 1.5, 0.5),
    ]
    render_overlays_on_video(src, sample, dst)
    print(f"Wrote {dst}")
