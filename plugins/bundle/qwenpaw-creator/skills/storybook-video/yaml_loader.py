# -*- coding: utf-8 -*-
"""Load a v15 ProjectSpec from YAML."""

from __future__ import annotations

import re
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import yaml  # type: ignore  # noqa: E402

from spec import (  # type: ignore  # noqa: E402
    AnchorSet,
    AssetSet,
    CharacterRef,
    OverlaySpec,
    ProjectSpec,
    SceneRefAsset,
    SceneSpec,
    SceneValidationRules,
    StateChange,
    StyleAsset,
    ValidationRules,
)

_STYLES_CATALOG_PATH = _HERE / "styles" / "styles.yml"


def _flatten_prose(text: str) -> str:
    r"""Collapse YAML ``|-`` block-scalar line wraps into single-line prose."""
    return re.sub(r"\s+", " ", text or "").strip()


def _load_styles_catalog() -> dict:
    if not _STYLES_CATALOG_PATH.exists():
        return {}
    raw = yaml.safe_load(_STYLES_CATALOG_PATH.read_text(encoding="utf-8"))
    return {s["id"]: s for s in (raw or {}).get("styles", [])}


def _load_assets(raw: dict) -> AssetSet:
    if not raw:
        return AssetSet()
    characters: dict[str, CharacterRef] = {}
    for c in raw.get("characters", []) or []:
        characters[c["id"]] = CharacterRef(
            id=c["id"], description=_flatten_prose(c["description"]),
        )
    scene_refs: dict[str, SceneRefAsset] = {}
    for sr in raw.get("scene_refs", []) or []:
        scene_refs[sr["id"]] = SceneRefAsset(
            id=sr["id"], description=_flatten_prose(sr["description"]),
        )
    style_block = raw.get("style") or {}
    style: StyleAsset | None = None
    if style_block:
        cat_id = style_block.get("catalog_id")
        catalog = _load_styles_catalog()
        entry = catalog.get(cat_id, {}) if cat_id else {}
        style = StyleAsset(
            catalog_id=cat_id or "",
            positive_template=_flatten_prose(
                style_block.get("positive_template")
                or entry.get("positive_template", ""),
            ),
            negative_prompt=_flatten_prose(
                style_block.get("negative_prompt")
                or entry.get("negative_prompt", ""),
            ),
            description=_flatten_prose(entry.get("description", "")),
        )
    return AssetSet(
        characters=characters, scene_refs=scene_refs, style=style,
    )


def _load_validation(raw: dict) -> ValidationRules:
    if not raw:
        return ValidationRules()
    g = raw.get("global", {}) or {}
    per_scene: dict[str, SceneValidationRules] = {}
    for sid, rules in (raw.get("per_scene", {}) or {}).items():
        per_scene[str(sid)] = SceneValidationRules(
            must_contain=list(rules.get("must_contain", [])),
            must_not_contain=list(rules.get("must_not_contain", [])),
            composition=list(rules.get("composition", [])),
        )
    return ValidationRules(
        global_must_not_contain=list(g.get("must_not_contain", [])),
        global_must_contain=list(g.get("must_contain", [])),
        per_scene=per_scene,
    )


def load_project_spec_from_dict(raw: dict) -> ProjectSpec:
    """Parse an already-loaded YAML dict into a ProjectSpec.

    Convenience for the Creator panel which has the draft in memory
    and doesn't want to round-trip through a temp file.
    """
    a = raw.get("anchors") or {}
    anchors = AnchorSet(
        style_bookend=_flatten_prose(a.get("style_bookend", "")),
        character_prefix=_flatten_prose(a.get("character_prefix", "")),
        spatial_prefix=_flatten_prose(a.get("spatial_prefix", "")),
        style_ref_image=Path(a["style_ref_image"]) if a.get("style_ref_image") else None,
        character_ref_images=[Path(p) for p in a.get("character_ref_images", [])],
        spatial_ref_image=Path(a["spatial_ref_image"]) if a.get("spatial_ref_image") else None,
    )
    scenes: list[SceneSpec] = []
    narration: dict[str, str] = {}
    gc = raw.get("global_config", {}) or {}
    default_n = int(gc.get("default_n_candidates", 1))
    for s in raw.get("scenes", []) or []:
        sid = str(s["id"])
        n_cand = int(s.get("n_candidates", default_n))
        scene = SceneSpec(
            scene_id=sid,
            name=s["name"],
            scene_description=_flatten_prose(s["scene_description"]),
            motion_prompt=_flatten_prose(s.get("motion_prompt", "")),
            duration=int(s["duration"]),
            has_narration=bool(s.get("has_narration", False)),
            standalone=bool(s.get("standalone", False)),
            overlay=[OverlaySpec(**o) for o in s.get("overlays", []) or []],
            n_candidates=max(1, n_cand),
            uses_characters=list(s.get("uses_characters", []) or []),
            uses_scene_ref=s.get("uses_scene_ref") or None,
            uses_style=bool(s.get("uses_style", True)),
            regen_notes=_flatten_prose(s.get("regen_notes", "")),
            video_provider=str(s.get("video_provider") or "wan27"),
            frame_provider=str(s.get("frame_provider") or "gpt-image-2"),
        )
        scenes.append(scene)
        if scene.has_narration:
            narr_text = _flatten_prose(s.get("narration", ""))
            if narr_text:
                narration[sid] = narr_text
    state_changes: list[StateChange] = []
    for ch in (raw.get("state_changes") or []):
        if not isinstance(ch, dict):
            continue
        entity = str(ch.get("entity") or "").strip()
        at_scene = str(ch.get("at_scene") or "").strip()
        if not entity or not at_scene:
            continue
        state_changes.append(StateChange(
            entity=entity,
            at_scene=at_scene,
            add=list(ch.get("add") or []),
            remove=list(ch.get("remove") or []),
            reset=bool(ch.get("reset", False)),
            note=str(ch.get("note") or "").strip(),
        ))

    return ProjectSpec(
        anchors=anchors,
        scenes=scenes,
        narration=narration,
        global_config=dict(gc),
        validation=_load_validation(raw.get("validation", {})),
        assets=_load_assets(raw.get("assets", {})),
        state_changes=state_changes,
    )


def load_project_spec(path: Path) -> ProjectSpec:
    """Load a YAML file into a ProjectSpec."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return load_project_spec_from_dict(raw or {})
