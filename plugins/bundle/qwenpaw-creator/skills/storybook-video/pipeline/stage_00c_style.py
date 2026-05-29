# -*- coding: utf-8 -*-
"""Stage 0c — resolve / generate the style reference image.

The project's ``assets.style.catalog_id`` picks a row from the skill's
styles catalog (``styles/styles.yml``). Three possible sources for the
``reference_image`` in order of preference:

1. **Catalog sample** — if ``styles/samples/<id>.png`` exists, use it.
   This is the cheapest path: no API call, just file copy.
2. **Fresh gen for this project** — generate a new ``style_ref.png``
   using the catalog's positive_template + a neutral subject. Caches
   into the project's ``refs/style_ref.png``.
3. **Provided override** — if the project YAML has a direct
   ``reference_image`` path under ``assets.style``, honor it.

HITL gate after this stage. Cost: free if the sample exists, ~$0.15
if we need to generate.
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
_REPO_ROOT = _SKILL_DIR.parents[4]
sys.path.insert(0, str(_SKILL_DIR))

from spec import ProjectSpec  # noqa: E402

from pipeline.stage_00a_characters import (  # noqa: E402
    _block_text,
    _load_gpt_image_tool,
    _parse_saved_path,
)

logger = logging.getLogger(__name__)


# Where the catalog's pre-rendered samples live (if any).
_STYLES_SAMPLES_DIR = _SKILL_DIR / "styles" / "samples"


def _neutral_style_subject() -> str:
    """The subject we render to embody the style itself.

    Chosen to be evocative but content-light — a wide landscape with a
    single small figure, no specific character. The point is to show
    the aesthetic, not tell a story.
    """
    return (
        "A wide gentle landscape at dawn — distant rolling hills meeting "
        "a calm sea, a single tiny figure walking along a path in the "
        "middle distance, soft warm light, peaceful atmosphere"
    )


async def run_stage_00c(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    overwrite: bool = False,
    size: str = "1024x1024",
    quality: str = "high",
) -> dict:
    """Resolve the style reference image and write its path onto
    ``project_spec.assets.style.reference_image``.

    Returns a report dict.
    """
    style = project_spec.assets.style
    if not style:
        logger.info("[stage 0c] no style asset — skipping")
        return {"stage": "0c", "skipped": True}

    refs_dir = output_dir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)
    target = refs_dir / "style_ref.png"

    if target.exists() and target.stat().st_size > 0 and not overwrite:
        logger.info(f"[stage 0c skip] {target.name} exists")
        style.reference_image = target
        return {"stage": "0c", "skipped": True, "path": str(target)}

    # Path 1: try catalog sample
    catalog_sample = _STYLES_SAMPLES_DIR / f"{style.catalog_id}.png"
    if catalog_sample.exists() and catalog_sample.stat().st_size > 0:
        logger.info(f"[stage 0c] using catalog sample {catalog_sample.name}")
        shutil.copy2(catalog_sample, target)
        style.reference_image = target
        return {
            "stage": "0c",
            "source": "catalog_sample",
            "path": str(target),
        }

    # Path 2: fresh gen
    if not style.positive_template:
        logger.error(
            f"[stage 0c] no positive_template for style "
            f"'{style.catalog_id}' — cannot generate",
        )
        return {"stage": "0c", "error": "no template"}

    prompt = style.positive_template.replace("{prompt}", _neutral_style_subject())
    prompt += "\n\nStyle reference for re-use. No text or letters."
    logger.info(f"[stage 0c gen] style={style.catalog_id}  prompt={len(prompt)} chars")
    t0 = time.time()

    gpt = _load_gpt_image_tool()
    try:
        resp = await gpt.generate_image_gpt(
            prompt=prompt, size=size, quality=quality, api_key=api_key,
        )
    except Exception as e:  # noqa: BLE001
        logger.error(f"[stage 0c] gen failed: {e}")
        return {"stage": "0c", "error": str(e)}

    summary = _block_text(resp.content[-1]) if resp.content else ""
    if summary.startswith("Error:"):
        logger.error(f"[stage 0c] {summary}")
        return {"stage": "0c", "error": summary}

    saved = _parse_saved_path(resp)
    if saved is None or not saved.exists():
        return {"stage": "0c", "error": "missing saved path"}

    shutil.copy2(saved, target)
    style.reference_image = target

    # Also seed the catalog so future projects can reuse this sample
    _STYLES_SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    if not catalog_sample.exists():
        shutil.copy2(target, catalog_sample)
        logger.info(f"  also cached into catalog: {catalog_sample.name}")

    elapsed = time.time() - t0
    logger.info(f"  ✓ style {style.catalog_id}: {target.stat().st_size/1e6:.1f} MB in {elapsed:.0f}s")
    return {
        "stage": "0c",
        "source": "fresh_gen",
        "catalog_id": style.catalog_id,
        "path": str(target),
        "bytes": target.stat().st_size,
        "elapsed_s": round(elapsed, 1),
    }
