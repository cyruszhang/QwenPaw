# -*- coding: utf-8 -*-
"""Stage 0a — generate character reference images.

Each character in ``project.assets.characters`` gets one gpt-image-2
call producing a neutral reference-sheet image (character on empty
background, three-quarter pose). The resulting PNG is saved into
``output/<project>/refs/<id>_ref.png`` and the path is written back
onto the CharacterRef so downstream stages (Stage 02) can pass it
as a reference image.

This is Stage 0 of the v15 anchor-locking pipeline. Cost: ~$0.15 per
character at gpt-image-2 1024×1024 high quality.

HITL gate after this stage: the user eyeballs every ref before
proceeding. Re-running a single character is cheap ($0.15) compared
to discovering character drift downstream.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
import shutil
import sys
import time
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
_SKILL_DIR = _HERE.parent
_REPO_ROOT = _SKILL_DIR.parents[4]
_REPO_SRC = _REPO_ROOT / "src"
_TOOLS_DIR = _REPO_ROOT / "plugins" / "tool"
sys.path.insert(0, str(_SKILL_DIR))
sys.path.insert(0, str(_REPO_SRC))

from spec import CharacterRef, ProjectSpec  # noqa: E402

logger = logging.getLogger(__name__)


def _load_gpt_image_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="gpt-image2",
        tool_file="gpt_image2_tool.py",
        module_name="gpt_image2_tool",
    )


def _block_text(block) -> str:
    if isinstance(block, dict):
        return block.get("text", "")
    return getattr(block, "text", "")


def _parse_saved_path(tool_response) -> Optional[Path]:
    """Parse 'Saved to: <path>' line from gpt-image2 ToolResponse."""
    if not tool_response.content:
        return None
    for block in tool_response.content:
        text = _block_text(block)
        if not text:
            continue
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("Saved to:"):
                return Path(line.split("Saved to:", 1)[1].strip())
    return None


def _ref_prompt(character: CharacterRef, style_template: str) -> str:
    """Compose the reference-sheet prompt for one character.

    Goal: render the character in a neutral pose on an empty
    background, suitable for reuse as a visual anchor in scenes.
    """
    style_filled = style_template.replace("{prompt}", character.description)
    return f"{style_filled}\n\nCharacter reference sheet for re-use across multiple scenes. Plain pale neutral background, no other elements, no text."


async def run_stage_00a(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    only_character: Optional[str] = None,
    overwrite: bool = False,
    size: str = "1024x1024",
    quality: str = "high",
) -> dict:
    """Generate reference images for every character.

    Mutates ``project_spec.assets.characters[<id>].reference_image`` in
    place to point at the saved path. Returns a report dict.
    """
    if not project_spec.assets.characters:
        logger.info("[stage 0a] no characters in project — skipping")
        return {"characters": []}

    style_template = ""
    if project_spec.assets.style and project_spec.assets.style.positive_template:
        style_template = project_spec.assets.style.positive_template

    refs_dir = output_dir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)

    gpt = _load_gpt_image_tool()
    report: dict = {"characters": [], "stage": "0a"}

    for cid, character in project_spec.assets.characters.items():
        if only_character and cid != only_character:
            continue
        target = refs_dir / f"{cid}_ref.png"
        if target.exists() and target.stat().st_size > 0 and not overwrite:
            logger.info(f"[stage 0a skip] {target.name} exists")
            character.reference_image = target
            report["characters"].append({"id": cid, "skipped": True, "path": str(target)})
            continue

        prompt = _ref_prompt(character, style_template)
        logger.info(f"[stage 0a gen] character={cid}  prompt={len(prompt)} chars")
        t0 = time.time()
        try:
            resp = await gpt.generate_image_gpt(
                prompt=prompt,
                size=size,
                quality=quality,
                api_key=api_key,
            )
        except Exception as e:  # noqa: BLE001
            logger.error(f"  ✗ {cid} failed: {e}")
            report["characters"].append({"id": cid, "error": str(e)})
            continue

        # Check for error in TextBlock
        summary = _block_text(resp.content[-1]) if resp.content else ""
        if summary.startswith("Error:"):
            logger.error(f"  ✗ {cid}: {summary}")
            report["characters"].append({"id": cid, "error": summary})
            continue

        saved = _parse_saved_path(resp)
        if saved is None or not saved.exists():
            logger.error(f"  ✗ {cid}: could not parse 'Saved to:' from response")
            report["characters"].append({"id": cid, "error": "missing saved path"})
            continue

        # Copy under our project's refs dir with the canonical name
        shutil.copy2(saved, target)
        character.reference_image = target
        elapsed = time.time() - t0
        logger.info(f"  ✓ {cid}: {target.stat().st_size/1e6:.1f} MB in {elapsed:.0f}s → {target.name}")
        report["characters"].append({
            "id": cid,
            "path": str(target),
            "bytes": target.stat().st_size,
            "elapsed_s": round(elapsed, 1),
        })
        await asyncio.sleep(2.0)   # rate-limit padding

    n_ok = sum(1 for c in report["characters"] if "path" in c and not c.get("skipped"))
    n_skip = sum(1 for c in report["characters"] if c.get("skipped"))
    n_err = sum(1 for c in report["characters"] if "error" in c)
    logger.info(f"[stage 0a] done — generated {n_ok}, skipped {n_skip}, failed {n_err}")
    return report
