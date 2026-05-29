# -*- coding: utf-8 -*-
"""Stage 04 — assembly: overlays + audio mix + uniform scale + concat.

Pure ffmpeg + Pillow — no API calls, no cost. Runs five sub-passes per
the director-SKILL.md cookbook:

  4a. Text overlays for intro / outro (Pillow per-frame).
  4b. Audio mix for story scenes (Wan ambient @ 25% + TTS @ 120%).
  4c. Uniform scale + letterbox (1920×816 in 1920×1080).
  4d. Concat-filter stitch (re-encode for browser-safe playback).
  4e. ffprobe sanity check on the final output.

Phase B (smoke) skips 4a and 4d — for a single story scene we only run
the audio mix + uniform scale, producing one ``_scaled.mp4`` for visual
review. Phase C runs everything.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent       # .../pipeline/
_SKILL_DIR = _HERE.parent                      # .../skills/storybook-video/
_REPO_ROOT = _SKILL_DIR.parents[4]             # storybook-video → skills → qwenpaw-creator → bundle → plugins → repo
_REPO_SRC = _REPO_ROOT / "src"
sys.path.insert(0, str(_SKILL_DIR))
sys.path.insert(0, str(_REPO_SRC))

from ffmpeg_recipes import (  # noqa: E402
    audio_mix_with_narration,
    concat_filter_stitch,
    probe_duration,
    probe_video_info,
    uniform_scale,
)
from overlays_render import render_overlays_on_video  # noqa: E402
from spec import ProjectSpec  # noqa: E402

logger = logging.getLogger(__name__)

# Director-skill ambient / narration mix levels (validated v1→v4).
AMBIENT_VOLUME = 0.25
NARRATION_VOLUME = 1.2

EXPECTED_FINAL_W = 1920
EXPECTED_FINAL_H = 1080


def _run(argv: list[str]) -> None:
    logger.debug("$ %s", " ".join(argv))
    res = subprocess.run(argv, capture_output=True, text=True)
    if res.returncode != 0:
        tail = "\n".join(res.stderr.splitlines()[-20:])
        raise RuntimeError(
            f"Command failed (rc={res.returncode}):\n"
            f"  $ {' '.join(argv[:6])}...\n"
            f"---stderr tail---\n{tail}",
        )


def _probe_duration_s(media: Path) -> float:
    res = subprocess.run(
        probe_duration(media), capture_output=True, text=True, check=True,
    )
    return float(res.stdout.strip())


def _probe_info(media: Path) -> str:
    res = subprocess.run(
        probe_video_info(media), capture_output=True, text=True, check=True,
    )
    return res.stdout.strip()


def stage_04a_overlays(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    only_scene: str | None = None,
    overwrite: bool = False,
) -> dict[str, Path]:
    """Apply text overlays to scenes that have any (intro / outro).

    Output: ``{##}_{name}_text.mp4`` per overlay-bearing scene.
    Returns mapping scene_id → output path.
    """
    results: dict[str, Path] = {}
    for scene in project_spec.scenes:
        if only_scene and only_scene not in (scene.scene_id, f"{scene.scene_id}_{scene.name}"):
            continue
        if not scene.overlay:
            continue
        raw = output_dir / f"{scene.scene_id}_{scene.name}_raw.mp4"
        out = output_dir / f"{scene.scene_id}_{scene.name}_text.mp4"
        if out.exists() and out.stat().st_size > 0 and not overwrite:
            logger.info(f"[skip] {out.name} exists")
            results[scene.scene_id] = out
            continue
        if not raw.exists():
            raise FileNotFoundError(f"Need {raw} for overlay stage")
        logger.info(f"[4a  ] overlay {scene.scene_id}_{scene.name}: {len(scene.overlay)} text(s)")
        render_overlays_on_video(raw, scene.overlay, out)
        results[scene.scene_id] = out
    return results


def stage_04b_audio_mix(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    only_scene: str | None = None,
    overwrite: bool = False,
) -> dict[str, Path]:
    """Mix narration + Wan ambient for scenes with has_narration=True.

    Output: ``{##}_{name}_mixed.mp4`` per narrated scene.
    """
    results: dict[str, Path] = {}
    for scene in project_spec.scenes:
        if only_scene and only_scene not in (scene.scene_id, f"{scene.scene_id}_{scene.name}"):
            continue
        if not scene.has_narration:
            continue
        raw = output_dir / f"{scene.scene_id}_{scene.name}_raw.mp4"
        narr = output_dir / f"{scene.scene_id}_{scene.name}_narration.mp3"
        out = output_dir / f"{scene.scene_id}_{scene.name}_mixed.mp4"
        if out.exists() and out.stat().st_size > 0 and not overwrite:
            logger.info(f"[skip] {out.name} exists")
            results[scene.scene_id] = out
            continue
        if not raw.exists():
            raise FileNotFoundError(f"Need {raw} for audio mix")
        if not narr.exists():
            raise FileNotFoundError(f"Need {narr} for audio mix")
        has_ambient = "audio" in _probe_info(raw)
        logger.info(
            f"[4b  ] mix    {scene.scene_id}_{scene.name}"
            f" (ambient={'yes' if has_ambient else 'no'})",
        )
        _run(audio_mix_with_narration(
            raw, narr, out,
            ambient_volume=AMBIENT_VOLUME,
            narration_volume=NARRATION_VOLUME,
            has_ambient=has_ambient,
        ))
        results[scene.scene_id] = out
    return results


def stage_04c_uniform_scale(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    only_scene: str | None = None,
    overwrite: bool = False,
) -> dict[str, Path]:
    """Scale every scene to the uniform 1920×816-in-1920×1080 layout.

    Input per scene: ``_mixed.mp4`` (story scenes) or ``_text.mp4``
    (intro/outro overlay scenes) or ``_raw.mp4`` (intro/outro with no
    overlay configured).
    Output: ``{##}_{name}_scaled.mp4`` per scene.
    """
    results: dict[str, Path] = {}
    for scene in project_spec.scenes:
        if only_scene and only_scene not in (scene.scene_id, f"{scene.scene_id}_{scene.name}"):
            continue
        out = output_dir / f"{scene.scene_id}_{scene.name}_scaled.mp4"
        if out.exists() and out.stat().st_size > 0 and not overwrite:
            logger.info(f"[skip] {out.name} exists")
            results[scene.scene_id] = out
            continue

        # Pick input by precedence: mixed > text > raw
        mixed = output_dir / f"{scene.scene_id}_{scene.name}_mixed.mp4"
        text = output_dir / f"{scene.scene_id}_{scene.name}_text.mp4"
        raw = output_dir / f"{scene.scene_id}_{scene.name}_raw.mp4"
        if mixed.exists():
            src = mixed
        elif text.exists():
            src = text
        elif raw.exists():
            src = raw
        else:
            raise FileNotFoundError(
                f"No input found for scaling scene {scene.scene_id}"
            )

        has_audio = "audio" in _probe_info(src)
        logger.info(
            f"[4c  ] scale  {scene.scene_id}_{scene.name} ← {src.name}"
            f" (audio={'yes' if has_audio else 'silence-pad'})",
        )
        _run(uniform_scale(src, out, has_audio=has_audio))
        results[scene.scene_id] = out
    return results


def stage_04d_concat(
    project_spec: ProjectSpec,
    output_dir: Path,
    final_name: str,
    *,
    overwrite: bool = False,
) -> Path:
    """Stitch all scenes' ``_scaled.mp4`` into the final MP4."""
    final = output_dir / final_name
    if final.exists() and final.stat().st_size > 0 and not overwrite:
        logger.info(f"[skip] {final.name} exists")
        return final

    scaled_paths = []
    for scene in project_spec.scenes:
        p = output_dir / f"{scene.scene_id}_{scene.name}_scaled.mp4"
        if not p.exists():
            raise FileNotFoundError(
                f"Missing {p} — Stage 4c must complete first"
            )
        scaled_paths.append(p)

    logger.info(f"[4d  ] concat → {final.name} ({len(scaled_paths)} scenes)")
    _run(concat_filter_stitch(scaled_paths, final))
    return final


def stage_04e_probe(
    final: Path,
    project_spec: ProjectSpec,
    *,
    expected_scenes: list | None = None,
) -> dict:
    """ffprobe + sanity check on the final stitched file.

    Args:
        final: Path to the MP4 to probe.
        project_spec: Full project spec (used as default scope).
        expected_scenes: When set, expected duration is summed over
            just these scenes (use this for Phase B smoke runs that
            only produced one scene). Defaults to the full spec.
    """
    duration = _probe_duration_s(final)
    scope = expected_scenes if expected_scenes is not None else project_spec.scenes
    expected_total = sum(s.duration for s in scope)
    info = _probe_info(final)

    report = {
        "path": str(final),
        "size_bytes": final.stat().st_size,
        "duration_s": round(duration, 3),
        "expected_total_s": expected_total,
        "duration_ok": abs(duration - expected_total) <= 2.0,
        "stream_info": info,
        "resolution_ok": (
            f"{EXPECTED_FINAL_W}" in info and f"{EXPECTED_FINAL_H}" in info
        ),
        "has_audio": "audio" in info,
    }

    logger.info(
        f"[4e  ] probe: {duration:.2f}s "
        f"(expected ~{expected_total}s), "
        f"size {final.stat().st_size / 1e6:.1f} MB"
    )
    logger.info(f"        streams: {info}")
    return report


def run_stage_04_full(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    final_name: str = "old_man_and_the_sea_qwen_final.mp4",
    overwrite: bool = False,
) -> dict:
    """Run all 5 sub-passes (Phase C)."""
    stage_04a_overlays(project_spec, output_dir, overwrite=overwrite)
    stage_04b_audio_mix(project_spec, output_dir, overwrite=overwrite)
    stage_04c_uniform_scale(project_spec, output_dir, overwrite=overwrite)
    final = stage_04d_concat(project_spec, output_dir, final_name, overwrite=overwrite)
    report = stage_04e_probe(final, project_spec)
    return report


def run_stage_04_smoke(
    project_spec: ProjectSpec,
    output_dir: Path,
    scene_id: str,
    *,
    overwrite: bool = False,
) -> Path:
    """Phase B smoke: one story scene → ``_scaled.mp4`` only.

    Skips 4a (no overlay on story scenes) and 4d (only one scene).
    Returns the path to the scaled MP4 for visual review.
    """
    only = scene_id
    # 4b only matters when the scene has narration.
    stage_04b_audio_mix(project_spec, output_dir, only_scene=only, overwrite=overwrite)
    scaled_map = stage_04c_uniform_scale(
        project_spec, output_dir, only_scene=only, overwrite=overwrite,
    )
    if not scaled_map:
        raise RuntimeError(f"No scaled output produced for {scene_id}")
    return next(iter(scaled_map.values()))


