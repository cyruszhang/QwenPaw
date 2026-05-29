# -*- coding: utf-8 -*-
"""ffmpeg recipes — the production knowledge from director-SKILL.md.

Each function builds an ffmpeg argv list. No execution here; the stage
modules call subprocess.run. Keeping these as pure list-builders makes
them trivial to inspect (and grep) — a real benefit when an encoding
quirk shows up six months from now.

The flags below are NOT speculative — they're hardened across v1→v4 of
the Old Man and the Sea production pipeline. Specifically:

- ``-g 30 -keyint_min 30`` per scene → keyframes every 1s at 30fps,
  needed so browser playback doesn't stall at scene boundaries.
- concat *filter* (not demuxer) for the final stitch → re-encodes,
  produces a single clean GOP. Demuxer with ``-c copy`` breaks browser
  playback when the inputs have different encoding parameters.
- AAC at 48kHz / 192k / 2-channel → uniform across all scenes; mixed
  sample-rates / channel counts silence audio after concat.
- 1920×816 letterboxed in 1920×1080 → fixed content area, identical
  letterbox bars per scene (132px top + bottom). Without this, each
  scene gets padded at its native AR and the letterbox bar height
  jitters between cuts.

References for non-obvious choices live in director-SKILL.md §4 (Audio
Mixing), §5 (Smart-Crop), §8 (Uniform Scale + Concat).
"""

from __future__ import annotations

from pathlib import Path


# Final content area + canvas — used by both the per-scene scale pass
# and the final concat. Must stay in sync.
CONTENT_W = 1920
CONTENT_H = 816   # 2.35:1 cinema; must be even (yuv420p)
CANVAS_W = 1920
CANVAS_H = 1080
LETTERBOX_Y = (CANVAS_H - CONTENT_H) // 2   # 132

# Encoding
VIDEO_CODEC = "libx264"
VIDEO_PRESET = "fast"
VIDEO_CRF = "22"
VIDEO_PIX_FMT = "yuv420p"
VIDEO_PROFILE = "high"
VIDEO_LEVEL = "4.1"
VIDEO_GOP = "30"        # keyframe every 1s @ 30fps — browser-friendly

AUDIO_CODEC = "aac"
AUDIO_SAMPLE_RATE = "48000"
AUDIO_CHANNELS = "2"
AUDIO_BITRATE = "192k"


def audio_mix_with_narration(
    raw_video: Path,
    narration_audio: Path,
    output: Path,
    *,
    ambient_volume: float = 0.25,
    narration_volume: float = 1.2,
) -> list[str]:
    """Mix Wan ambient (low) + TTS narration (foreground) into one MP4.

    Recipe from director-SKILL.md §7. Uses amix with
    ``duration=first:dropout_transition=2`` so the narration determines
    scene length and a 2-second fade smooths the audio cut when
    narration ends before the video.

    Args:
        raw_video: ``{##}_{name}_raw.mp4`` from stage 03 (video + ambient).
        narration_audio: ``{##}_{name}_narration.mp3`` from stage 01.
        output: ``{##}_{name}_mixed.mp4``.
        ambient_volume: Pre-amix volume of Wan's ambient track. Default
            0.25 → effective ~12.5% after amix normalization.
        narration_volume: Pre-amix volume of TTS narration. Default 1.2
            → effective ~60% after amix normalization.

    Returns:
        ffmpeg argv list.
    """
    filt = (
        f"[0:a]volume={ambient_volume}[ambient];"
        f"[1:a]volume={narration_volume}[narr];"
        f"[ambient][narr]amix=inputs=2:duration=first:dropout_transition=2[aout]"
    )
    return [
        "ffmpeg", "-y",
        "-i", str(raw_video),
        "-i", str(narration_audio),
        "-filter_complex", filt,
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", AUDIO_CODEC,
        "-ar", AUDIO_SAMPLE_RATE,
        "-ac", AUDIO_CHANNELS,
        "-b:a", AUDIO_BITRATE,
        "-shortest", "-movflags", "+faststart",
        str(output),
    ]


def uniform_scale(
    input_video: Path,
    output: Path,
) -> list[str]:
    """Scale any input to a uniform 1920×816 letterboxed in 1920×1080.

    Recipe from director-SKILL.md §8. The two-stage pad (first to
    content area, then to canvas) guarantees identical 132px letterbox
    bars per scene — without this, each scene's bar height varies and
    cuts look broken.

    Args:
        input_video: Either ``_mixed.mp4`` (story scene) or
            ``_text.mp4`` (intro/outro after overlay).
        output: ``{##}_{name}_scaled.mp4``.

    Returns:
        ffmpeg argv list.
    """
    vf = (
        f"scale={CONTENT_W}:{CONTENT_H}:force_original_aspect_ratio=decrease,"
        f"pad={CONTENT_W}:{CONTENT_H}:(ow-iw)/2:(oh-ih)/2,"
        f"pad={CANVAS_W}:{CANVAS_H}:0:{LETTERBOX_Y}"
    )
    return [
        "ffmpeg", "-y",
        "-i", str(input_video),
        "-vf", vf,
        "-c:v", VIDEO_CODEC,
        "-preset", VIDEO_PRESET,
        "-crf", VIDEO_CRF,
        "-pix_fmt", VIDEO_PIX_FMT,
        "-profile:v", VIDEO_PROFILE,
        "-level", VIDEO_LEVEL,
        "-g", VIDEO_GOP, "-keyint_min", VIDEO_GOP,
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(output),
    ]


def concat_filter_stitch(
    scaled_inputs: list[Path],
    output: Path,
) -> list[str]:
    """Stitch all scaled scenes via the concat *filter* (not demuxer).

    The demuxer with ``-c copy`` is faster but breaks browser playback
    when inputs differ in any encoding parameter. The filter re-encodes
    into a single clean GOP — slower (~30s for 8 scenes) but plays
    everywhere. director-SKILL.md §8 documents the failure mode.

    Args:
        scaled_inputs: Ordered list of ``_scaled.mp4`` files.
        output: Final concatenated MP4.

    Returns:
        ffmpeg argv list.
    """
    args = ["ffmpeg", "-y"]
    for f in scaled_inputs:
        args.extend(["-i", str(f)])

    # [0:v:0][0:a:0][1:v:0][1:a:0]...[N-1:v:0][N-1:a:0]concat=n=N:v=1:a=1[outv][outa]
    n = len(scaled_inputs)
    chain = "".join(f"[{i}:v:0][{i}:a:0]" for i in range(n))
    chain += f"concat=n={n}:v=1:a=1[outv][outa]"

    args.extend([
        "-filter_complex", chain,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", VIDEO_CODEC,
        "-preset", VIDEO_PRESET,
        "-crf", VIDEO_CRF,
        "-pix_fmt", VIDEO_PIX_FMT,
        "-profile:v", VIDEO_PROFILE,
        "-level", VIDEO_LEVEL,
        "-g", VIDEO_GOP, "-keyint_min", VIDEO_GOP,
        "-c:a", AUDIO_CODEC,
        "-ar", AUDIO_SAMPLE_RATE,
        "-ac", AUDIO_CHANNELS,
        "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        str(output),
    ])
    return args


def extract_frames(
    input_video: Path,
    output_dir: Path,
    *,
    fps: int = 30,
) -> list[str]:
    """Extract every frame of a video as PNG.

    Used by overlays_render.py to apply Pillow text overlays
    frame-by-frame (more reliable than ffmpeg drawtext for animated
    fades — director-SKILL.md §6).

    Args:
        input_video: Source MP4.
        output_dir: Target dir; files written as ``frame_%04d.png``.
        fps: Sample rate. Default 30.

    Returns:
        ffmpeg argv list.
    """
    return [
        "ffmpeg", "-y",
        "-i", str(input_video),
        "-vsync", "0",
        "-vf", f"fps={fps}",
        str(output_dir / "frame_%04d.png"),
    ]


def encode_frames_with_audio(
    frame_pattern: str,
    audio_source: Path,
    output: Path,
    *,
    fps: int = 30,
) -> list[str]:
    """Encode a frame sequence into an MP4, muxing audio from the source.

    Used by overlays_render.py to reassemble Pillow-edited frames into
    a video while preserving the original Wan ambient audio track.

    Args:
        frame_pattern: e.g. ``out_frames/frame_%04d.png``.
        audio_source: MP4 with the audio track to copy through.
        output: ``{##}_{name}_text.mp4``.
        fps: Frame rate. Default 30.

    Returns:
        ffmpeg argv list.
    """
    return [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", frame_pattern,
        "-i", str(audio_source),
        "-map", "0:v", "-map", "1:a",
        "-c:v", VIDEO_CODEC,
        "-preset", VIDEO_PRESET,
        "-crf", VIDEO_CRF,
        "-pix_fmt", VIDEO_PIX_FMT,
        "-profile:v", VIDEO_PROFILE,
        "-level", VIDEO_LEVEL,
        "-g", VIDEO_GOP, "-keyint_min", VIDEO_GOP,
        "-c:a", "copy",
        "-shortest", "-movflags", "+faststart",
        str(output),
    ]


def probe_duration(input_media: Path) -> list[str]:
    """ffprobe a file's duration in seconds (float, plain text)."""
    return [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(input_media),
    ]


def probe_video_info(input_media: Path) -> list[str]:
    """ffprobe video resolution + codecs in csv form."""
    return [
        "ffprobe", "-v", "error",
        "-show_entries", "stream=codec_name,codec_type,width,height",
        "-of", "csv=p=0",
        str(input_media),
    ]
