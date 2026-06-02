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

from spec import CharacterRef, ProjectSpec, PropRef  # noqa: E402

logger = logging.getLogger(__name__)


def _load_gpt_image_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="gpt-image2",
        tool_file="gpt_image2_tool.py",
        module_name="gpt_image2_tool",
    )


def _load_qwen_image_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="qwen-image",
        tool_file="qwen_image_tool.py",
        module_name="qwen_image_tool",
    )


# Shared provider-routing infra for the ref-generation stages (0a/0b/0c).
# Stage 02 has its own analogue for multi-ref edit; this one is for
# single-image generation (no input refs).
_PROVIDER_CACHE_GEN: dict[str, object] = {}


def _provider_module_gen(provider: str):
    if provider not in _PROVIDER_CACHE_GEN:
        # gpt-image-2 and gpt-image-2-dashscope both live in the same tool
        # module (different functions inside); reuse the loader.
        if provider in ("gpt-image-2", "gpt-image-2-dashscope"):
            _PROVIDER_CACHE_GEN[provider] = _load_gpt_image_tool()
        elif provider == "qwen-image":
            _PROVIDER_CACHE_GEN[provider] = _load_qwen_image_tool()
        else:
            raise ValueError(
                f"unknown frame_provider {provider!r}; expected one of "
                f"'gpt-image-2', 'gpt-image-2-dashscope', 'qwen-image'",
            )
    return _PROVIDER_CACHE_GEN[provider]


async def _call_provider_gen(
    provider: str,
    *,
    prompt: str,
    size: str,
    quality: str,
    keys: dict[str, str],
):
    """Single-image generation dispatcher used by Stage 0a / 0b / 0c.

    Picks the right tool function + key per provider. gpt-image-2 wants
    ``WIDTHxHEIGHT`` and a ``quality`` knob; qwen-image wants
    ``WIDTH*HEIGHT`` and has no quality tier.
    """
    mod = _provider_module_gen(provider)
    if provider == "gpt-image-2":
        oa = (keys.get("openai") or "").strip()
        if not oa:
            raise RuntimeError(
                "frame_provider=gpt-image-2 requires OPENAI_API_KEY",
            )
        return await mod.generate_image_gpt(
            prompt=prompt, size=size, quality=quality, api_key=oa,
        )
    if provider == "gpt-image-2-dashscope":
        ds = (keys.get("dashscope") or "").strip()
        if not ds:
            raise RuntimeError(
                "frame_provider=gpt-image-2-dashscope requires DASHSCOPE_API_KEY "
                "(routes through Aliyun DashScope eval cluster brokering "
                "openai.gpt-image-2)",
            )
        return await mod.generate_image_gpt_eval(
            prompt=prompt, size=size, quality=quality, api_key=ds,
        )
    if provider == "qwen-image":
        ds = (keys.get("dashscope") or "").strip()
        if not ds:
            raise RuntimeError(
                "frame_provider=qwen-image requires DASHSCOPE_API_KEY",
            )
        qsize = size.replace("x", "*") if size else ""
        return await mod.generate_image_qwen(
            prompt=prompt, size=qsize, api_key=ds,
        )
    raise ValueError(f"unknown frame_provider {provider!r}")


def _resolve_frame_provider(project_spec) -> str:
    """Resolve the project's frame_provider, defaulting to gpt-image-2."""
    gc = project_spec.global_config or {}
    return str(gc.get("frame_provider") or "gpt-image-2")


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
    return (
        f"{style_filled}\n\n"
        "Character turnaround reference sheet for re-use across multiple "
        "scenes. Show the same character from multiple angles in one image: "
        "front view, side view, back view, and three-quarter view. Keep the "
        "same proportions, face, clothing, accessories, colors, and distinctive "
        "marks in every view. Plain pale neutral background, no scene, no "
        "props unless worn by the character, no extra characters, no text."
    )


def _prop_prompt(prop: PropRef, style_template: str) -> str:
    """Compose a reference-sheet prompt for one portable key prop."""
    style_filled = style_template.replace("{prompt}", prop.description)
    return (
        f"{style_filled}\n\n"
        "Key prop turnaround reference sheet for re-use across multiple "
        "scenes and settings. Show the exact same object from multiple angles "
        "in one image: front view, side view, back view, and three-quarter "
        "view, plus a small detail close-up if useful. Preserve silhouette, "
        "materials, color, markings, wear, scale, and all distinctive details "
        "in every view. Plain pale neutral background, object only, no hands, "
        "no holder, no characters, no scene, no text."
    )


async def run_stage_00a(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    keys: dict[str, str],
    only_character: Optional[str] = None,
    only_prop: Optional[str] = None,
    overwrite: bool = False,
    size: str = "1024x1024",
    quality: str = "high",
) -> dict:
    """Generate reference images for every character.

    Mutates ``project_spec.assets.characters[<id>].reference_image`` in
    place to point at the saved path. Returns a report dict.

    Picks the image provider from ``global_config.frame_provider``
    (default ``gpt-image-2``). ``keys`` must contain whichever key
    that provider needs — caller is responsible for that check.
    """
    if not project_spec.assets.characters and not project_spec.assets.props:
        logger.info("[stage 0a] no characters or props in project — skipping")
        return {"characters": [], "props": []}

    style_template = ""
    if project_spec.assets.style and project_spec.assets.style.positive_template:
        style_template = project_spec.assets.style.positive_template

    refs_dir = output_dir / "refs"
    refs_dir.mkdir(parents=True, exist_ok=True)

    provider = _resolve_frame_provider(project_spec)
    report: dict = {
        "characters": [], "props": [], "stage": "0a", "provider": provider,
    }

    # Walk characters once: drain cached/excluded into the report
    # directly, queue the rest for parallel generation. Concurrency
    # matches the client-side fan-out cap used by Stage 2/3.
    gc = project_spec.global_config or {}
    concurrency = max(1, min(8, int(gc.get("concurrency") or 5)))

    to_gen: list[tuple[str, CharacterRef]] = []
    for cid, character in project_spec.assets.characters.items():
        if only_prop:
            continue
        if only_character and cid != only_character:
            continue
        target = refs_dir / f"{cid}_ref.png"
        if target.exists() and target.stat().st_size > 0 and not overwrite:
            logger.info(f"[stage 0a skip] {target.name} exists")
            character.reference_image = target
            report["characters"].append({"id": cid, "skipped": True, "path": str(target)})
            continue
        to_gen.append((cid, character))

    to_gen_props: list[tuple[str, PropRef]] = []
    for pid, prop in getattr(project_spec.assets, "props", {}).items():
        if only_character:
            continue
        if only_prop and pid != only_prop:
            continue
        target = refs_dir / f"prop_{pid}_ref.png"
        if target.exists() and target.stat().st_size > 0 and not overwrite:
            logger.info(f"[stage 0a skip] {target.name} exists")
            prop.reference_image = target
            report["props"].append({"id": pid, "skipped": True, "path": str(target)})
            continue
        to_gen_props.append((pid, prop))

    sem = asyncio.Semaphore(concurrency)

    async def _gen_one(cid: str, character: CharacterRef) -> dict:
        async with sem:
            target = refs_dir / f"{cid}_ref.png"
            prompt = _ref_prompt(character, style_template)
            logger.info(
                f"[stage 0a gen] character={cid}  provider={provider}  "
                f"prompt={len(prompt)} chars",
            )
            t0 = time.time()
            try:
                resp = await _call_provider_gen(
                    provider,
                    prompt=prompt,
                    size=size,
                    quality=quality,
                    keys=keys,
                )
            except Exception as e:  # noqa: BLE001
                logger.error(f"  ✗ {cid} failed: {e}")
                return {"id": cid, "error": str(e)}

            summary = _block_text(resp.content[-1]) if resp.content else ""
            if summary.startswith("Error:"):
                logger.error(f"  ✗ {cid}: {summary}")
                return {"id": cid, "error": summary}

            saved = _parse_saved_path(resp)
            if saved is None or not saved.exists():
                logger.error(
                    f"  ✗ {cid}: could not parse 'Saved to:' from response",
                )
                return {"id": cid, "error": "missing saved path"}

            shutil.copy2(saved, target)
            character.reference_image = target
            elapsed = time.time() - t0
            logger.info(
                f"  ✓ {cid}: {target.stat().st_size / 1e6:.1f} MB in "
                f"{elapsed:.0f}s → {target.name}",
            )
            return {
                "id": cid,
                "path": str(target),
                "bytes": target.stat().st_size,
                "elapsed_s": round(elapsed, 1),
            }

    async def _gen_prop(pid: str, prop: PropRef) -> dict:
        async with sem:
            target = refs_dir / f"prop_{pid}_ref.png"
            prompt = _prop_prompt(prop, style_template)
            logger.info(
                f"[stage 0a gen] prop={pid}  provider={provider}  "
                f"prompt={len(prompt)} chars",
            )
            t0 = time.time()
            try:
                resp = await _call_provider_gen(
                    provider,
                    prompt=prompt,
                    size=size,
                    quality=quality,
                    keys=keys,
                )
            except Exception as e:  # noqa: BLE001
                logger.error(f"  ✗ prop {pid} failed: {e}")
                return {"id": pid, "error": str(e)}

            summary = _block_text(resp.content[-1]) if resp.content else ""
            if summary.startswith("Error:"):
                logger.error(f"  ✗ prop {pid}: {summary}")
                return {"id": pid, "error": summary}

            saved = _parse_saved_path(resp)
            if saved is None or not saved.exists():
                logger.error(
                    f"  ✗ prop {pid}: could not parse 'Saved to:' from response",
                )
                return {"id": pid, "error": "missing saved path"}

            shutil.copy2(saved, target)
            prop.reference_image = target
            elapsed = time.time() - t0
            logger.info(
                f"  ✓ prop {pid}: {target.stat().st_size / 1e6:.1f} MB in "
                f"{elapsed:.0f}s → {target.name}",
            )
            return {
                "id": pid,
                "path": str(target),
                "bytes": target.stat().st_size,
                "elapsed_s": round(elapsed, 1),
            }

    if to_gen:
        results = await asyncio.gather(*(_gen_one(c, ch) for c, ch in to_gen))
        report["characters"].extend(results)
    if to_gen_props:
        prop_results = await asyncio.gather(*(
            _gen_prop(pid, prop) for pid, prop in to_gen_props
        ))
        report["props"].extend(prop_results)

    n_ok = sum(1 for c in report["characters"] if "path" in c and not c.get("skipped"))
    n_skip = sum(1 for c in report["characters"] if c.get("skipped"))
    n_err = sum(1 for c in report["characters"] if "error" in c)
    p_ok = sum(1 for p in report["props"] if "path" in p and not p.get("skipped"))
    p_skip = sum(1 for p in report["props"] if p.get("skipped"))
    p_err = sum(1 for p in report["props"] if "error" in p)
    logger.info(
        f"[stage 0a] done via {provider} — characters generated {n_ok}, "
        f"skipped {n_skip}, failed {n_err}; props generated {p_ok}, "
        f"skipped {p_skip}, failed {p_err} (concurrency={concurrency})",
    )
    return report
