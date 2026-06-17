# -*- coding: utf-8 -*-
"""Director — natural-language storyboard edits.

The console panel's "Director" chat lets a user type a free-form
instruction ("make scene 3 at dusk, swap the boy's jacket to red, add a
seagull") and have it applied to the project's scene specs. This module
does the two halves:

  * ``interpret`` — ask the LLM to translate one instruction, against the
    current storyboard, into a structured set of per-scene patches.
  * ``apply_director_patches`` — validate + apply those patches to the
    draft (pure, no I/O, no LLM), returning a human-readable changelog.

Design choice: the director edits the *spec* only — it never triggers
(paid) image/video generation. After the spec is patched the user
re-rolls the affected scenes from the panel (the inline per-scene
Re-roll). That keeps a clean human-in-the-loop money gate: the model
proposes and writes text; the human spends the dollars.
"""

from __future__ import annotations

import logging

from pipeline.stage_00_script import (  # noqa: E402
    _DEFAULT_MODEL,
    _call_llm_decompose,
)

logger = logging.getLogger(__name__)

# Scene fields the director may set. Mirrors the safe creative subset of
# the panel's SceneEditRequest — deliberately excludes provider/model
# switches and id (renaming a scene id breaks downstream references).
_STR_FIELDS = {
    "name",
    "narration",
    "scene_description",
    "motion_prompt",
    "regen_notes",
    "uses_scene_ref",
}
_INT_FIELDS = {"duration"}
_BOOL_FIELDS = {"has_narration", "standalone"}
_LIST_FIELDS = {"uses_characters", "uses_props"}
_PATCHABLE = _STR_FIELDS | _INT_FIELDS | _BOOL_FIELDS | _LIST_FIELDS


def _scene_id(scene: dict) -> str:
    return str(scene.get("id") or scene.get("scene_id") or "")


def _coerce(field: str, value):
    """Coerce an LLM-supplied value to the field's expected shape.

    Returns ``(ok, coerced)``. ``ok`` is False when the value can't be
    sensibly coerced, so the caller can skip it rather than write junk.
    """
    if field in _INT_FIELDS:
        try:
            return True, int(value)
        except (TypeError, ValueError):
            return False, None
    if field in _BOOL_FIELDS:
        if isinstance(value, bool):
            return True, value
        if isinstance(value, str):
            return True, value.strip().lower() in ("true", "1", "yes")
        return False, None
    if field in _LIST_FIELDS:
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            return False, None
        return True, [str(v).strip() for v in value if str(v).strip()]
    if field == "uses_scene_ref":
        if value is None:
            return True, None
        s = str(value).strip()
        return True, (s or None)
    # plain string fields
    if value is None:
        return False, None
    return True, str(value)


def apply_director_patches(
    draft: dict, patches: list,
) -> tuple[dict, list]:
    """Apply validated per-scene patches to ``draft`` in place.

    ``patches`` is a list of ``{"scene_id": str, "set": {field: value},
    "reason": str}``. Patches that reference an unknown scene id, or set
    a non-patchable / un-coercible field, are skipped defensively (a
    fuzzy LLM must never corrupt the spec or crash the route).

    Returns ``(draft, changes)`` where ``changes`` is a per-scene
    changelog: ``{"scene_id", "name", "fields": [...], "reason"}``.
    """
    scenes_by_id = {
        _scene_id(s): s for s in (draft.get("scenes") or [])
    }
    changes: list = []
    for patch in patches or []:
        if not isinstance(patch, dict):
            continue
        sid = str(patch.get("scene_id") or "").strip()
        scene = scenes_by_id.get(sid)
        if scene is None:
            logger.info("[director] skip patch for unknown scene %r", sid)
            continue
        updates = patch.get("set")
        if not isinstance(updates, dict):
            continue
        applied: list = []
        for field, value in updates.items():
            if field not in _PATCHABLE:
                continue
            ok, coerced = _coerce(field, value)
            if not ok:
                continue
            if scene.get(field) == coerced:
                continue  # no-op — don't report unchanged fields
            scene[field] = coerced
            applied.append(field)
        if applied:
            changes.append({
                "scene_id": sid,
                "name": scene.get("name"),
                "fields": applied,
                "reason": str(patch.get("reason") or "").strip(),
            })
    return draft, changes


def _scene_context(draft: dict) -> str:
    """Compact storyboard digest the LLM patches against."""
    lines: list = []
    assets = draft.get("assets") or {}
    chars = [c.get("id") for c in (assets.get("characters") or [])]
    props = [p.get("id") for p in (assets.get("props") or [])]
    refs = [r.get("id") for r in (assets.get("scene_refs") or [])]
    lines.append(f"characters: {chars or '(none)'}")
    lines.append(f"props: {props or '(none)'}")
    lines.append(f"settings: {refs or '(none)'}")
    lines.append("")
    for s in draft.get("scenes") or []:
        lines.append(
            f"- id={_scene_id(s)} name={s.get('name')} "
            f"dur={s.get('duration')}s\n"
            f"    desc: {str(s.get('scene_description') or '')[:200]}\n"
            f"    motion: {str(s.get('motion_prompt') or '')[:120]}\n"
            f"    narration: {str(s.get('narration') or '')[:120]}\n"
            f"    uses: chars={s.get('uses_characters') or []} "
            f"props={s.get('uses_props') or []} "
            f"setting={s.get('uses_scene_ref')}",
        )
    return "\n".join(lines)


def build_director_prompt(
    draft: dict, message: str,
) -> tuple[str, str]:
    system = (
        "You are the DIRECTOR'S ASSISTANT for a storyboard video. The "
        "user gives a free-form instruction; you translate it into "
        "concrete edits to existing scenes. You edit only the SPEC — "
        "you never render anything.\n\n"
        "Rules:\n"
        "1. Only patch scenes that already exist (use their exact ids).\n"
        "2. Only set these fields: scene_description, motion_prompt, "
        "narration, duration, has_narration, standalone, name, "
        "uses_characters, uses_props, uses_scene_ref, regen_notes.\n"
        "3. uses_characters/uses_props/uses_scene_ref must reference ids "
        "that exist in the asset lists above — never invent ids.\n"
        "4. For any VISUAL change (lighting, wardrobe, added/removed "
        "objects, framing), ALSO append a short, imperative note to "
        "regen_notes so the next frame re-roll applies it — e.g. "
        "\"at dusk, warmer key light; red jacket\". Append, don't "
        "replace existing intent.\n"
        "5. Touch the fewest scenes needed. If the instruction is "
        "global (\"make it all rainier\"), patch every relevant scene.\n"
        "6. Output ONLY valid JSON — no markdown, no commentary."
    )
    user = (
        "# Current storyboard\n\n"
        f"{_scene_context(draft)}\n\n"
        "# Instruction\n\n"
        f"{message.strip()}\n\n"
        "# Required JSON output schema:\n"
        "{\n"
        '  "summary": "<one sentence describing what you changed and '
        'why, in plain language for the user>",\n'
        '  "patches": [\n'
        '    {\n'
        '      "scene_id": "<existing scene id>",\n'
        '      "set": {"<field>": <new value>, "...": "..."},\n'
        '      "reason": "<short why, shown next to the scene>"\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "If nothing actionable maps to existing scenes, return "
        '{"summary": "<why nothing changed>", "patches": []}.'
    )
    return system, user


async def interpret(
    draft: dict,
    message: str,
    *,
    api_key: str,
    model: str = _DEFAULT_MODEL,
    timeout_s: float = 90.0,
) -> dict:
    """Translate one NL instruction into ``{summary, patches}``.

    Returns the parsed LLM object (already shape-guarded to have a
    ``summary`` string and a ``patches`` list). Raises on transport or
    JSON errors — the route turns that into a 500.
    """
    system, user = build_director_prompt(draft, message)
    logger.info(
        "[director] interpret instruction (%d chars) over %d scene(s) "
        "via %s",
        len(message), len(draft.get("scenes") or []), model,
    )
    resp = await _call_llm_decompose(
        system=system, user=user,
        model=model, api_key=api_key, timeout_s=timeout_s,
    )
    if not isinstance(resp, dict):
        resp = {}
    summary = resp.get("summary")
    patches = resp.get("patches")
    return {
        "summary": str(summary or "").strip(),
        "patches": patches if isinstance(patches, list) else [],
    }
