# -*- coding: utf-8 -*-
"""Stage 00 — script decomposition.

Takes raw narrative source (a pasted story, an uploaded .txt / .md /
.pdf / .docx) and produces a draft ProjectSpec YAML by calling an LLM.

The LLM is instructed to:

  1. Identify recurring characters by name + verbatim physical
     description (each becomes a CharacterRef in v15).
  2. Identify recurring settings / environments (each becomes a
     SceneRefAsset).
  3. Pick a style catalog_id from the seeded styles list.
  4. Slice the story into ~6-8 scenes with:
       - scene_description (the visual scaffold for image gen)
       - motion_prompt (verbs + camera directions for Wan)
       - narration (verbatim text or paraphrase, only if has_narration)
       - which characters / scene_ref / style this scene uses
  5. Pick title-card + outro overlay text.

Output: a dict matching the v15 YAML schema. Caller serializes to YAML
and writes to ``<workspace>/creator/<project_id>/project.yml``.

Backend: DashScope's qwen-max-latest via the OpenAI-compatible
``/v1/chat/completions`` endpoint. No new SDK dependency — uses
``httpx`` which is already a QwenPaw dep.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ── Text extraction ──────────────────────────────────────────────────


def extract_text(path: Path) -> str:
    """Return the plain-text content of ``path``.

    Supported extensions:
      - .txt, .md → utf-8 decode
      - .pdf → pypdf if available, else error
      - .docx → python-docx if available, else error

    Unknown extensions fall through to utf-8 decode (so a script with
    no extension still works when the user pastes it).
    """
    if not path.exists():
        raise FileNotFoundError(f"source file not found: {path}")
    suffix = path.suffix.lower()
    if suffix in (".txt", ".md", ""):
        return path.read_text(encoding="utf-8", errors="replace")
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "PDF support requires `pypdf`. Install with: "
                "pip install pypdf",
            ) from exc
        reader = PdfReader(str(path))
        return "\n\n".join(p.extract_text() or "" for p in reader.pages)
    if suffix == ".docx":
        try:
            import docx  # type: ignore  # python-docx
        except ImportError as exc:
            raise RuntimeError(
                "DOCX support requires `python-docx`. Install with: "
                "pip install python-docx",
            ) from exc
        document = docx.Document(str(path))
        return "\n\n".join(p.text for p in document.paragraphs)
    # Best-effort fallback — try utf-8.
    return path.read_text(encoding="utf-8", errors="replace")


# ── Style catalog loading ────────────────────────────────────────────


_HERE = Path(__file__).resolve().parent
_SKILL_DIR = _HERE.parent
_STYLES_YML = _SKILL_DIR / "styles" / "styles.yml"


def _load_style_catalog_names() -> list[dict]:
    """Return one entry per style: id, display_name, description.

    Used to inform the LLM about the available style ids so it picks
    a real one (instead of inventing ``ghibli_v2`` or similar).
    """
    try:
        import yaml  # type: ignore
    except ImportError:
        logger.warning("PyYAML not available — using hardcoded style list")
        return [{"id": "ghibli_watercolor", "display_name": "Soft watercolor"}]
    if not _STYLES_YML.exists():
        return []
    data = yaml.safe_load(_STYLES_YML.read_text(encoding="utf-8")) or {}
    out: list[dict] = []
    for s in data.get("styles", []):
        out.append({
            "id": s.get("id"),
            "display_name": s.get("display_name", s.get("id")),
            "description": (s.get("description") or "").strip()[:200],
        })
    return out


# ── LLM call ─────────────────────────────────────────────────────────


_DASHSCOPE_OPENAI_BASE = (
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
)
_DEFAULT_MODEL = "qwen-max"


def _build_decompose_prompt(
    text: str,
    *,
    duration_target_s: int,
    style_hint: Optional[str],
    audience: Optional[str],
    voice: str,
    style_catalog: list[dict],
    era: Optional[str] = None,
    country: Optional[str] = None,
    genre: Optional[str] = None,
    tone: Optional[str] = None,
    story_anchor: Optional[str] = None,
    style_directives: Optional[list[str]] = None,
    world_bible: Optional[str] = None,
) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) for the decomposition call."""
    styles_table = "\n".join(
        f"  - {s['id']}: {s['display_name']} — {s['description']}"
        for s in style_catalog
    )
    directives_block = ""
    if style_directives:
        directives_block = (
            "\n# Style directives (apply to every scene's composition):\n"
            + "\n".join(f"  - {d}" for d in style_directives if d.strip())
            + "\n"
        )
    anchor_block = ""
    if story_anchor:
        anchor_block = (
            "\n# Story anchor (overall narrative context — propagate "
            "implicitly to every scene's tone and composition):\n"
            f"{story_anchor.strip()}\n"
        )
    world_bible_block = ""
    if world_bible:
        world_bible_block = (
            "\n# World bible (recurring set-design facts that apply "
            "to EVERY scene_ref and EVERY scene composition — these "
            "are invariants, not options):\n"
            f"{world_bible.strip()}\n"
        )

    system = (
        "You are the storyboard director for a short narrated video. "
        "Given a piece of source narrative (story, poem, blog post, "
        "speech, or rough prompt), you decompose it into a structured "
        "JSON storyboard suitable for an image-and-video generation "
        "pipeline.\n\n"
        "The pipeline is ANCHOR-LOCKED: each recurring character and "
        "each recurring setting must be generated ONCE as a reference "
        "image, then re-used across scenes. Your job is to identify "
        "those recurring anchors and to write per-scene visual "
        "descriptions that reference them.\n\n"
        "Output ONLY valid JSON — no markdown fences, no commentary "
        "outside the JSON. The JSON must match the schema in the user "
        "message exactly."
    )

    constraints = [
        f"- Total video duration: ~{duration_target_s} seconds, "
        f"split into 5-8 scenes of 6-12 seconds each.",
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
        "# Required JSON output schema (anchor-locked v15):\n"
        "{\n"
        '  "project_id": "<short_snake_case>",\n'
        '  "title": "<title text for the intro card>",\n'
        '  "byline": "<sub-title, e.g. \\"based on X\\" or empty>",\n'
        '  "global_config": {\n'
        '    "image_size": "1024x1024", "video_resolution": "1080P",\n'
        f'    "voice": "{voice}", "tts_format": "mp3",\n'
        '    "tts_sample_rate": 22050, "tts_speech_rate": 1.0\n'
        "  },\n"
        '  "assets": {\n'
        '    "style": {"catalog_id": "<id from catalog above>"},\n'
        '    "characters": [\n'
        '      {"id": "<short_snake_case>",\n'
        '       "description": "<verbatim physical description "\n'
        '          "ending with the words \\"reference sheet, not a "\n'
        '          "scene\\". Neutral pose, empty background. 60-150 "\n'
        '          "words. Include every load-bearing visual detail "\n'
        '          "exactly as it should appear in every scene — "\n'
        '          "hair color, age, clothes (including hats, shoes), "\n'
        '          "build, distinguishing marks.">"\n'
        "      },\n"
        "      ...\n"
        "    ],\n"
        '    "scene_refs": [\n'
        '      {"id": "<short_snake_case>",\n'
        '       "description": "<environmental setting only — NO "\n'
        '          "characters, NO objects beyond the setting. 40-100 "\n'
        '          "words. Empty stage waiting for actors.">"\n'
        "      },\n"
        "      ...\n"
        "    ]\n"
        "  },\n"
        '  "scenes": [\n'
        '    {"id": "00", "name": "<short_snake>",\n'
        '     "duration": 6, "has_narration": false,\n'
        '     "standalone": true,\n'
        '     "uses_characters": [], "uses_scene_ref": "<id or null>",\n'
        '     "uses_style": true,\n'
        '     "scene_description": "<ACTIONS AND CHARACTER POSITIONS '
        'ONLY — what each character does, where they stand/sit, what '
        'they hold, what they look at. DO NOT redescribe the setting '
        '(the scene_ref image owns the camera angle, background, '
        'palette, lighting). DO NOT redescribe character identity '
        '(the character_ref images own clothes/face/body). Reference '
        'characters/setting as \\"the carrot_gentleman from the '
        'reference\\" and \\"same vegetable_garden as in the scene '
        'reference\\". 30-80 words, focused on the verb and the '
        'composition.>",\n'
        '     "motion_prompt": "<verbs + camera. NO character ids.>",\n'
        '     "overlays": [{"text": "<title>", "y_ratio": 0.30, '
        '         "font_size": 56, "fade_in_s": 0.5, "fade_out_s": 0.0}]\n'
        "    },\n"
        "    {<inner scenes — has_narration:true, "
        '         narration: "<verbatim text or paraphrase">},\n'
        '    {<outro card — has_narration:false, standalone:true, '
        '         overlays:[credits]>}\n'
        "  ]\n"
        "}\n\n"
        "# Anchor-locking discipline (CRITICAL):\n\n"
        "0. SEPARATION OF CONCERNS — anchors own visual identity; "
        "scene_descriptions own actions. The character_ref images "
        "own each character's identity (clothes, face, body). The "
        "scene_ref images own the setting (camera angle, background, "
        "palette, lighting). Each scene_description must describe "
        "ONLY what characters do and where they're positioned — "
        "NOT what they look like or what the setting looks like. "
        "If the same setting recurs across scenes, the prose should "
        "say \"same vegetable_garden as the scene reference\" — "
        "never re-describe the garden's contents.\n"
        "1. Every character that appears in ≥1 scene must have an "
        "entry under assets.characters. Even one-off characters get "
        "an entry — single anchor reuse is fine.\n"
        "2. Every recurring location must have an entry under "
        "assets.scene_refs. Don't include locations that appear in "
        "only one scene unless they're large/visually distinctive.\n"
        "3. In each scene_description, refer to characters as '<the "
        "old man from the reference>' or 'the same boat as in the "
        "boat reference'. The image-edit model will receive both the "
        "ref images and this text, so explicit reference language "
        "anchors the identity.\n"
        "4. motion_prompt drives the I2V model — it must describe "
        "MOTION (camera moves, character actions, environmental "
        "movement). It must NOT include character ids; treat it as a "
        "second prompt that sees the composed frame.\n"
        "5. First scene is the title card: standalone=true, "
        "has_narration=false, overlays carry the title.\n"
        "6. Last scene is the credits card: standalone=true, "
        "has_narration=false, overlays carry the credits.\n"
        "7. Inner scenes carry has_narration=true with narration text "
        "≤ duration * 18 characters (rough TTS budget at 1.0x rate).\n"
        "8. Pick the style catalog id whose visual language best fits "
        "the source (children's story → ghibli_watercolor / "
        "pastel_storybook; thriller → photoreal_cinema; etc.).\n\n"
        "Return ONLY the JSON object, no preamble.\n"
    )
    return system, user


async def _call_llm_decompose(
    *,
    system: str,
    user: str,
    model: str,
    api_key: str,
    timeout_s: float,
) -> dict:
    """POST to DashScope's OpenAI-compatible /chat/completions endpoint
    and return the parsed JSON response from the model.

    Raises on transport errors or unparseable JSON.
    """
    import httpx  # type: ignore

    url = f"{_DASHSCOPE_OPENAI_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
    }
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(
            f"LLM decompose call failed: {resp.status_code} {resp.text[:500]}",
        )
    body = resp.json()
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"unexpected LLM response shape: {body}") from exc
    # Strip possible markdown fences just in case the model misbehaves.
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\n", "", content)
        content = re.sub(r"\n```\s*$", "", content)
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"LLM returned non-JSON: {exc}\n---\n{content[:800]}",
        ) from exc


# ── Post-processing ──────────────────────────────────────────────────


def _ensure_style_catalog_block(draft: dict, catalog: list[dict]) -> None:
    """Pull the chosen catalog id's positive_template + negative_prompt
    into the draft so downstream Stage 0c can skip the YAML round-trip.

    This makes the draft self-contained; the catalog file remains the
    source of truth, but the per-project file carries a snapshot.
    """
    assets = draft.setdefault("assets", {})
    style = assets.get("style") or {}
    cid = style.get("catalog_id")
    if not cid:
        return
    chosen = next((s for s in catalog if s.get("id") == cid), None)
    if not chosen:
        logger.warning(
            "[stage 00] LLM picked unknown style id %r — leaving as-is",
            cid,
        )
        return
    # Re-load the full entry from the catalog (we only kept summaries
    # in catalog), if PyYAML available.
    try:
        import yaml  # type: ignore

        full = yaml.safe_load(_STYLES_YML.read_text(encoding="utf-8")) or {}
        for s in full.get("styles", []):
            if s.get("id") == cid:
                style.setdefault("positive_template", s.get("positive_template", ""))
                style.setdefault("negative_prompt", s.get("negative_prompt", ""))
                style.setdefault("description", s.get("description", ""))
                break
    except Exception as exc:  # noqa: BLE001
        logger.warning("[stage 00] could not enrich style block: %s", exc)
    assets["style"] = style


def _normalize_ids(draft: dict) -> None:
    """Lowercase + snake_case all ids; renumber scene ids to "00", "01"...
    so downstream filename templates stay clean.
    """

    def snake(s: str) -> str:
        s = re.sub(r"[^a-zA-Z0-9]+", "_", (s or "").strip()).strip("_").lower()
        return s or "x"

    pid = draft.get("project_id") or "storybook"
    draft["project_id"] = snake(pid)

    for ch in draft.get("assets", {}).get("characters", []) or []:
        ch["id"] = snake(ch.get("id", ""))
    for sr in draft.get("assets", {}).get("scene_refs", []) or []:
        sr["id"] = snake(sr.get("id", ""))

    for idx, sc in enumerate(draft.get("scenes", []) or []):
        sc["id"] = f"{idx:02d}"
        sc["name"] = snake(sc.get("name", f"scene_{idx}"))


_GLOBAL_CONFIG_DEFAULTS: dict = {
    "seed": 42,
    "image_size": "1024x1024",
    "image_prompt_extend": False,
    "video_resolution": "1080P",
    "video_prompt_extend": True,
    "voice": "longshu_v2",
    "tts_format": "mp3",
    "tts_sample_rate": 22050,
    "tts_speech_rate": 1.0,
    "frame_provider": "gpt-image-2",
    "video_provider": "wan27",
}


def _fill_global_config_defaults(draft: dict) -> None:
    """The LLM is loose about which global_config keys it emits. Pre-fill
    every key Stage 1-4 reads with a sensible default so a barebones
    decompose doesn't crash downstream on a missing key.
    """
    gc = draft.setdefault("global_config", {})
    for k, v in _GLOBAL_CONFIG_DEFAULTS.items():
        gc.setdefault(k, v)


def _add_anchor_fallback(draft: dict) -> None:
    """Synthesize the legacy AnchorSet text fields from the assets so
    pre-v15 stages (Qwen-Image fallback) still have something to use.
    The values here are intentionally short; v15 image-edit Stage 02
    ignores them.
    """
    assets = draft.get("assets", {})
    chars = assets.get("characters") or []
    refs = assets.get("scene_refs") or []
    style = (assets.get("style") or {}).get("description", "")
    if "anchors" not in draft:
        draft["anchors"] = {}
    anc = draft["anchors"]
    if "style_bookend" not in anc:
        anc["style_bookend"] = (style or "").strip() or (
            "Soft hand-painted storybook style. No text or letters."
        )
    if "character_prefix" not in anc and chars:
        names = ", ".join(c.get("id", "") for c in chars[:3])
        anc["character_prefix"] = (
            f"Characters from the references ({names})."
        )
    if "spatial_prefix" not in anc and refs:
        rnames = ", ".join(r.get("id", "") for r in refs[:2])
        anc["spatial_prefix"] = f"Settings from the references ({rnames})."


# ── Public entry ─────────────────────────────────────────────────────


async def decompose_script(
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
    frame_provider: Optional[str] = None,
    video_provider: Optional[str] = None,
) -> dict:
    """Run the LLM decomposition and return a draft ProjectSpec dict.

    The returned dict is YAML-serializable and matches the v15 schema
    parsed by ``yaml_loader.load_project_spec_from_dict``.

    Raises ``RuntimeError`` on LLM error / parse failure.
    """
    catalog = _load_style_catalog_names()
    system, user = _build_decompose_prompt(
        text,
        duration_target_s=duration_target_s,
        style_hint=style_hint,
        audience=audience,
        voice=voice,
        style_catalog=catalog,
        era=era,
        country=country,
        genre=genre,
        tone=tone,
        story_anchor=story_anchor,
        style_directives=style_directives,
        world_bible=world_bible,
    )
    logger.info(
        "[stage 00] decomposing %d-char source via %s "
        "(target %ds, voice %s)",
        len(text), model, duration_target_s, voice,
    )
    draft = await _call_llm_decompose(
        system=system, user=user,
        model=model, api_key=api_key, timeout_s=timeout_s,
    )
    _normalize_ids(draft)
    _ensure_style_catalog_block(draft, catalog)
    _add_anchor_fallback(draft)
    _fill_global_config_defaults(draft)

    # Preserve the user-supplied story-level constraints into
    # global_config so Stage 2's compose prompt can layer them on top
    # of each scene description. The LLM may or may not echo them in
    # its output — we save authoritative copies regardless.
    gc = draft.setdefault("global_config", {})
    if era:
        gc["era"] = era
    if country:
        gc["country"] = country
    if genre:
        gc["genre"] = genre
    if tone:
        gc["tone"] = tone
    if story_anchor and story_anchor.strip():
        gc["story_anchor"] = story_anchor.strip()
    if world_bible and world_bible.strip():
        gc["world_bible"] = world_bible.strip()
    if style_directives:
        cleaned = [d.strip() for d in style_directives if d and d.strip()]
        if cleaned:
            gc["style_directives"] = cleaned
    # Provider picks come from the decompose form (the "first step" UX)
    # and are written both to global_config and to every scene so the
    # later stages don't have to re-resolve from globals.
    if frame_provider:
        gc["frame_provider"] = frame_provider
    if video_provider:
        gc["video_provider"] = video_provider
    fp_apply = gc.get("frame_provider")
    vp_apply = gc.get("video_provider")
    for scene in draft.get("scenes", []) or []:
        if fp_apply:
            scene["frame_provider"] = fp_apply
        if vp_apply:
            scene["video_provider"] = vp_apply
    logger.info(
        "[stage 00] draft built: %d scenes, %d characters, %d scene_refs, "
        "style=%s",
        len(draft.get("scenes", [])),
        len(draft.get("assets", {}).get("characters", []) or []),
        len(draft.get("assets", {}).get("scene_refs", []) or []),
        (draft.get("assets", {}).get("style") or {}).get("catalog_id"),
    )
    return draft


def draft_to_yaml(draft: dict) -> str:
    """Serialize the draft dict to YAML text suitable for writing to
    ``project.yml``. Uses default-flow-style block mode + 2-space indent
    so it matches the existing v15 YAML aesthetic.
    """
    try:
        import yaml  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "PyYAML required to serialize draft. Install with: pip install pyyaml",
        ) from exc

    def _lb_presenter(dumper, data):  # noqa: ANN001
        if "\n" in data:
            return dumper.represent_scalar(
                "tag:yaml.org,2002:str", data, style="|",
            )
        return dumper.represent_scalar("tag:yaml.org,2002:str", data)

    yaml.add_representer(str, _lb_presenter)
    return yaml.dump(
        draft,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
        width=78,
    )
