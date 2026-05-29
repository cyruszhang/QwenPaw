# -*- coding: utf-8 -*-
"""Stage 03 — Wan 2.7 I2V animation per scene.

Takes the frames from Stage 02 and animates them via Wan 2.7 image-to-
video. Wan returns video + ambient audio in one MP4; the assembly stage
will later mix the TTS narration on top of that ambient track.

Cost guardrail: ``--max-shots N`` caps how many shots this run will
animate. Default 1 for Phase B smoke, 8 for Phase C. Wan calls are the
single most expensive step in the pipeline (~$0.60 per 10s shot).

Quirks worth knowing (captured in quirks/wan27.md):
- Wan returns videos at varying actual resolutions even when
  resolution="1080P" — Stage 04's uniform-scale pass normalizes them.
- Wan auto-generates ambient audio matching the scene mood. Don't
  discard it; Stage 04 mixes it as a 25% bed under narration.
- Without explicit limb positioning in the motion prompt, Wan tends
  to hallucinate floating hands. The v11 prompts already encode this.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import os
import shutil
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent       # .../pipeline/
_SKILL_DIR = _HERE.parent                      # .../skills/storybook-video/
_REPO_ROOT = _SKILL_DIR.parents[4]             # storybook-video → skills → qwenpaw-creator → bundle → plugins → repo
_REPO_SRC = _REPO_ROOT / "src"
_TOOLS_DIR = _REPO_ROOT / "plugins" / "tool"
sys.path.insert(0, str(_SKILL_DIR))
sys.path.insert(0, str(_REPO_SRC))

from spec import ProjectSpec  # noqa: E402

logger = logging.getLogger(__name__)


def _load_wan27_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="wan27",
        tool_file="wan27_tool.py",
        module_name="wan27_tool",
    )


def _load_happyhorse_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="happyhorse",
        tool_file="happyhorse_tool.py",
        module_name="happyhorse_tool",
    )


def _load_seedance_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="seedance",
        tool_file="seedance_tool.py",
        module_name="seedance_tool",
    )


# Cache the loaded tool modules so repeated scene iterations don't pay
# the dynamic-import cost for each scene.
_PROVIDER_CACHE: dict[str, object] = {}


def _provider_module(provider: str):
    if provider not in _PROVIDER_CACHE:
        if provider == "wan27":
            _PROVIDER_CACHE[provider] = _load_wan27_tool()
        elif provider == "happyhorse":
            _PROVIDER_CACHE[provider] = _load_happyhorse_tool()
        elif provider == "seedance":
            _PROVIDER_CACHE[provider] = _load_seedance_tool()
        else:
            raise ValueError(
                f"unknown video_provider {provider!r}; expected one of "
                f"'wan27', 'happyhorse', 'seedance'",
            )
    return _PROVIDER_CACHE[provider]


async def _call_provider_i2v(
    provider: str, prompt: str, frame_path: str,
    *, resolution: str, duration: int, prompt_extend: bool,
    api_key: str,
):
    """Dispatch to the right provider's image-to-video function.

    All three providers share the same essential signature so call
    sites don't branch — pick the function and forward.
    """
    mod = _provider_module(provider)
    if provider == "wan27":
        return await mod.image_to_video_wan(
            prompt=prompt, first_frame_url=frame_path,
            resolution=resolution, duration=duration,
            prompt_extend=prompt_extend, api_key=api_key,
        )
    if provider == "happyhorse":
        return await mod.image_to_video_happyhorse(
            prompt=prompt, first_frame_url=frame_path,
            resolution=resolution, duration=duration,
            prompt_extend=prompt_extend, api_key=api_key,
        )
    if provider == "seedance":
        return await mod.image_to_video_seedance(
            prompt=prompt, first_frame_url=frame_path,
            resolution=resolution, duration=duration,
            prompt_extend=prompt_extend, api_key=api_key,
        )
    raise ValueError(f"unknown provider {provider!r}")


def _block_text(block) -> str:
    """TextBlock can be dict (agentscope 1.0.x) or object (later) — handle both."""
    if isinstance(block, dict):
        return block.get("text", "")
    return getattr(block, "text", "")


def _parse_saved_path(tool_response) -> Path:
    """Extract the 'Saved to:' path from the wan27 TextBlock summary."""
    text = _block_text(tool_response.content[-1])
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Saved to:"):
            return Path(line.split("Saved to:", 1)[1].strip())
    raise RuntimeError(
        f"Could not parse 'Saved to:' from wan27 response:\n{text}",
    )


async def run_stage_03(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    only_scene: str | None = None,
    overwrite: bool = False,
    max_shots: int = 8,
) -> list[Path]:
    """Animate each scene's frame via Wan 2.7 I2V.

    Args:
        project_spec: ProjectSpec.
        output_dir: Reads ``{##}_{name}_frame.png`` and writes
            ``{##}_{name}_raw.mp4`` here.
        api_key: DashScope key.
        only_scene: Process only this scene id when set.
        overwrite: When False, skip scenes whose raw MP4 already exists.
        max_shots: Hard cap on number of NEW shots this run will
            generate. Cost guardrail.

    Returns:
        List of Paths to the raw MP4s (produced or pre-existing).

    Raises:
        FileNotFoundError if the expected frame PNG is missing.
        SystemExit(2) if max_shots is exceeded.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    # Provider modules are loaded lazily per scene via _provider_module().

    gc = project_spec.global_config or {}
    resolution = gc.get("video_resolution", "1080P")
    prompt_extend = bool(gc.get("video_prompt_extend", True))
    default_provider = str(gc.get("video_provider") or "wan27")

    target_scenes = [
        s for s in project_spec.scenes
        if only_scene is None
        or only_scene in (s.scene_id, f"{s.scene_id}_{s.name}")
    ]

    produced: list[Path] = []
    generated_count = 0

    for scene in target_scenes:
        target_mp4 = output_dir / f"{scene.scene_id}_{scene.name}_raw.mp4"
        frame_png = output_dir / f"{scene.scene_id}_{scene.name}_frame.png"

        if target_mp4.exists() and target_mp4.stat().st_size > 0 and not overwrite:
            logger.info(f"[skip] {target_mp4.name} exists")
            produced.append(target_mp4)
            continue

        if not frame_png.exists():
            raise FileNotFoundError(
                f"Frame missing for scene {scene.scene_id}: {frame_png}. "
                f"Run Stage 02 first."
            )

        if generated_count >= max_shots:
            logger.warning(
                f"[stop] reached --max-shots={max_shots}, "
                f"skipping {scene.scene_id}_{scene.name}"
            )
            continue

        provider = getattr(scene, "video_provider", None) or default_provider
        logger.info(
            f"[{provider}] {scene.scene_id}_{scene.name}: "
            f"{scene.duration}s @ {resolution} — this takes ~1-3 min"
        )

        resp = await _call_provider_i2v(
            provider,
            scene.motion_prompt,
            str(frame_png),
            resolution=resolution,
            duration=scene.duration,
            prompt_extend=prompt_extend,
            api_key=api_key,
        )
        summary = _block_text(resp.content[-1])
        if summary.startswith("Error:"):
            raise RuntimeError(summary)

        wan_path = _parse_saved_path(resp)
        shutil.copy2(wan_path, target_mp4)
        logger.info(f"        → {target_mp4.name}")

        produced.append(target_mp4)
        generated_count += 1

    logger.info(
        f"Stage 03 done: {generated_count} new shot(s), "
        f"{len(produced)} total in {output_dir}"
    )
    return produced


def main():
    import argparse
    from prompts import OLD_MAN_PROJECT  # noqa: E402

    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="output")
    parser.add_argument("--scene", default=None)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--max-shots", type=int, default=8)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: DASHSCOPE_API_KEY not set in environment.")
        sys.exit(1)

    asyncio.run(run_stage_03(
        OLD_MAN_PROJECT,
        Path(args.output_dir),
        api_key=api_key,
        only_scene=args.scene,
        overwrite=args.overwrite,
        max_shots=args.max_shots,
    ))


if __name__ == "__main__":
    main()
