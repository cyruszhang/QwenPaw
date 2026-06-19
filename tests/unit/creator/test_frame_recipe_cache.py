# -*- coding: utf-8 -*-
"""Unit tests for the Stage 2 frame recipe cache.

The old frame step skipped a scene whenever its PNG merely *existed*
(``if target.exists() and not overwrite``). That silently kept a stale
frame after its prompt changed, and needlessly re-baked when nothing had.
The recipe cache fingerprints everything that determines a frame's pixels
(prompt + provider + size/quality + reference bundle) into a short hash,
stashes it beside the PNG, and keeps every bake in a content-addressed
store — so a frame re-bakes only when its recipe actually changed, an
unchanged recipe is a verified skip, and a recipe baked before is restored
for free.

The helpers are pure, but ``stage_02_v15_compose`` pulls heavy deps at
import (``spec``, tool loaders), so this test extracts just the recipe
helpers via ``ast`` and execs them in isolation — same trick as
``test_language_consistency``. Runs under pytest or standalone
(``python test_frame_recipe_cache.py``).
"""

import ast
import hashlib
import json
import logging
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

# pylint: disable=wrong-import-position
_REPO = Path(__file__).resolve().parents[3]
_SRC = (
    _REPO
    / "plugins"
    / "bundle"
    / "qwenpaw-creator"
    / "skills"
    / "storybook-video"
    / "pipeline"
    / "stage_02_v15_compose.py"
)

_WANTED_FUNCS = {
    "_path_sig",
    "_refs_signature",
    "_frame_recipe",
    "_recipe_path",
    "_read_recipe",
    "_write_recipe",
}


def _load_helpers():
    tree = ast.parse(_SRC.read_text(encoding="utf-8"))
    body = []
    for n in tree.body:
        if isinstance(n, ast.FunctionDef) and n.name in _WANTED_FUNCS:
            body.append(n)
        elif isinstance(n, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_RECIPE_VERSION"
            for t in n.targets
        ):
            body.append(n)
    mod = ast.Module(body=body, type_ignores=[])
    # The extracted defs reference these names at call/annotation time.
    ns: dict = {
        "Path": Path,
        "Optional": Optional,
        "hashlib": hashlib,
        "json": json,
        "logger": logging.getLogger("test_frame_recipe_cache"),
    }
    exec(compile(mod, "<helpers>", "exec"), ns)  # noqa: S102
    return ns


_H = _load_helpers()
_path_sig = _H["_path_sig"]
_refs_signature = _H["_refs_signature"]
_frame_recipe = _H["_frame_recipe"]
_recipe_path = _H["_recipe_path"]
_read_recipe = _H["_read_recipe"]
_write_recipe = _H["_write_recipe"]


def _refs(style=(), scene_ref=(), characters=(), props=()):
    return SimpleNamespace(
        style=list(style),
        scene_ref=list(scene_ref),
        characters=list(characters),
        props=list(props),
    )


# --- _frame_recipe: stable + sensitive to every input ----------------------


def test_recipe_is_stable():
    a = _frame_recipe("a calm shot", "gpt-image-2", "1024x1024", "high", "S")
    b = _frame_recipe("a calm shot", "gpt-image-2", "1024x1024", "high", "S")
    assert a == b
    assert len(a) == 16  # short hex digest


def test_recipe_changes_with_prompt():
    a = _frame_recipe("calm", "gpt-image-2", "1024x1024", "high", "S")
    b = _frame_recipe("tense", "gpt-image-2", "1024x1024", "high", "S")
    assert a != b


def test_recipe_changes_with_each_field():
    base = _frame_recipe("p", "gpt-image-2", "1024x1024", "high", "S")
    variants = [
        _frame_recipe("p", "qwen-image", "1024x1024", "high", "S"),
        _frame_recipe("p", "gpt-image-2", "1280x720", "high", "S"),
        _frame_recipe("p", "gpt-image-2", "1024x1024", "low", "S"),
        _frame_recipe("p", "gpt-image-2", "1024x1024", "high", "S2"),
    ]
    assert base not in variants
    assert len(set(variants)) == len(variants)  # each field is distinct


# --- _path_sig / _refs_signature: track upstream ref changes ---------------


def test_path_sig_missing_file_is_stable():
    assert _path_sig("/no/such/ref.png") == "/no/such/ref.png:0:0"


def test_path_sig_tracks_content_change():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "ref.png"
        p.write_bytes(b"first")
        sig1 = _path_sig(str(p))
        # A regenerated ref has different bytes (and a fresh mtime).
        p.write_bytes(b"second-and-longer")
        sig2 = _path_sig(str(p))
        assert sig1 != sig2
        assert sig1.startswith(str(p))


def test_refs_signature_reflects_a_changed_anchor():
    with tempfile.TemporaryDirectory() as d:
        style = Path(d) / "style.png"
        char = Path(d) / "char.png"
        style.write_bytes(b"s")
        char.write_bytes(b"c")
        refs = _refs(style=[str(style)], characters=[str(char)])
        sig1 = _refs_signature(refs)
        # Re-bake one upstream character ref → frame recipe must shift.
        char.write_bytes(b"c-regenerated")
        sig2 = _refs_signature(refs)
        assert sig1 != sig2


def test_refs_signature_empty_is_stable():
    assert _refs_signature(_refs()) == ""


# --- sidecar round-trip ----------------------------------------------------


def test_recipe_path_naming():
    p = _recipe_path(Path("/proj/00_open_frame.png"))
    assert p.name == "00_open_frame.recipe.json"


def test_sidecar_roundtrip():
    with tempfile.TemporaryDirectory() as d:
        rp = Path(d) / "00_open_frame.recipe.json"
        assert _read_recipe(rp) is None  # absent
        _write_recipe(rp, "deadbeefdeadbeef", scene="00_open", provider="x")
        assert _read_recipe(rp) == "deadbeefdeadbeef"


def test_sidecar_garbage_reads_none():
    with tempfile.TemporaryDirectory() as d:
        rp = Path(d) / "broken.recipe.json"
        rp.write_text("{ not json", encoding="utf-8")
        assert _read_recipe(rp) is None


# --- the hit / miss / revert cycle the loop relies on ----------------------


def test_cache_hit_miss_revert_cycle():
    """Simulate the decision the Stage 2 loop makes across an edit + revert.

    The loop reuses a frame iff its sidecar recipe equals the recipe of the
    *current* inputs. This walks: bake A, no-op re-run (hit), edit to B
    (miss → re-bake), then revert to A served from the content-addressed
    store (no provider call needed).
    """
    with tempfile.TemporaryDirectory() as d:
        out = Path(d)
        store = out / ".frame_cache"
        store.mkdir()
        target = out / "00_open_frame.png"
        rp = _recipe_path(target)

        def recipe_for(prompt):
            return _frame_recipe(
                prompt,
                "gpt-image-2",
                "1024x1024",
                "high",
                "S",
            )

        def bake(prompt):
            rec = recipe_for(prompt)
            target.write_bytes(b"pixels-" + prompt.encode())
            (store / f"{rec}.png").write_bytes(target.read_bytes())
            _write_recipe(rp, rec)
            return rec

        # Bake prompt A.
        rec_a = bake("A")
        # No-op re-run: current recipe == stored recipe → cache HIT.
        assert _read_recipe(rp) == recipe_for("A")

        # Edit to B: current recipe != stored → MISS, must re-bake.
        assert _read_recipe(rp) != recipe_for("B")
        rec_b = bake("B")
        assert rec_a != rec_b
        assert _read_recipe(rp) == recipe_for("B")

        # Revert to A: sidecar now holds B, so it's not a plain hit...
        assert _read_recipe(rp) != recipe_for("A")
        # ...but A's bake is still in the store → restore for free.
        assert (store / f"{rec_a}.png").exists()


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok: {fn.__name__}")
    print(f"\nAll {len(fns)} frame-recipe-cache tests passed.")
