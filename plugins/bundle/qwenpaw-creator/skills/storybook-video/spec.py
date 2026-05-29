# -*- coding: utf-8 -*-
"""ProjectSpec — the contract between prompt sources and pipeline stages.

A single in-memory data structure pins down everything a storybook-video
project needs: identity / style / spatial anchors, per-scene scaffolds,
narration text, overlay specs, and global config. Pipeline stages 02-04
consume a ProjectSpec; they never touch raw prompt files.

Two prompt sources both emit a ProjectSpec:

1. **Hardcoded** (v0 benchmark) — ``prompts.py`` builds OLD_MAN_PROJECT
   from v11 literals.
2. **Interactive Stage 0** (v0.5+, deferred) — ``interactive_setup.py``
   walks the user through anchor-by-anchor selection (free-text PE,
   generate-and-approve, upload reference) and emits a ProjectSpec.

The dataclasses are deliberately shallow + frozen-friendly so a future
agent-driven Stage 0 can serialise them to JSON for HITL gates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class AnchorSet:
    """Identity / style / spatial anchors that condition every scene.

    The three text anchors are concatenated into every per-scene prompt
    by ``stage_02_assets.py`` — the verbatim repetition is the canonical
    Qwen-Image consistency trick (combined with a fixed seed and
    ``prompt_extend=False``).

    The reference-image fields are populated only when the user picks
    "Mode 3 — upload reference" in the interactive flow; they remain
    None / empty in the v0 hardcoded benchmark.
    """

    style_bookend: str
    character_prefix: str
    spatial_prefix: str
    style_ref_image: Path | None = None
    character_ref_images: list[Path] = field(default_factory=list)
    spatial_ref_image: Path | None = None


@dataclass
class OverlaySpec:
    """A single text overlay applied to a scene's video by ffmpeg+Pillow."""

    text: str
    y_ratio: float           # vertical position: 0.0 (top) .. 1.0 (bottom)
    font_size: int
    fade_in_s: float = 0.0   # seconds
    fade_out_s: float = 0.0  # seconds


@dataclass
class SceneSpec:
    """A single scene's per-panel scaffold.

    ``scene_description`` is the only piece that varies per scene; it
    gets sandwiched between AnchorSet's character_prefix/spatial_prefix
    and style_bookend at prompt-assembly time. ``motion_prompt`` drives
    Wan 2.7 I2V — separate field because motion prompts use a different
    register from frame prompts (verbs + camera directions, not nouns).

    ``standalone=True`` opts the scene out of anchor concatenation: the
    scene_description is used verbatim as the full frame prompt. Set
    this for title cards / credit scenes where the character + skiff
    anchors don't apply.
    """

    scene_id: str           # "00".."07"
    name: str               # "intro", "solitary_sailor", ...
    scene_description: str
    motion_prompt: str
    duration: int           # seconds
    has_narration: bool
    standalone: bool = False
    overlay: list[OverlaySpec] = field(default_factory=list)
    # How many image candidates to generate; Stage 02 (with selection)
    # picks the one with the fewest validation failures, breaking ties
    # toward seed-offset 0. Default 1 = single-shot, no selection cost.
    # Raise for scenes with known prompt-following difficulty.
    n_candidates: int = 1

    # v15: which locked anchors this scene's composition uses.
    # Stage 02 reads these ids, looks up the references in
    # ProjectSpec.assets, and passes the resolved images to
    # gpt-image-2's /v1/images/edits as composition references.
    uses_characters: list[str] = field(default_factory=list)
    uses_scene_ref: str | None = None
    uses_style: bool = True   # whether to also pass style.reference_image

    # Free-text user feedback appended to Stage 02's edit prompt.
    # Populated from the UI's per-frame "notes for next regen" textbox.
    # Persists across runs so re-running Stage 2 keeps the correction.
    # Clear by setting to "" to revert to the original composition.
    regen_notes: str = ""

    # Which video model Stage 3 uses for this scene. Defaults to wan27
    # (drop-in with the existing pipeline). Other options:
    #   - "happyhorse" → happyhorse-1.0-i2v
    # When adding a provider, also extend stage_03_shots.run_stage_03.
    video_provider: str = "wan27"

    # Which image model Stage 2 uses to compose this scene's frame.
    # "gpt-image-2" (default) uses OpenAI's /v1/images/edits — strong
    # prompt adherence but ~$0.20-0.30 per frame at high quality.
    # "qwen-image" uses DashScope's edit_image_qwen — roughly 5× cheaper
    # but weaker multi-ref identity coherence.
    frame_provider: str = "gpt-image-2"


@dataclass
class SceneValidationRules:
    """Per-scene rules consumed by Stage 02.5 (frame validate).

    Each list entry is a natural-language claim. Stage 02.5 formats
    each claim as a yes/no Qwen-VL question and scores the answer:

    - ``must_contain``: VLM should answer 'yes' that the claim is true
      (e.g., *"a tall vertical wooden mast clearly visible"*)
    - ``must_not_contain``: VLM should answer 'no' that the claim is
      true (e.g., *"other boats or ships visible on the horizon"*)
    - ``composition``: free-form geometric/relational claim; VLM should
      answer 'yes' (e.g., *"the marlin is at least 3 times the length
      of the skiff"*)
    """

    must_contain: list[str] = field(default_factory=list)
    must_not_contain: list[str] = field(default_factory=list)
    composition: list[str] = field(default_factory=list)


@dataclass
class ValidationRules:
    """All validation rules for a project.

    ``global_*`` applies to every non-standalone scene. ``per_scene``
    keys by scene_id; rules there are layered ON TOP of the globals.
    """

    global_must_not_contain: list[str] = field(default_factory=list)
    global_must_contain: list[str] = field(default_factory=list)
    per_scene: dict[str, SceneValidationRules] = field(default_factory=dict)


@dataclass
class CharacterRef:
    """A locked character — generated once in Stage 0a, referenced by
    every scene that contains this character.

    The image at ``reference_image`` is passed to gpt-image-2's
    ``/v1/images/edits`` endpoint alongside other refs when composing
    a per-scene frame. Identity is anchored by pixels, not by text.

    ``reference_image=None`` means the character hasn't been generated
    yet (i.e. Stage 0a hasn't run for it). The pipeline writes the
    path here after generation.
    """

    id: str                                 # short snake_case, e.g. "old_man"
    description: str                        # verbal description used to GEN the ref
    reference_image: Path | None = None     # populated by Stage 0a


@dataclass
class SceneRefAsset:
    """A locked scene/environment — generated once in Stage 0b.

    Used the same way as CharacterRef but for spatial/environmental
    contexts (open sea, dock, kitchen, classroom, ...). Lets later
    Stage 02 composition calls pin the environment.

    Named ``SceneRefAsset`` to avoid collision with ``SceneSpec``
    which already exists.
    """

    id: str                                 # e.g. "high_sea", "dock"
    description: str
    reference_image: Path | None = None     # populated by Stage 0b


@dataclass
class StyleAsset:
    """The locked style — generated once in Stage 0c.

    Resolved from the styles catalog at
    ``plugins/bundle/qwenpaw-creator/skills/storybook-video/styles/styles.yml``.
    Per-project YAML picks a ``catalog_id`` (e.g. "ghibli_watercolor")
    and Stage 0c either reuses the catalog's ``sample_ref`` or generates
    a fresh one tuned to the project.
    """

    catalog_id: str                         # "ghibli_watercolor" (lookup key)
    positive_template: str = ""             # text template from catalog
    negative_prompt: str = ""               # text negative from catalog
    reference_image: Path | None = None     # populated by Stage 0c
    description: str = ""                   # catalog description, for logs/HITL


@dataclass
class AssetSet:
    """Container for all locked assets (Stage 0 output).

    Stage 02 (frame composition) reads from this set to assemble each
    scene's reference-image bundle.
    """

    characters: dict[str, CharacterRef] = field(default_factory=dict)
    scene_refs: dict[str, SceneRefAsset] = field(default_factory=dict)
    style: StyleAsset | None = None


@dataclass
class StateChange:
    """One timeline-keyed state delta for a character / scene_ref / object.

    Row-shaped on purpose — every entry has the same flat structure so
    the YAML maps cleanly to a future SQLite ``state_changes`` table:

        CREATE TABLE state_changes (
            id INTEGER PRIMARY KEY,
            project_id TEXT,
            entity TEXT,        -- character or scene_ref id
            at_scene TEXT,      -- '00'..'07' — when the change happens
            add_states TEXT,    -- JSON array
            remove_states TEXT, -- JSON array
            reset BOOLEAN,      -- True clears all prior state for this entity
            note TEXT,
            position INTEGER    -- order within same at_scene
        );

    ``reset=True`` wipes accumulated state for this entity at that
    point in the timeline (useful for dream sequences, time-skips).
    """

    entity: str               # character/scene_ref id (e.g. "carrot_gentleman")
    at_scene: str             # scene id at which the change applies (e.g. "03")
    add: list[str] = field(default_factory=list)
    remove: list[str] = field(default_factory=list)
    reset: bool = False
    note: str = ""


@dataclass
class ProjectSpec:
    """Complete project spec — the load-bearing artifact of Stage 0.

    v15+: ``assets`` carries the locked anchor images (characters /
    scene refs / style). Each SceneSpec lists which characters and
    which scene_ref it uses by id; Stage 02 looks them up at
    composition time.

    ``state_changes`` is the timeline overlay — a flat list of deltas
    that say "at scene N, entity X gained/lost states Y". The pipeline
    folds this ledger at compose time to know what's true at each
    scene (e.g. carrot has a bandaged arm from scene 03 onward).
    """

    anchors: AnchorSet
    scenes: list[SceneSpec]
    narration: dict[str, str]   # {scene_id: text} — only for scenes with has_narration=True
    global_config: dict
    validation: ValidationRules = field(default_factory=ValidationRules)
    assets: AssetSet = field(default_factory=AssetSet)
    state_changes: list[StateChange] = field(default_factory=list)


def world_state_at(
    spec: ProjectSpec, scene_id: str, entity: str,
) -> tuple[set[str], list[str]]:
    """Fold the state ledger up to ``scene_id`` for ``entity``.

    Returns ``(active_states, notes)`` where:
      - ``active_states``: set of state ids currently true for the
        entity at this point in the timeline.
      - ``notes``: list of human-readable notes from each state change
        that contributed (useful for the Stage 2 prompt to give the
        model the "why this state" context).

    Scene ids are assumed zero-padded ('00' < '01' < ...). Changes
    with ``at_scene == scene_id`` ARE applied (the change happens AT
    that scene, not after it).
    """
    active: set[str] = set()
    notes: list[str] = []
    # Walk in author order; respect within-scene ordering as written.
    for ch in spec.state_changes:
        if ch.entity != entity:
            continue
        if ch.at_scene > scene_id:
            # Ledger is sparse; we don't assume sortedness, so we
            # check each entry instead of breaking early.
            continue
        if ch.reset:
            active.clear()
        for s in ch.remove or []:
            active.discard(s)
        for s in ch.add or []:
            active.add(s)
        if ch.note:
            notes.append(f"[{ch.at_scene}] {ch.note}")
    return active, notes


def assemble_frame_prompt(anchors: AnchorSet, scene: SceneSpec) -> str:
    """Compose the full Qwen-Image prompt for a scene.

    Stage 02 uses this; the format mirrors the v11 spec exactly:

        [character_prefix] [spatial_prefix] [scene_description] [style_bookend]
    """
    return (
        f"{anchors.character_prefix} "
        f"{anchors.spatial_prefix} "
        f"{scene.scene_description} "
        f"{anchors.style_bookend}"
    )
