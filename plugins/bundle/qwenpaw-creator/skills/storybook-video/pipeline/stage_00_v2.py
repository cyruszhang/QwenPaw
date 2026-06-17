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

import asyncio
import json
import logging
import re
from typing import Callable, Optional

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

    constraints = [
        f"- Total video duration: ~{duration_target_s} seconds",
        f"- Beat count: aim for {beat_count_hint}",
        f"- Audience: {audience or 'general / family'}",
        f"- Style hint: {style_hint or '(none — pick from catalog)'}",
        f"- Narration voice: {voice}",
    ]
    # Each story-constraint field: "(user-provided)" means accept it
    # as authoritative; "(blank — infer from source)" means extract.
    def _fmt(label: str, val: Optional[str]) -> str:
        if val and str(val).strip():
            return f"- {label}: {val} (user-provided; use authoritatively)"
        return f"- {label}: (blank — infer from source + cite evidence)"

    constraints.append(_fmt("Era / time period", era))
    constraints.append(_fmt("Country / setting", country))
    constraints.append(_fmt("Genre", genre))
    constraints.append(_fmt("Tone", tone))
    constraints.append(_fmt("Story anchor", story_anchor))
    constraints.append(_fmt("World bible", world_bible))
    constraints.append(
        _fmt(
            "Style directives",
            "; ".join(style_directives) if style_directives else None,
        ),
    )

    system = (
        "You are the storyboard PRODUCER. In this pass you do ONLY "
        "story structure — not visual descriptions.\n\n"
        "Your jobs:\n"
        "  1. Identify recurring characters (brief, concrete physical "
        "     descriptions — they'll be rendered as reference images).\n"
        "  2. Identify key props / 道具: portable objects with story "
        "     importance or continuity across settings (sword, boat, "
        "     book, scale, map, letter, tool, heirloom, etc.).\n"
        "  3. Identify recurring settings (locations the camera "
        "     returns to — also rendered as reference images).\n"
        "  4. Pick exactly ONE style preset id from the catalog.\n"
        "  5. Slice the source into a beat sheet — an ordered list of "
        "     story moments. Each beat is 1-3 sentences SUMMARIZING "
        "     what happens; do NOT write full visual descriptions or "
        "     narration text (that's the next pass's job).\n"
        "  6. INFER the story constraints (era, country, genre, tone, "
        "     story_anchor, world_bible, style_directives) FROM the "
        "     source. For each, also provide a short evidence quote "
        "     from the source that justifies your inference, so the "
        "     user can verify.\n\n"
        "Critically: don't drop story content to hit a beat count. If "
        "the source is long, use more beats. The beat-count hint is a "
        "target, not a hard cap — aggressive compression is the worst "
        "failure mode.\n\n"
        "User-provided constraints (in Targets below) are AUTHORITATIVE "
        "— echo them verbatim into global_config. Blank constraints — "
        "you MUST INFER them from the source AND cite evidence.\n\n"
        "Output ONLY valid JSON matching the schema below. No "
        "markdown fences, no commentary."
    )

    user = (
        "# Source\n\n"
        f"<source>\n{text.strip()}\n</source>\n\n"
        "# Targets\n\n"
        + "\n".join(constraints)
        + "\n\n"
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
        '    "props": [\n'
        '      {"id": "<snake_case>", "description": "<portable key object '
        '/ 道具, ~150 chars: material, color, silhouette, scale, markings, '
        'wear, and distinctive details. Not a location, not a character.>"}\n'
        '    ],\n'
        '    "scene_refs": [\n'
        '      {"id": "<snake_case>", "description": "<location/setting '
        'description, ~150 chars: visual elements that recur across '
        'scenes set here. No characters, no actions.>"}\n'
        '    ],\n'
        '    "style": {"catalog_id": "<one id from the catalog above>"}\n'
        '  },\n'
        '  "global_config": {\n'
        '    "era": "<e.g. 1940s, medieval, near-future>",\n'
        '    "country": "<e.g. Cuba, rural China, fictional realm>",\n'
        '    "genre": "<e.g. tragedy, fable, coming-of-age>",\n'
        '    "tone": "<e.g. somber, playful, hopeful>",\n'
        '    "story_anchor": "<one or two sentences summarizing the '
        'overall narrative arc — propagates to every scene>",\n'
        '    "world_bible": "<2-4 sentence list of invariants that '
        'must hold across every scene: props, palette, lighting, '
        'camera rules>",\n'
        '    "style_directives": ["<short style suggestion>", '
        '"<another>", "..."]\n'
        '  },\n'
        '  "constraint_evidence": {\n'
        '    "era": "<short quote from source supporting this; OMIT '
        "the field if it was user-provided>\",\n"
        '    "country": "<short quote>",\n'
        '    "genre": "<short quote or 1-sentence justification>",\n'
        '    "tone": "<short quote>",\n'
        '    "story_anchor": "<short quote(s) that capture the arc>",\n'
        '    "world_bible": "<short quote(s) for the recurring facts>",\n'
        '    "style_directives": "<short reason for these choices>"\n'
        '  },\n'
        '  "beats": [\n'
        '    {\n'
        '      "name": "<short_snake_case_label, e.g. solitary_sailor>",\n'
        '      "summary": "<1-3 sentences: what happens in this beat>",\n'
        '      "chars_used": ["<char_id>", ...],\n'
        '      "props_used": ["<prop_id>", ...],\n'
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
        "3. chars_used / props_used / setting_used must reference ids defined in "
        "assets — typos break the downstream pipeline.\n"
        "4. est_seconds: 4-6 for title/credit beats; 8-12 for story "
        "beats; up to 15 for climactic moments.\n"
        "5. Order matters — beats will be rendered in array order.\n"
        "6. Do NOT include scene_description, motion_prompt, or "
        "narration text in this pass.\n"
    )

    return system, user


# ── Pass 2 prompts ──────────────────────────────────────────────────


def _pass2_anchor_context(draft_with_beats: dict) -> str:
    """The shared 'locked anchors + story context' block injected into
    every per-beat Pass 2 call."""
    assets = draft_with_beats.get("assets") or {}
    gc = draft_with_beats.get("global_config") or {}
    chars = assets.get("characters") or []
    props = assets.get("props") or []
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
    props_summary = "\n".join(
        f"  - {p.get('id')}: {p.get('description', '')[:200]}"
        for p in props
    ) or "  (none)"
    style_id = style.get("catalog_id") or "?"
    style_template = style.get("positive_template") or ""

    blocks = [
        "# Locked anchors\n",
        f"Characters:\n{chars_summary}\n",
        f"Props:\n{props_summary}\n",
        f"Settings:\n{settings_summary}\n",
        f"Style: {style_id}\n  template: {style_template[:300]}\n",
    ]
    if gc.get("story_anchor"):
        blocks.append(f"Story anchor: {gc['story_anchor']}\n")
    if gc.get("world_bible"):
        blocks.append(
            f"World bible (invariants across every scene): "
            f"{gc['world_bible']}\n"
        )
    if gc.get("style_directives"):
        blocks.append(
            "Style directives (apply to the composition): "
            + "; ".join(gc["style_directives"]) + "\n"
        )
    return "\n".join(blocks)


def _build_pass2_beat_prompt(
    anchor_context: str, beat: dict, beat_index: int,
) -> tuple[str, str]:
    """Build (system, user) for crafting ONE scene from ONE beat.

    Per-beat instead of all-beats-in-one-call: keeps each LLM output
    small (one scene object), guarantees a 1:1 beat→scene mapping, and
    lets the caller fan out concurrently. The previous single-call
    approach compressed long beat sheets (e.g. 8 beats → 1 scene) and
    produced oversized JSON that malformed.
    """
    system = (
        "You are the SCENE CRAFTER. The anchors (characters, "
        "settings, style) are LOCKED — reference them by id, never "
        "invent new ones. You are given ONE story beat; write ONE "
        "full scene specification for it.\n\n"
        "Key separation: scene_description describes ACTIONS happening "
        "in the frame — NOT character appearance (anchored), NOT "
        "setting appearance (anchored), NOT art style (anchored). The "
        "downstream image model composes the frame from the "
        "reference images PLUS your scene_description; repeating "
        "anchor details crowds out the action signal.\n\n"
        "Output ONLY valid JSON matching the schema. No markdown, no "
        "commentary, no array — a single JSON object."
    )

    chars_used = beat.get("chars_used") or []
    props_used = beat.get("props_used") or []
    setting_used = beat.get("setting_used")
    user = (
        anchor_context
        + "\n# The beat to craft (write exactly ONE scene for it):\n\n"
        f"name: {beat.get('name', f'beat_{beat_index}')}\n"
        f"summary: {beat.get('summary', '')}\n"
        f"characters present (use these ids verbatim): "
        f"{chars_used or 'none'}\n"
        f"key props present (use these ids verbatim): "
        f"{props_used or 'none'}\n"
        f"setting (use this id verbatim): {setting_used or 'none'}\n"
        f"target duration: {beat.get('est_seconds', 8)}s\n"
        f"has_narration: {beat.get('has_narration', True)}\n\n"
        "# Required JSON output schema (ONE object, NOT an array):\n"
        "{\n"
        '  "name": "<copy the beat name>",\n'
        '  "scene_description": "<visual prose ~250-400 chars: WHAT '
        'IS HAPPENING — actions, poses, expressions, prop '
        'interactions. NOT character/setting/style appearance.>",\n'
        '  "motion_prompt": "<verbs + camera ~80-150 chars for I2V: '
        'subject motion, camera move. E.g. \\"slow push-in on the '
        'bow as the old man pulls the line tight; subtle swell.\\">",\n'
        '  "narration": "<spoken text, ≤ duration*18 chars; empty '
        'string if has_narration is false>",\n'
        '  "duration": <int seconds, 4-15; default to the target>,\n'
        '  "has_narration": <copy from the beat>,\n'
        '  "standalone": <true only for title/credit scenes>,\n'
        '  "uses_characters": <list, copy the beat characters>,\n'
        '  "uses_props": <list, copy the beat key props>,\n'
        '  "uses_scene_ref": <string or null, copy the beat setting>,\n'
        '  "uses_style": true,\n'
        '  "n_candidates": 1,\n'
        '  "overlay": [],\n'
        '  "validation_rules": {\n'
        '    "must_contain": ["<3-6 atomic, observable visual claims '
        'a vision model can verify yes/no, e.g. \\"a wooden mast is '
        'clearly visible\\">"],\n'
        '    "must_not_contain": ["<0-3 claims for real failure modes, '
        'e.g. \\"other characters visible\\" for a solo scene>"],\n'
        '    "composition": ["<0-3 geometric claims; skip if N/A>"]\n'
        "  }\n"
        "}\n\n"
        "Rules:\n"
        "1. scene_description: ACTIONS only.\n"
        "2. motion_prompt: imperative verbs + camera; one or two "
        "ideas max.\n"
        "3. narration: respect the duration*18 char budget; empty "
        "string when has_narration is false.\n"
        "4. standalone:true → uses_characters=[] and "
        "uses_scene_ref=null.\n"
        "5. uses_characters / uses_props / uses_scene_ref must EXACTLY "
        "match the beat's character/prop/setting ids above.\n"
        "6. validation_rules.must_contain: 3-6 atomic + observable "
        "claims; skip what the anchors already guarantee. Empty "
        "arrays are fine for must_not_contain / composition.\n"
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
    on_delta: Optional[Callable[[str], None]] = None,
) -> dict:
    """Pass 1: produce a draft with anchors + beat sheet (scenes:[] empty).

    Returns a draft dict shaped like a ProjectSpec YAML, except
    ``scenes`` is empty and a new top-level ``beats`` array carries
    the beat sheet for the UI to render + edit before Pass 2.

    When ``on_delta`` is supplied the underlying LLM call streams and
    each incremental content chunk is forwarded to it, so the caller
    (the ``/decompose`` route) can broadcast live progress over SSE.
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
        on_delta=on_delta,
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
        # chars_used must be a list of ids. The LLM sometimes returns a
        # bare string ("ona") instead of ["ona"] — `list("ona")` would
        # explode into ['o','n','a'], so wrap a string into a single-
        # element list rather than iterating its characters.
        cu = b.get("chars_used")
        if isinstance(cu, str):
            cu = [cu] if cu.strip() else []
        elif isinstance(cu, list):
            cu = [str(c).strip() for c in cu if str(c).strip()]
        else:
            cu = []
        b["chars_used"] = cu
        su = b.get("setting_used")
        b["setting_used"] = (
            su.strip() if isinstance(su, str) and su.strip() else None
        )
    draft["beats"] = beats

    # Merge story constraints: user-provided values override the LLM's
    # extraction; otherwise keep the LLM-inferred value (which now
    # comes back populated rather than blank). Move the LLM's evidence
    # quotes into global_config._constraint_evidence so the UI can
    # surface them for verification.
    gc = draft.setdefault("global_config", {})
    evidence_in = draft.pop("constraint_evidence", None) or {}
    evidence_out: dict[str, str] = {}

    def _merge(key: str, user_val: Optional[str]):
        if user_val and str(user_val).strip():
            gc[key] = str(user_val).strip()
            # User-provided: no evidence kept (it's just the user's input).
            return
        # User left blank → trust LLM's value if present; record evidence.
        if gc.get(key) is None and key not in gc:
            return
        ev = evidence_in.get(key)
        if ev and str(ev).strip():
            evidence_out[key] = str(ev).strip()

    _merge("era", era)
    _merge("country", country)
    _merge("genre", genre)
    _merge("tone", tone)
    _merge("story_anchor", story_anchor)
    _merge("world_bible", world_bible)

    # style_directives is a list — handle separately.
    if style_directives:
        cleaned = [d.strip() for d in style_directives if d and d.strip()]
        if cleaned:
            gc["style_directives"] = cleaned
    else:
        # Keep whatever the LLM proposed; ensure it's a list of strings.
        llm_dirs = gc.get("style_directives") or []
        if isinstance(llm_dirs, list):
            gc["style_directives"] = [
                str(d).strip() for d in llm_dirs if d and str(d).strip()
            ]
        ev = evidence_in.get("style_directives")
        if ev and str(ev).strip():
            evidence_out["style_directives"] = str(ev).strip()

    if evidence_out:
        gc["_constraint_evidence"] = evidence_out

    if frame_provider:
        gc["frame_provider"] = frame_provider
    if video_provider:
        gc["video_provider"] = video_provider

    logger.info(
        "[stage 00 v2 pass 1] done: %d beats, %d characters, %d props, "
        "%d scene_refs, style=%s",
        len(beats),
        len(draft.get("assets", {}).get("characters", [])),
        len(draft.get("assets", {}).get("props", [])),
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

    # Per-beat fan-out: one focused LLM call per beat, bounded by the
    # project's concurrency knob. Guarantees a 1:1 beat→scene mapping
    # (the old single-call approach compressed long beat sheets) and
    # keeps each output small enough to parse reliably.
    gc = draft_with_beats.get("global_config") or {}
    concurrency = max(1, min(8, int(gc.get("concurrency") or 5)))
    anchor_context = _pass2_anchor_context(draft_with_beats)
    sem = asyncio.Semaphore(concurrency)
    logger.info(
        "[stage 00 v2 pass 2] crafting %d scene(s), one call per beat "
        "via %s (concurrency=%d)",
        len(beats), model, concurrency,
    )

    async def _craft_one(beat_index: int, beat: dict) -> dict:
        system, user = _build_pass2_beat_prompt(
            anchor_context, beat, beat_index,
        )
        async with sem:
            try:
                resp = await _call_llm_decompose(
                    system=system, user=user,
                    model=model, api_key=api_key, timeout_s=timeout_s,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "[stage 00 v2 pass 2] beat %d (%s) craft failed: %s",
                    beat_index, beat.get("name"), exc,
                )
                resp = {}
        # The model may return the scene object directly, or wrapped
        # in {"scene": {...}} or {"scenes": [{...}]}. Unwrap.
        if isinstance(resp, dict):
            if isinstance(resp.get("scene"), dict):
                sc = resp["scene"]
            elif isinstance(resp.get("scenes"), list) and resp["scenes"]:
                sc = resp["scenes"][0]
            elif "scene_description" in resp or "name" in resp:
                sc = resp
            else:
                sc = {}
        else:
            sc = {}
        # Fallback: if the LLM gave us nothing usable, synthesize a
        # minimal scene from the beat so the project still has N scenes.
        if not sc or not sc.get("scene_description"):
            logger.warning(
                "[stage 00 v2 pass 2] beat %d (%s) produced no usable "
                "scene; falling back to beat summary",
                beat_index, beat.get("name"),
            )
            sc = {
                "name": beat.get("name", f"scene_{beat_index}"),
                "scene_description": beat.get("summary", ""),
                "motion_prompt": "",
                "narration": (
                    beat.get("summary", "")
                    if beat.get("has_narration", True) else ""
                ),
                "duration": beat.get("est_seconds", 8),
                "has_narration": beat.get("has_narration", True),
                "uses_characters": beat.get("chars_used") or [],
                "uses_props": beat.get("props_used") or [],
                "uses_scene_ref": beat.get("setting_used"),
            }
        # Carry the beat's anchor refs through if the LLM dropped them.
        if not sc.get("uses_characters"):
            sc["uses_characters"] = beat.get("chars_used") or []
        if not sc.get("uses_props"):
            sc["uses_props"] = beat.get("props_used") or []
        if not sc.get("uses_scene_ref"):
            sc["uses_scene_ref"] = beat.get("setting_used")
        return sc

    scenes = await asyncio.gather(
        *(_craft_one(i, b) for i, b in enumerate(beats)),
    )
    scenes = list(scenes)
    if not scenes:
        raise RuntimeError("Pass 2 produced no scenes")

    # Stamp ids + propagate per-project provider defaults onto each
    # scene so Stage 2 / 3 have what they need without re-resolving
    # from global_config every call. (gc resolved above.)
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
        sc.setdefault("uses_props", [])
        sc.setdefault("uses_scene_ref", None)
        sc.setdefault("uses_style", True)
        sc.setdefault("standalone", False)
        sc.setdefault("n_candidates", 1)
        try:
            sc["duration"] = int(sc.get("duration", 8))
        except (TypeError, ValueError):
            sc["duration"] = 8
        sc["has_narration"] = bool(sc.get("has_narration", True))

        # Extract inline validation_rules → per-scene block. The LLM
        # sometimes returns validation_rules as a JSON *string* or even
        # a bare list instead of the prescribed dict — coerce defensively
        # (this was the `'str' object has no attribute 'get'` crash).
        rules_inline = sc.pop("validation_rules", None)
        if isinstance(rules_inline, str):
            s = rules_inline.strip()
            try:
                rules_inline = json.loads(s) if s.startswith("{") else {}
            except (json.JSONDecodeError, ValueError):
                rules_inline = {}
        if isinstance(rules_inline, list):
            # A bare list → treat as must_contain claims.
            rules_inline = {"must_contain": rules_inline}
        if not isinstance(rules_inline, dict):
            rules_inline = {}

        def _rule_list(key: str) -> list[str]:
            v = rules_inline.get(key)
            if isinstance(v, str):
                v = [v]
            if not isinstance(v, list):
                return []
            return [str(r).strip() for r in v if r and str(r).strip()]

        cleaned = {
            "must_contain": _rule_list("must_contain"),
            "must_not_contain": _rule_list("must_not_contain"),
            "composition": _rule_list("composition"),
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
