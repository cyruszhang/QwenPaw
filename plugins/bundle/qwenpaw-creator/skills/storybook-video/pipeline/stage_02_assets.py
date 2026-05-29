# -*- coding: utf-8 -*-
"""Stage 02 — Qwen-Image frame generation.

Generates one PNG per scene using qwen-image-2.0-pro with the v11
character-consistency strategy:
- Fixed seed (= 42) → same noise initialization across calls.
- ``prompt_extend=False`` → DashScope's prompt-rewriter doesn't
  silently destroy the verbatim character/style prefix.
- Verbatim character_prefix + spatial_prefix on every scene, with the
  style_bookend appended (see ``spec.assemble_frame_prompt``).

Scenes 00 (intro) and 07 (outro) are standalone — no character/skiff
anchor; we use the scene_description verbatim as the full prompt.

Cost guardrail: ``--max-frames N`` caps how many frames this run
generates. Default 1 for Phase B smoke, 8 for Phase C full.
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

from spec import ProjectSpec, assemble_frame_prompt  # noqa: E402

logger = logging.getLogger(__name__)


def _load_qwen_image_tool():
    """Load qwen_image_tool.py by file path."""
    plugin_path = _TOOLS_DIR / "qwen-image" / "qwen_image_tool.py"
    spec = importlib.util.spec_from_file_location(
        "qwen_image_tool", plugin_path,
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _block_text(block) -> str:
    """TextBlock can be dict (agentscope 1.0.x) or object (later) — handle both."""
    if isinstance(block, dict):
        return block.get("text", "")
    return getattr(block, "text", "")


def _parse_saved_path(tool_response) -> Path:
    """Extract the first local path from the TextBlock 'Saved to:' line."""
    text = _block_text(tool_response.content[-1])
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Saved to:"):
            # 'Saved to: /path/one, /path/two' → take the first.
            paths = line.split("Saved to:", 1)[1].strip()
            first = paths.split(",", 1)[0].strip()
            return Path(first)
    raise RuntimeError(
        f"Could not parse 'Saved to:' from qwen-image response:\n{text}",
    )


def _full_prompt_for(spec_proj: ProjectSpec, scene) -> str:
    """Assemble the full prompt for a scene.

    Standalone scenes (intro / outro / any with ``standalone=True``)
    use scene_description verbatim; others get anchor concatenation
    (character_prefix + spatial_prefix + scene_description + style_bookend).
    """
    if scene.standalone:
        return scene.scene_description
    return assemble_frame_prompt(spec_proj.anchors, scene)


async def run_stage_02(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    only_scene: str | None = None,
    overwrite: bool = False,
    max_frames: int = 8,
) -> list[Path]:
    """Generate Qwen-Image frames for the project.

    Args:
        project_spec: ProjectSpec.
        output_dir: Write ``{##}_{name}_frame.png`` here.
        api_key: DashScope key.
        only_scene: Process only this scene id when set.
        overwrite: When False, skip scenes whose PNG already exists.
        max_frames: Hard cap on number of NEW frames this run will
            generate (skipped frames don't count). Cost guardrail.

    Returns:
        List of Paths to the frames produced (or pre-existing).

    Raises:
        SystemExit(2) if max_frames is exceeded.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    qi = _load_qwen_image_tool()

    size = project_spec.global_config["image_size"]
    seed = project_spec.global_config["seed"]
    prompt_extend = project_spec.global_config["image_prompt_extend"]

    target_scenes = [
        s for s in project_spec.scenes
        if only_scene is None
        or only_scene in (s.scene_id, f"{s.scene_id}_{s.name}")
    ]

    produced: list[Path] = []
    generated_count = 0

    for scene in target_scenes:
        target_png = output_dir / f"{scene.scene_id}_{scene.name}_frame.png"

        if target_png.exists() and target_png.stat().st_size > 0 and not overwrite:
            logger.info(f"[skip] {target_png.name} exists")
            produced.append(target_png)
            continue

        if generated_count >= max_frames:
            logger.warning(
                f"[stop] reached --max-frames={max_frames}, "
                f"skipping {scene.scene_id}_{scene.name}"
            )
            continue

        full_prompt = _full_prompt_for(project_spec, scene)
        logger.info(
            f"[gen ] {scene.scene_id}_{scene.name}: "
            f"{len(full_prompt)} char prompt, seed={seed}, size={size}"
        )

        resp = await qi.generate_image_qwen(
            prompt=full_prompt,
            size=size,
            n=1,
            negative_prompt="",
            prompt_extend=prompt_extend,
            seed=seed,
            api_key=api_key,
        )
        summary = _block_text(resp.content[-1])
        if summary.startswith("Error:"):
            raise RuntimeError(summary)

        qi_path = _parse_saved_path(resp)
        shutil.copy2(qi_path, target_png)
        logger.info(f"        → {target_png.name}")

        produced.append(target_png)
        generated_count += 1

    logger.info(
        f"Stage 02 done: {generated_count} new frame(s), "
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
    parser.add_argument("--max-frames", type=int, default=8)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: DASHSCOPE_API_KEY not set in environment.")
        sys.exit(1)

    asyncio.run(run_stage_02(
        OLD_MAN_PROJECT,
        Path(args.output_dir),
        api_key=api_key,
        only_scene=args.scene,
        overwrite=args.overwrite,
        max_frames=args.max_frames,
    ))


if __name__ == "__main__":
    main()
