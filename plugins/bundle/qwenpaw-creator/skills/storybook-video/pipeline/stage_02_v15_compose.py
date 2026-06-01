# -*- coding: utf-8 -*-
"""Stage 02 v15 — per-scene composition via multi-ref edit mode.

For each scene, assemble the reference-image bundle from the locked
assets (character refs + scene ref + style ref), then call
gpt-image-2's ``/v1/images/edits`` to compose a new frame guided by:
  - the scene_description text (what's happening)
  - the locked references (who/what/where, visually)
  - the style template (how it looks)

This replaces the old text-only stage_02_assets.py for v15 projects.
The old per-panel-with-seed approach is preserved for backward
compatibility (Qwen-Image projects, or v14 fallback).

Cost per scene: ~$0.15-0.30 (gpt-image-2 /v1/images/edits at high
quality with 2-4 reference images).
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
_SKILL_DIR = _HERE.parent
sys.path.insert(0, str(_SKILL_DIR))

from spec import ProjectSpec, world_state_at  # noqa: E402

from pipeline.stage_00a_characters import (  # noqa: E402
    _block_text,
    _load_gpt_image_tool,
    _parse_saved_path,
)

logger = logging.getLogger(__name__)


def _load_qwen_image_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="qwen-image",
        tool_file="qwen_image_tool.py",
        module_name="qwen_image_tool",
    )


_PROVIDER_CACHE: dict[str, object] = {}


def _provider_module(provider: str):
    if provider not in _PROVIDER_CACHE:
        # gpt-image-2 and gpt-image-2-dashscope both ship in the same tool
        # module (different functions inside).
        if provider in ("gpt-image-2", "gpt-image-2-dashscope"):
            _PROVIDER_CACHE[provider] = _load_gpt_image_tool()
        elif provider == "qwen-image":
            _PROVIDER_CACHE[provider] = _load_qwen_image_tool()
        else:
            raise ValueError(
                f"unknown frame_provider {provider!r}; expected one of "
                f"'gpt-image-2', 'gpt-image-2-dashscope', 'qwen-image'",
            )
    return _PROVIDER_CACHE[provider]


# Stage 2 composition is multi-image fusion — route qwen-image calls
# through `qwen-image-edit-plus`, the variant designed for it.
_QWEN_EDIT_MODEL = "qwen-image-edit-plus"
# All DashScope qwen image-edit endpoints (2.0-pro, 2.0-2in1,
# edit-plus, edit) currently enforce a hard 3-reference cap at the
# API layer ("For image editing, the message must contain 1~3 image
# content items"). Even edit-plus, despite the "fusion" framing,
# rejects 4+ refs. Truncate to 3 with character-first prioritization.
_QWEN_MAX_REFS = 3


async def _call_provider_edit(
    provider: str,
    *,
    prompt: str,
    refs: "_SceneRefs",
    size: str,
    quality: str,
    keys: dict[str, str],
    scene_id: str = "?",
):
    """Dispatch the multi-ref edit call to the per-scene image provider.

    Picks ref ordering per provider so the most important anchors
    survive any model-side truncation:
      - gpt-image-2 (16-ref cap): [style, scene_ref, *chars]
      - qwen-image (3-ref cap): [*chars, scene_ref, style], truncated
    """
    mod = _provider_module(provider)
    if provider == "gpt-image-2":
        oa = (keys.get("openai") or "").strip()
        if not oa:
            raise RuntimeError(
                "frame_provider=gpt-image-2 requires OPENAI_API_KEY",
            )
        return await mod.edit_image_gpt(
            prompt=prompt, reference_images=refs.gpt_order(),
            size=size, quality=quality, api_key=oa,
        )
    if provider == "gpt-image-2-dashscope":
        ds = (keys.get("dashscope") or "").strip()
        if not ds:
            raise RuntimeError(
                "frame_provider=gpt-image-2-dashscope requires "
                "DASHSCOPE_API_KEY (routes through Aliyun's eval "
                "cluster brokering openai.gpt-image-2)",
            )
        return await mod.edit_image_gpt_eval(
            prompt=prompt, reference_images=refs.gpt_order(),
            size=size, quality=quality, api_key=ds,
        )
    if provider == "qwen-image":
        ds = (keys.get("dashscope") or "").strip()
        if not ds:
            raise RuntimeError(
                "frame_provider=qwen-image requires DASHSCOPE_API_KEY",
            )
        ordered = refs.qwen_order()
        if len(ordered) > _QWEN_MAX_REFS:
            dropped = ordered[_QWEN_MAX_REFS:]
            logger.warning(
                f"[scene {scene_id}] qwen-image: {len(ordered)} refs > "
                f"{_QWEN_MAX_REFS} cap; keeping the first "
                f"{_QWEN_MAX_REFS} (characters-first); dropping: "
                f"{[Path(p).name for p in dropped]}",
            )
            ordered = ordered[:_QWEN_MAX_REFS]
        qsize = size.replace("x", "*") if size else ""
        return await mod.edit_image_qwen(
            prompt=prompt, reference_images=ordered,
            size=qsize, api_key=ds,
            model=_QWEN_EDIT_MODEL,
        )
    raise ValueError(f"unknown frame_provider {provider!r}")


@dataclass
class _SceneRefs:
    """Reference-image paths for one scene, grouped by anchor kind.

    The dispatcher reorders/truncates per provider:
      - gpt-image-2 (16-ref cap): pass all in [style, scene_ref, *chars]
        order — style first sets aesthetic strongest.
      - qwen-image (3-ref cap): pass [*chars, scene_ref, style] order,
        truncated to 3 — character identity is the hardest thing to
        recover from text, so it gets the slots first.
    """

    style: list[str]      # 0 or 1 path
    scene_ref: list[str]  # 0 or 1 path
    characters: list[str] # 0..N paths

    def gpt_order(self) -> list[str]:
        return [*self.style, *self.scene_ref, *self.characters]

    def qwen_order(self) -> list[str]:
        return [*self.characters, *self.scene_ref, *self.style]

    def total(self) -> int:
        return len(self.style) + len(self.scene_ref) + len(self.characters)


def _resolve_refs_for_scene(project_spec: ProjectSpec, scene) -> _SceneRefs:
    """Resolve every reference-image path for a scene, grouped by kind.

    Missing refs (asset doesn't exist or hasn't been generated yet) are
    skipped with a log warning — Stage 02 still runs but with fewer
    anchors.
    """
    style: list[str] = []
    scene_ref: list[str] = []
    chars: list[str] = []
    assets = project_spec.assets

    if scene.uses_style and assets.style and assets.style.reference_image:
        style.append(str(assets.style.reference_image))
    elif scene.uses_style:
        logger.warning(
            f"[scene {scene.scene_id}] uses_style=True but no style_ref",
        )

    if scene.uses_scene_ref:
        sref = assets.scene_refs.get(scene.uses_scene_ref)
        if sref and sref.reference_image:
            scene_ref.append(str(sref.reference_image))
        else:
            logger.warning(
                f"[scene {scene.scene_id}] uses_scene_ref="
                f"{scene.uses_scene_ref!r} but no reference_image",
            )

    for cid in scene.uses_characters:
        c = assets.characters.get(cid)
        if c and c.reference_image:
            chars.append(str(c.reference_image))
        else:
            logger.warning(
                f"[scene {scene.scene_id}] uses_character={cid!r} but no "
                f"reference_image",
            )
    return _SceneRefs(style=style, scene_ref=scene_ref, characters=chars)


def _compose_prompt(project_spec: ProjectSpec, scene) -> str:
    """Build the text prompt for the edit-mode call.

    Combines:
      - scene.scene_description (the per-frame composition directive)
      - style positive_template (look)
      - explicit reference-aware language ("the character from
        reference 1...") so the model knows the refs are identity
        anchors, not collage sources.
    """
    desc = scene.scene_description
    style_block = ""
    if project_spec.assets.style and project_spec.assets.style.positive_template:
        # Style template is "{prompt}. Soft hand-painted..." — strip
        # the substitution placeholder (we've baked desc in already).
        tmpl = project_spec.assets.style.positive_template
        style_block = tmpl.replace("{prompt}", "").strip()
        if style_block.startswith("."):
            style_block = style_block[1:].strip()

    # Story-level anchor and global style directives, pulled from
    # global_config so they propagate to every scene composition.
    # Keep these blocks SHORT — they're injected on every frame, so
    # long blocks crowd out the per-scene composition signal.
    gc = project_spec.global_config or {}
    story_anchor = (gc.get("story_anchor") or "").strip()
    directives = gc.get("style_directives") or []
    era = (gc.get("era") or "").strip()
    country = (gc.get("country") or "").strip()
    tone = (gc.get("tone") or "").strip()
    world_bible = (gc.get("world_bible") or "").strip()

    setting_facts: list[str] = []
    if era: setting_facts.append(f"era: {era}")
    if country: setting_facts.append(f"country: {country}")
    if tone: setting_facts.append(f"tone: {tone}")
    setting_block = (
        f"Story context — {', '.join(setting_facts)}."
        if setting_facts else ""
    )
    anchor_block = (
        f"Story anchor: {story_anchor}" if story_anchor else ""
    )
    directives_block = ""
    if directives:
        directives_block = (
            "Style directives (apply on top of the per-scene composition): "
            + "; ".join(d for d in directives if d and str(d).strip())
        )
    world_bible_block = (
        f"World bible (recurring set-design facts that apply across "
        f"every scene): {world_bible}"
        if world_bible else ""
    )

    # Per-scene user feedback for regen iterations. Persisted on the
    # scene via the UI's per-frame "notes for next regen" textbox.
    # Placed AFTER the base description so the model treats it as a
    # correction layered on top.
    regen_notes = getattr(scene, "regen_notes", "") or ""
    regen_block = ""
    if regen_notes.strip():
        regen_block = (
            "IMPORTANT user corrections for this regeneration "
            "(override the description above where they conflict): "
            + regen_notes.strip()
        )

    # State ledger — for each character/scene_ref this scene uses,
    # fold the timeline up to this scene and tell the model what's
    # currently true. Text-only Phase 1; Phase 2 will swap in derived
    # anchors per (entity, state-set) combo.
    state_lines: list[str] = []
    entities_referenced = list(getattr(scene, "uses_characters", []) or [])
    sref = getattr(scene, "uses_scene_ref", None)
    if sref:
        entities_referenced.append(sref)
    for entity_id in entities_referenced:
        states, notes = world_state_at(project_spec, scene.scene_id, entity_id)
        if states:
            state_lines.append(
                f"  - {entity_id}: {', '.join(sorted(states))}",
            )
    state_block = (
        "CONTINUITY STATE — facts that MUST be visible in this frame "
        "(carried over from earlier scenes via the timeline ledger):\n"
        + "\n".join(state_lines)
        if state_lines else ""
    )

    parts = [
        setting_block,
        anchor_block,
        world_bible_block,
        "",
        desc.strip(),
        "",
        state_block,
        "",
        "REFERENCE IMAGES ARE NON-NEGOTIABLE — treat them as templates, "
        "not inspiration:",
        " - SETTING FIDELITY: the camera angle, framing, palette, "
        "time-of-day lighting, and background geometry MUST match the "
        "scene_ref image. Do NOT redesign the world. Only character "
        "positions, poses, and actions vary across scenes. If the "
        "scene_ref shows a wooden sign, this scene also has a wooden "
        "sign — not a blackboard, not a different sign, not removed.",
        " - STYLE FIDELITY: match the style_ref image's brushwork "
        "density, color saturation, line weight, paper texture, and "
        "edge softness EXACTLY. Do not vary stylistic approach "
        "between scenes — every frame must feel like the same book.",
        " - CHARACTER IDENTITY: each character reference fixes the "
        "identity of that character. They must appear recognizably "
        "the same individual — same body proportions, same clothes, "
        "same distinguishing details. Only pose and expression vary.",
        "",
        style_block,
        "",
        directives_block,
        "",
        regen_block,
    ]
    return "\n".join(p for p in parts if p is not None and p != "").strip()


def _try_emit(pid: Optional[str], kind: str, **payload) -> None:
    """Best-effort progress emit. Silent if the bundle isn't installed
    in a context where ``progress`` is importable.
    """
    if not pid:
        return
    try:
        from progress import emit  # type: ignore

        emit(pid, kind, **payload)
    except Exception:  # noqa: BLE001
        pass


async def run_stage_02_v15(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    keys: dict[str, str],
    only_scene: Optional[str] = None,
    overwrite: bool = False,
    size: str = "1024x1024",
    quality: str = "high",
) -> dict:
    """Compose each scene's frame via the scene's chosen image provider.

    Args:
        project_spec: ProjectSpec with assets already populated by
            Stage 0a/0b/0c.
        output_dir: Where to write ``{##}_{name}_frame.png``.
        keys: Map of provider key names to API keys, e.g.
            ``{"openai": "sk-...", "dashscope": "sk-..."}``. Only the
            keys for providers actually used by scenes need to be set.
        only_scene: When set, compose only this scene id.
        overwrite: Force regeneration even if frame exists.
        size: Image size in ``WIDTHxHEIGHT`` form (qwen-image's
            ``WIDTH*HEIGHT`` is derived automatically).
        quality: gpt-image-2 quality (ignored by qwen-image).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {"stage": "02_v15", "scenes": []}

    # The project id is the immediate parent of the output_dir for the
    # panel-driven flow; we use that as the progress channel.
    pid = output_dir.name
    target_scenes = [
        s for s in project_spec.scenes
        if only_scene is None
        or only_scene in (s.scene_id, f"{s.scene_id}_{s.name}")
    ]
    _try_emit(pid, "stage_start", stage="2", total=len(target_scenes))

    for scene in target_scenes:
        _try_emit(pid, "scene_start", stage="2",
                  scene_id=scene.scene_id, name=scene.name)
        target = output_dir / f"{scene.scene_id}_{scene.name}_frame.png"
        if target.exists() and target.stat().st_size > 0 and not overwrite:
            logger.info(f"[stage 02 skip] {target.name} exists")
            report["scenes"].append({
                "scene_id": scene.scene_id, "skipped": True, "path": str(target),
            })
            continue

        refs = _resolve_refs_for_scene(project_spec, scene)
        if refs.total() == 0:
            logger.error(
                f"[scene {scene.scene_id}] no references available — "
                f"Stage 0a/0b/0c must run first or scene must be standalone",
            )
            report["scenes"].append({
                "scene_id": scene.scene_id, "error": "no refs",
            })
            continue

        prompt = _compose_prompt(project_spec, scene)
        provider = getattr(scene, "frame_provider", None) or "gpt-image-2"
        logger.info(
            f"[stage 02 compose] scene={scene.scene_id}_{scene.name}  "
            f"provider={provider}  refs={refs.total()} "
            f"(style={len(refs.style)} scene_ref={len(refs.scene_ref)} "
            f"chars={len(refs.characters)})  prompt={len(prompt)} chars",
        )

        t0 = time.time()
        try:
            resp = await _call_provider_edit(
                provider,
                prompt=prompt,
                refs=refs,
                size=size,
                quality=quality,
                keys=keys,
                scene_id=scene.scene_id,
            )
        except Exception as e:  # noqa: BLE001
            logger.error(f"  ✗ scene {scene.scene_id} failed: {e}")
            report["scenes"].append({"scene_id": scene.scene_id, "error": str(e)})
            continue

        summary = _block_text(resp.content[-1]) if resp.content else ""
        if summary.startswith("Error:"):
            logger.error(f"  ✗ scene {scene.scene_id}: {summary}")
            report["scenes"].append({"scene_id": scene.scene_id, "error": summary})
            continue

        saved = _parse_saved_path(resp)
        if saved is None or not saved.exists():
            logger.error(f"  ✗ scene {scene.scene_id}: missing saved path")
            report["scenes"].append({"scene_id": scene.scene_id, "error": "missing path"})
            continue

        shutil.copy2(saved, target)
        elapsed = time.time() - t0
        logger.info(
            f"  ✓ scene {scene.scene_id}: {target.stat().st_size/1e6:.1f} MB "
            f"in {elapsed:.0f}s → {target.name}",
        )
        report["scenes"].append({
            "scene_id": scene.scene_id,
            "path": str(target),
            "bytes": target.stat().st_size,
            "elapsed_s": round(elapsed, 1),
            "refs_used": refs.total(),
            "provider": provider,
        })
        _try_emit(pid, "scene_done", stage="2",
                  scene_id=scene.scene_id, name=scene.name,
                  elapsed_s=round(elapsed, 1),
                  file=target.name)
        await asyncio.sleep(2.0)

    n_ok = sum(1 for s in report["scenes"] if "path" in s and not s.get("skipped"))
    n_skip = sum(1 for s in report["scenes"] if s.get("skipped"))
    n_err = sum(1 for s in report["scenes"] if "error" in s)
    logger.info(
        f"[stage 02 v15] done — composed {n_ok}, skipped {n_skip}, failed {n_err}",
    )
    _try_emit(pid, "stage_done", stage="2",
              ok=n_ok, skipped=n_skip, failed=n_err)
    return report
