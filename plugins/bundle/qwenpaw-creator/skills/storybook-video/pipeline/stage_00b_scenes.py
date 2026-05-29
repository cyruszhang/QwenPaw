# -*- coding: utf-8 -*-
"""Stage 0b — generate scene/environment reference images.

Counterpart to Stage 0a, but for the spatial/environmental contexts
(``project.assets.scene_refs``). Each scene ref gets one gpt-image-2
call producing an empty landscape image (no characters, no objects).
The saved PNG path is written back onto the SceneRefAsset.

HITL gate after this stage. Cost: ~$0.15 per scene ref.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import sys
import time
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
_SKILL_DIR = _HERE.parent
sys.path.insert(0, str(_SKILL_DIR))

from spec import ProjectSpec, SceneRefAsset  # noqa: E402

# Re-use stage 0a's loader + parsers
from pipeline.stage_00a_characters import (  # noqa: E402
    _block_text,
    _load_gpt_image_tool,
    _parse_saved_path,
)

logger = logging.getLogger(__name__)


def _ref_prompt(scene_ref: SceneRefAsset, style_template: str) -> str:
    style_filled = style_template.replace("{prompt}", scene_ref.description)
    return (
        f"{style_filled}\n\nEnvironmental landscape reference for re-use "
        f"across multiple scenes. No characters, no people, no animals, "
        f"no boats. No text or letters."
    )


async def run_stage_00b(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    only_scene_ref: Optional[str] = None,
    overwrite: bool = False,
    size: str = "1792x1024",   # landscape default — gpt-image-2 native
    quality: str = "high",
) -> dict:
    """Generate reference images for every scene/environment.

    Mutates ``project_spec.assets.scene_refs[<id>].reference_image`` in place.
    """
    if not project_spec.assets.scene_refs:
        logger.info("[stage 0b] no scene_refs — skipping")
        return {"scene_refs": []}

    style_template = ""
    if project_spec.assets.style and project_spec.assets.style.positive_template:
        style_template = project_spec.assets.style.positive_template

    refs_dir = output_dir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)

    gpt = _load_gpt_image_tool()
    report: dict = {"scene_refs": [], "stage": "0b"}

    for sid, scene_ref in project_spec.assets.scene_refs.items():
        if only_scene_ref and sid != only_scene_ref:
            continue
        target = refs_dir / f"scene_{sid}_ref.png"
        if target.exists() and target.stat().st_size > 0 and not overwrite:
            logger.info(f"[stage 0b skip] {target.name} exists")
            scene_ref.reference_image = target
            report["scene_refs"].append({"id": sid, "skipped": True, "path": str(target)})
            continue

        prompt = _ref_prompt(scene_ref, style_template)
        logger.info(f"[stage 0b gen] scene_ref={sid}  prompt={len(prompt)} chars")
        t0 = time.time()
        try:
            resp = await gpt.generate_image_gpt(
                prompt=prompt,
                size=size,
                quality=quality,
                api_key=api_key,
            )
        except Exception as e:  # noqa: BLE001
            logger.error(f"  ✗ {sid} failed: {e}")
            report["scene_refs"].append({"id": sid, "error": str(e)})
            continue

        summary = _block_text(resp.content[-1]) if resp.content else ""
        if summary.startswith("Error:"):
            logger.error(f"  ✗ {sid}: {summary}")
            report["scene_refs"].append({"id": sid, "error": summary})
            continue

        saved = _parse_saved_path(resp)
        if saved is None or not saved.exists():
            logger.error(f"  ✗ {sid}: missing saved path")
            report["scene_refs"].append({"id": sid, "error": "missing saved path"})
            continue

        shutil.copy2(saved, target)
        scene_ref.reference_image = target
        elapsed = time.time() - t0
        logger.info(f"  ✓ {sid}: {target.stat().st_size/1e6:.1f} MB in {elapsed:.0f}s → {target.name}")
        report["scene_refs"].append({
            "id": sid,
            "path": str(target),
            "bytes": target.stat().st_size,
            "elapsed_s": round(elapsed, 1),
        })
        await asyncio.sleep(2.0)

    n_ok = sum(1 for s in report["scene_refs"] if "path" in s and not s.get("skipped"))
    n_skip = sum(1 for s in report["scene_refs"] if s.get("skipped"))
    n_err = sum(1 for s in report["scene_refs"] if "error" in s)
    logger.info(f"[stage 0b] done — generated {n_ok}, skipped {n_skip}, failed {n_err}")
    return report
