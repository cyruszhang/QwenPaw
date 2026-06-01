# -*- coding: utf-8 -*-
"""Stage 00 v2 — two-pass decomposition.

The v1 single-call decomposition (``stage_00_script.py``) asks one
LLM call to do six jobs at once: identify characters, identify
recurring settings, pick a style preset, slice the story into N
scenes, write per-scene visual descriptions, write per-scene
narration. On long sources it loses content because the scene cap is
hardcoded and the LLM has no "this story actually needs more scenes"
escape hatch.

v2 splits the work:

  Pass 1 — ``extract_beats``:
    Identify anchors (characters + scene_refs + style preset) and
    slice the source into a BEAT SHEET — an ordered list of story
    moments with brief summaries and the refs each one uses. Beat
    count scales with source length / duration target; no hard cap.

  HITL gate (in the UI):
    User reviews the beat sheet, optionally edits / adds / removes /
    reorders. Cheap iteration — beats are 1-3 sentences each, not
    the full per-scene prose.

  Pass 2 — ``craft_scenes``:
    Per beat, write the full scene specification (scene_description,
    motion_prompt, narration, overlays, etc). Single LLM call so the
    storyboard-wide context produces consistent voice and style.

The v1 module is kept around for backward compat (existing projects
already have ``scenes:`` populated in their project.yml).
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from pipeline.stage_00_script import (  # noqa: E402
    _DEFAULT_MODEL,
    _add_anchor_fallback,
    _call_llm_decompose,
    _ensure_style_catalog_block,
    _fill_global_config_defaults,
    _load_style_catalog_names,
    _normalize_ids,
)

logger = logging.getLogger(__name__)


def _snake(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", (s or "").strip()).strip("_").lower()
    return s or "x"


def _suggested_beat_count(duration_target_s: int) -> tuple[int, int]:
    """Suggest (min, max) beat counts for the given duration target.

    Targets ~6-12 seconds per beat. Long durations get more beats.
    No hard upper cap — the user can override with ``target_scenes``.
    """
    n_min = max(3, duration_target_s // 12)
    n_max = max(n_min + 2, duration_target_s // 6)
    return n_min, n_max


# ── Pass 1 prompts ──────────────────────────────────────────────────


def _build_pass1_prompt(
    text: str,
    *,
    duration_target_s: int,
    audience: Optional[str],
    voice: str,
    style_hint: Optional[str],
    style_catalog: list[dict],
    era: Optional[str],
    country: Optional[str],
    genre: Optional[str],
    tone: Optional[str],
    story_anchor: Optional[str],
    world_bible: Optional[str],
    style_directives: Optional[list[str]],
    target_scenes: Optional[int],
) -> tuple[str, str]:
    n_min, n_max = _suggested_beat_count(duration_target_s)
    if target_scenes and target_scenes > 0:
        n_min = n_max = int(target_scenes)
        beat_count_hint = f"exactly {n_min} beats"
    else:
        beat_count_hint = (
            f"{n_min}-{n_max} beats (use the upper end for richer "
            f"stories; don't over-compress long sources)"
        )

    styles_table = "\n".join(
        f"  - {s['id']}: {s['display_name']} — {s['description']}"
        for s in style_catalog
    )

    anchor_block = ""
    if story_anchor:
        anchor_block = (
            "\n# Story anchor (overall narrative context):\n"
            f"{story_anchor.strip()}\n"
        )
    world_bible_block = ""
    if world_bible:
        world_bible_block = (
            "\n# World bible (invariants — recurring set-design facts):\n"
            f"{world_bible.strip()}\n"
        )
    directives_block = ""
    if style_directives:
        directives_block = (
            "\n# Style directives:\n"
            + "\n".join(f"  - {d}" for d in style_directives if d.strip())
            + "\n"
        )

    constraints = [
        f"- Total video duration: ~{duration_target_s} seconds",
        f"- Beat count: aim for {beat_count_hint}",
        f"- Audience: {audience or 'general / family'}",
        f"- Style hint: {style_hint or '(none — pick from catalog)'}",
        f"- Narration voice: {voice}",
    ]
    if era:
        constraints.append(f"- Era / time period: {era}")
    if country:
        constraints.append(f"- Country / setting: {country}")
    if genre:
        constraints.append(f"- Genre: {genre}")
    if tone:
        constraints.append(f"- Tone: {tone}")

    system = (
        "You are the storyboard PRODUCER. In this pass you do ONLY "
        "story structure — not visual descriptions.\n\n"
        "Your four jobs:\n"
        "  1. Identify recurring characters (brief, concrete physical "
        "     descriptions — they'll be rendered as reference images).\n"
        "  2. Identify recurring settings (locations the camera "
        "     returns to — also rendered as reference images).\n"
        "  3. Pick exactly ONE style preset id from the catalog.\n"
        "  4. Slice the source into a beat sheet — an ordered list of "
        "     story moments. Each beat is 1-3 sentences SUMMARIZING "
        "     what happens; do NOT write full visual descriptions or "
        "     narration text (that's the next pass's job).\n\n"
        "Critically: don't drop story content to hit a beat count. If "
        "the source is long, use more beats. The beat-count hint is a "
        "target, not a hard cap — aggressive compression is the worst "
        "failure mode.\n\n"
        "Output ONLY valid JSON matching the schema below. No "
        "markdown fences, no commentary."
    )

    user = (
        "# Source\n\n"
        f"<source>\n{text.strip()}\n</source>\n\n"
        "# Targets\n\n"
        + "\n".join(constraints)
        + "\n"
        + anchor_block
        + world_bible_block
        + directives_block
        + "\n"
        "# Available style catalog (pick ONE id for assets.style.catalog_id):\n"
        f"{styles_table}\n\n"
        "# Required JSON output schema:\n"
        "{\n"
        '  "project_id": "<short_snake_case>",\n'
        '  "assets": {\n'
        '    "characters": [\n'
        '      {"id": "<snake_case>", "description": "<concrete physical '
        'description, ~150 chars: age, build, clothing, distinguishing '
        'features. No personality, no backstory.>"}\n'
        '    ],\n'
        '    "scene_refs": [\n'
        '      {"id": "<snake_case>", "description": "<location/setting '
        'description, ~150 chars: visual elements that recur across '
        'scenes set here. No characters, no actions.>"}\n'
        '    ],\n'
        '    "style": {"catalog_id": "<one id from the catalog above>"}\n'
        '  },\n'
        '  "global_config": {},\n'
        '  "beats": [\n'
        '    {\n'
        '      "name": "<short_snake_case_label, e.g. solitary_sailor>",\n'
        '      "summary": "<1-3 sentences: what happens in this beat>",\n'
        '      "chars_used": ["<char_id>", ...],\n'
        '      "setting_used": "<scene_ref_id or null if no recurring '
        'setting (e.g. title card)>",\n'
        '      "est_seconds": <int 4-15>,\n'
        '      "has_narration": <bool — false ONLY for title/credit '
        'cards>\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "Beat-sheet rules:\n"
        "1. Don't drop content. Long source → more beats.\n"
        "2. has_narration=false ONLY for title/credit cards.\n"
        "3. chars_used / setting_used must reference ids defined in "
        "assets — typos break the downstream pipeline.\n"
        "4. est_seconds: 4-6 for title/credit beats; 8-12 for story "
        "beats; up to 15 for climactic moments.\n"
        "5. Order matters — beats will be rendered in array order.\n"
        "6. Do NOT include scene_description, motion_prompt, or "
        "narration text in this pass.\n"
    )

    return system, user


# ── Pass 2 prompts ──────────────────────────────────────────────────


def _build_pass2_prompt(draft_with_beats: dict) -> tuple[str, str]:
    assets = draft_with_beats.get("assets") or {}
    beats = draft_with_beats.get("beats") or []
    gc = draft_with_beats.get("global_config") or {}

    chars = assets.get("characters") or []
    scene_refs = assets.get("scene_refs") or []
    style = assets.get("style") or {}

    chars_summary = "\n".join(
        f"  - {c.get('id')}: {c.get('description', '')[:200]}"
        for c in chars
    ) or "  (none)"
    settings_summary = "\n".join(
        f"  - {s.get('id')}: {s.get('description', '')[:200]}"
        for s in scene_refs
    ) or "  (none)"
    style_id = style.get("catalog_id") or "?"
    style_template = style.get("positive_template") or ""

    beats_table = "\n".join(
        f"  Beat {i:02d} ({b.get('name', '')}): "
        f"{b.get('summary', '')} "
        f"[chars: {','.join(b.get('chars_used') or []) or 'none'}; "
        f"setting: {b.get('setting_used') or 'none'}; "
        f"est_s: {b.get('est_seconds', 8)}; "
        f"narration: {b.get('has_narration', True)}]"
        for i, b in enumerate(beats)
    )

    anchor_block = ""
    if gc.get("story_anchor"):
        anchor_block = (
            f"\nStory anchor (overall narrative context): "
            f"{gc['story_anchor']}\n"
        )
    world_bible_block = ""
    if gc.get("world_bible"):
        world_bible_block = (
            f"\nWorld bible (invariants across every scene): "
            f"{gc['world_bible']}\n"
        )
    directives_block = ""
    if gc.get("style_directives"):
        directives_block = (
            "\nStyle directives (apply to every scene's composition): "
            + "; ".join(gc["style_directives"])
            + "\n"
        )

    system = (
        "You are the SCENE CRAFTER. The anchors (characters, "
        "settings, style) are LOCKED — reference them by id, don't "
        "invent new ones. For each beat in the beat sheet, write the "
        "full scene specification.\n\n"
        "Key separation: scene_description describes ACTIONS happening "
        "in the frame — NOT character appearance (anchored), NOT "
        "setting appearance (anchored), NOT style (anchored). The "
        "downstream image model will compose the frame from the "
        "character/setting/style reference images PLUS your "
        "scene_description. Repeating anchor details in the "
        "description crowds out the action signal.\n\n"
        "Output ONLY valid JSON matching the schema. No markdown, no "
        "commentary."
    )

    user = (
        "# Locked anchors\n\n"
        f"Characters:\n{chars_summary}\n\n"
        f"Settings:\n{settings_summary}\n\n"
        f"Style: {style_id}\n"
        f"  template: {style_template[:300]}\n"
        + anchor_block + world_bible_block + directives_block
        + "\n# Beat sheet (write one scene per beat, IN ORDER):\n\n"
        f"{beats_table}\n\n"
        "# Required JSON output schema:\n"
        "{\n"
        '  "scenes": [\n'
        '    {\n'
        '      "name": "<copy from beat.name>",\n'
        '      "scene_description": "<visual prose ~250-400 chars: '
        'WHAT IS HAPPENING in this frame — actions, poses, '
        'expressions, prop interactions. Do NOT describe '
        'character appearance, setting appearance, or art style — '
        'those are anchored.>",\n'
        '      "motion_prompt": "<verbs + camera ~80-150 chars for '
        'I2V animation: subject motion, camera move, transitions. '
        'E.g. \\"slow push-in on the bow as the old man pulls the '
        'line tight; subtle swell below.\\">",\n'
        '      "narration": "<spoken text, MUST be ≤ duration*18 '
        'chars (longshu_v2 budget at 1.0x rate). Empty string if '
        'has_narration:false.>",\n'
        '      "duration": <int seconds; default to beat.est_seconds '
        'but you may adjust within 4-15>,\n'
        '      "has_narration": <copy from beat>,\n'
        '      "standalone": <true for title/credit scenes that '
        "don't reference anchors, else false>,\n"
        '      "uses_characters": <list, copy from beat.chars_used>,\n'
        '      "uses_scene_ref": <string or null, copy from '
        'beat.setting_used>,\n'
        '      "uses_style": true,\n'
        '      "n_candidates": 1,\n'
        '      "overlay": [],\n'
        '      "validation_rules": {\n'
        '        "must_contain": [\n'
        '          "<short visual claim that MUST be true of this '
        'frame, e.g. \\"a wooden mast is clearly visible\\". 3-6 '
        'rules; concrete + verifiable by a vision model in one '
        "yes/no question. Don't restate the whole scene.>\"\n"
        '        ],\n'
        '        "must_not_contain": [\n'
        '          "<short claim about something that MUST NOT be in '
        'the frame, e.g. \\"other ships visible on the horizon\\". '
        '0-3 rules; only when there is a real failure mode worth '
        "guarding against>\"\n"
        '        ],\n'
        '        "composition": [\n'
        '          "<short geometric/relational claim, e.g. \\"the '
        'character occupies the right third of the frame\\". 0-3 '
        "rules; skip if not applicable>\"\n"
        '        ]\n'
        '      }\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "Crafting rules:\n"
        "1. scene_description: ACTIONS only. 'The old man hauls the "
        "line, knees braced against the gunwale, face strained.' "
        "NOT 'an elderly Cuban fisherman in a weathered hat hauls...'\n"
        "2. motion_prompt: imperative verbs + camera direction. "
        "Avoid noun lists. Limit to one or two motion ideas per scene.\n"
        "3. narration: respect duration*18 char budget. Match tone "
        "to the voice and audience. Empty string when has_narration "
        "is false.\n"
        "4. standalone:true scenes (title/credits) leave "
        "uses_characters=[] and uses_scene_ref=null.\n"
        "5. uses_characters / uses_scene_ref must EXACTLY match the "
        "beat's chars_used / setting_used (copy them through).\n"
        "6. Output ONE scene per beat, in the same order as the beat "
        "sheet. Don't add or drop scenes.\n"
        "7. Title-card beats may use overlay entries for the title "
        "text; otherwise leave overlay as [].\n"
        "8. validation_rules: write 3-6 must_contain claims that a "
        "vision model could verify with one yes/no question each. Each "
        "claim should be ATOMIC (one fact per claim) and OBSERVABLE "
        "(visible in the frame, not motion or audio). Skip rules for "
        "things the anchors already guarantee — focus on per-scene "
        "specifics. must_not_contain: only add when there's a real "
        "failure mode (e.g. \"other characters visible\" for a "
        "solitary scene). composition: only when the geometry "
        "matters. Empty arrays are OK.\n"
    )

    return system, user


# ── Public entries ──────────────────────────────────────────────────


async def extract_beats(
    *,
    text: str,
    api_key: str,
    duration_target_s: int = 60,
    style_hint: Optional[str] = None,
    audience: Optional[str] = None,
    voice: str = "longshu_v2",
    model: str = _DEFAULT_MODEL,
    timeout_s: float = 90.0,
    era: Optional[str] = None,
    country: Optional[str] = None,
    genre: Optional[str] = None,
    tone: Optional[str] = None,
    story_anchor: Optional[str] = None,
    style_directives: Optional[list[str]] = None,
    world_bible: Optional[str] = None,
    target_scenes: Optional[int] = None,
    frame_provider: Optional[str] = None,
    video_provider: Optional[str] = None,
) -> dict:
    """Pass 1: produce a draft with anchors + beat sheet (scenes:[] empty).

    Returns a draft dict shaped like a ProjectSpec YAML, except
    ``scenes`` is empty and a new top-level ``beats`` array carries
    the beat sheet for the UI to render + edit before Pass 2.
    """
    catalog = _load_style_catalog_names()
    system, user = _build_pass1_prompt(
        text=text,
        duration_target_s=duration_target_s,
        audience=audience,
        voice=voice,
        style_hint=style_hint,
        style_catalog=catalog,
        era=era, country=country, genre=genre, tone=tone,
        story_anchor=story_anchor,
        world_bible=world_bible,
        style_directives=style_directives,
        target_scenes=target_scenes,
    )
    logger.info(
        "[stage 00 v2 pass 1] extract beats from %d-char source via %s "
        "(duration~%ds, %s)",
        len(text), model, duration_target_s,
        f"target={target_scenes}" if target_scenes else "auto-count",
    )
    draft = await _call_llm_decompose(
        system=system, user=user,
        model=model, api_key=api_key, timeout_s=timeout_s,
    )

    # Normalize IDs (character / scene_ref ids → snake_case;
    # _normalize_ids also renumbers scenes but our scenes:[] is empty).
    draft.setdefault("scenes", [])
    _normalize_ids(draft)
    _ensure_style_catalog_block(draft, catalog)
    _add_anchor_fallback(draft)
    _fill_global_config_defaults(draft)

    # Beat-id stamp + name snake-case.
    beats = draft.get("beats") or []
    for idx, b in enumerate(beats):
        b["id"] = f"{idx:02d}"
        b["name"] = _snake(b.get("name", f"beat_{idx}"))
        # Coerce numeric/bool fields the LLM may stringify.
        try:
            b["est_seconds"] = int(b.get("est_seconds", 8))
        except (TypeError, ValueError):
            b["est_seconds"] = 8
        b["has_narration"] = bool(b.get("has_narration", True))
        b["chars_used"] = list(b.get("chars_used") or [])
        b["setting_used"] = b.get("setting_used") or None
    draft["beats"] = beats

    # Persist user-supplied story-level constraints + per-project
    # provider picks into global_config.
    gc = draft.setdefault("global_config", {})
    if era: gc["era"] = era
    if country: gc["country"] = country
    if genre: gc["genre"] = genre
    if tone: gc["tone"] = tone
    if story_anchor and story_anchor.strip():
        gc["story_anchor"] = story_anchor.strip()
    if world_bible and world_bible.strip():
        gc["world_bible"] = world_bible.strip()
    if style_directives:
        cleaned = [d.strip() for d in style_directives if d and d.strip()]
        if cleaned:
            gc["style_directives"] = cleaned
    if frame_provider:
        gc["frame_provider"] = frame_provider
    if video_provider:
        gc["video_provider"] = video_provider

    logger.info(
        "[stage 00 v2 pass 1] done: %d beats, %d characters, "
        "%d scene_refs, style=%s",
        len(beats),
        len(draft.get("assets", {}).get("characters", [])),
        len(draft.get("assets", {}).get("scene_refs", [])),
        (draft.get("assets", {}).get("style") or {}).get("catalog_id"),
    )
    return draft


async def craft_scenes(
    draft_with_beats: dict,
    *,
    api_key: str,
    model: str = _DEFAULT_MODEL,
    timeout_s: float = 240.0,
) -> dict:
    """Pass 2: craft full scene specs from the beat sheet.

    Mutates ``draft_with_beats``: replaces / populates the ``scenes``
    list. Beats are preserved so the user can re-craft from them if
    they want to iterate.
    """
    beats = draft_with_beats.get("beats") or []
    if not beats:
        raise RuntimeError(
            "no beats to craft from — run extract_beats first or add "
            "beats to the draft",
        )

    system, user = _build_pass2_prompt(draft_with_beats)
    logger.info(
        "[stage 00 v2 pass 2] crafting %d scenes from beats via %s",
        len(beats), model,
    )
    pass2 = await _call_llm_decompose(
        system=system, user=user,
        model=model, api_key=api_key, timeout_s=timeout_s,
    )
    scenes = pass2.get("scenes") or []
    if not scenes:
        raise RuntimeError(
            f"Pass 2 produced no scenes — raw response: {pass2}",
        )
    if len(scenes) != len(beats):
        logger.warning(
            "[stage 00 v2 pass 2] scene count %d != beat count %d — "
            "LLM compressed or expanded the beat sheet against "
            "instructions",
            len(scenes), len(beats),
        )

    # Stamp ids + propagate per-project provider defaults onto each
    # scene so Stage 2 / 3 have what they need without re-resolving
    # from global_config every call.
    gc = draft_with_beats.get("global_config") or {}
    fp_default = gc.get("frame_provider") or "gpt-image-2"
    vp_default = gc.get("video_provider") or "wan27"

    # Lift per-scene validation_rules emitted inline by the LLM into
    # the project-level validation.per_scene map (matches the schema
    # ValidationRules / SceneValidationRules dataclasses expect). The
    # inline shape is friendlier for the LLM to reason about; the
    # lifted shape is what stage_02_5_validate reads.
    validation_block = draft_with_beats.setdefault("validation", {})
    per_scene_rules: dict = validation_block.get("per_scene") or {}

    for idx, sc in enumerate(scenes):
        sid = f"{idx:02d}"
        sc["id"] = sid
        sc["name"] = _snake(sc.get("name", f"scene_{idx}"))
        sc.setdefault("frame_provider", fp_default)
        sc.setdefault("video_provider", vp_default)
        sc.setdefault("overlay", [])
        # Defensive defaults for fields the LLM might omit:
        sc.setdefault("uses_characters", [])
        sc.setdefault("uses_scene_ref", None)
        sc.setdefault("uses_style", True)
        sc.setdefault("standalone", False)
        sc.setdefault("n_candidates", 1)
        try:
            sc["duration"] = int(sc.get("duration", 8))
        except (TypeError, ValueError):
            sc["duration"] = 8
        sc["has_narration"] = bool(sc.get("has_narration", True))

        # Extract inline validation_rules → per-scene block. Each
        # rule list is filtered to non-empty strings.
        rules_inline = sc.pop("validation_rules", None) or {}
        cleaned = {
            "must_contain": [
                str(r).strip()
                for r in (rules_inline.get("must_contain") or [])
                if r and str(r).strip()
            ],
            "must_not_contain": [
                str(r).strip()
                for r in (rules_inline.get("must_not_contain") or [])
                if r and str(r).strip()
            ],
            "composition": [
                str(r).strip()
                for r in (rules_inline.get("composition") or [])
                if r and str(r).strip()
            ],
        }
        if any(cleaned.values()):
            per_scene_rules[sid] = cleaned

    if per_scene_rules:
        validation_block["per_scene"] = per_scene_rules
        draft_with_beats["validation"] = validation_block

    draft_with_beats["scenes"] = scenes
    n_rules = sum(
        len(r.get("must_contain", []))
        + len(r.get("must_not_contain", []))
        + len(r.get("composition", []))
        for r in per_scene_rules.values()
    )
    logger.info(
        "[stage 00 v2 pass 2] done: %d scenes, %d validation rule(s) "
        "across %d scene(s)",
        len(scenes), n_rules, len(per_scene_rules),
    )
    return draft_with_beats
