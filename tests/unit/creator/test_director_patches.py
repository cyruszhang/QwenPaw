# -*- coding: utf-8 -*-
"""Unit tests for the director's pure patch-apply logic.

Covers ``pipeline.director.apply_director_patches`` — the validation +
application step that turns LLM-proposed per-scene patches into concrete
scene-spec edits + a changelog, defensively ignoring anything malformed.

Import-light (the module only pulls stdlib + the stage_00 LLM helper at
load), so the test adds the plugin dirs to ``sys.path`` and imports
directly. Runs under pytest or standalone
(``python test_director_patches.py``).
"""

import sys
from pathlib import Path

# pylint: disable=wrong-import-position
_REPO = Path(__file__).resolve().parents[3]
_PLUGIN = _REPO / "plugins" / "bundle" / "qwenpaw-creator"
for _p in (_PLUGIN, _PLUGIN / "skills" / "storybook-video"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from pipeline.director import apply_director_patches  # noqa: E402


def _draft():
    return {
        "scenes": [
            {
                "id": "00",
                "name": "open",
                "duration": 8,
                "scene_description": "a boy on a dock",
                "has_narration": True,
                "uses_characters": ["boy"],
                "uses_props": [],
                "uses_scene_ref": "dock",
            },
            {
                "id": "01",
                "name": "storm",
                "duration": 10,
                "scene_description": "waves rise",
                "uses_characters": ["boy"],
            },
        ],
    }


def test_applies_string_field_and_records_change():
    d = _draft()
    _, changes = apply_director_patches(
        d,
        [
            {
                "scene_id": "00",
                "set": {"scene_description": "at dusk"},
                "reason": "user asked for dusk",
            },
        ],
    )
    assert d["scenes"][0]["scene_description"] == "at dusk"
    assert len(changes) == 1
    assert changes[0]["scene_id"] == "00"
    assert changes[0]["fields"] == ["scene_description"]
    assert changes[0]["reason"] == "user asked for dusk"
    assert changes[0]["name"] == "open"


def test_coerces_duration_to_int():
    d = _draft()
    apply_director_patches(d, [{"scene_id": "01", "set": {"duration": "15"}}])
    assert d["scenes"][1]["duration"] == 15


def test_coerces_bool_field_from_string():
    d = _draft()
    apply_director_patches(
        d,
        [{"scene_id": "00", "set": {"has_narration": "false"}}],
    )
    assert d["scenes"][0]["has_narration"] is False


def test_coerces_list_field_and_wraps_bare_string():
    d = _draft()
    apply_director_patches(
        d,
        [{"scene_id": "01", "set": {"uses_props": "lantern"}}],
    )
    assert d["scenes"][1]["uses_props"] == ["lantern"]


def test_uses_scene_ref_can_be_cleared_to_none():
    d = _draft()
    apply_director_patches(
        d,
        [{"scene_id": "00", "set": {"uses_scene_ref": ""}}],
    )
    assert d["scenes"][0]["uses_scene_ref"] is None


def test_skips_unknown_scene_id():
    d = _draft()
    _, changes = apply_director_patches(
        d,
        [{"scene_id": "99", "set": {"scene_description": "x"}}],
    )
    assert changes == []
    assert d["scenes"][0]["scene_description"] == "a boy on a dock"


def test_skips_non_whitelisted_field():
    d = _draft()
    _, changes = apply_director_patches(
        d,
        [{"scene_id": "00", "set": {"id": "zz", "frame_provider": "x"}}],
    )
    assert changes == []
    assert d["scenes"][0]["id"] == "00"
    assert "frame_provider" not in d["scenes"][0]


def test_skips_uncoercible_int():
    d = _draft()
    _, changes = apply_director_patches(
        d,
        [{"scene_id": "00", "set": {"duration": "soon"}}],
    )
    assert changes == []
    assert d["scenes"][0]["duration"] == 8


def test_no_op_when_value_unchanged_is_not_reported():
    d = _draft()
    _, changes = apply_director_patches(
        d,
        [{"scene_id": "00", "set": {"duration": 8}}],
    )
    assert changes == []


def test_ignores_malformed_patches():
    d = _draft()
    _, changes = apply_director_patches(
        d,
        [
            "not a dict",
            {"scene_id": "00"},  # no "set"
            {"scene_id": "00", "set": "nope"},  # set not a dict
            {"set": {"name": "x"}},  # no scene_id
        ],
    )
    assert changes == []


def test_multiple_patches_across_scenes():
    d = _draft()
    _, changes = apply_director_patches(
        d,
        [
            {"scene_id": "00", "set": {"regen_notes": "warmer light"}},
            {"scene_id": "01", "set": {"motion_prompt": "slow push-in"}},
        ],
    )
    assert d["scenes"][0]["regen_notes"] == "warmer light"
    assert d["scenes"][1]["motion_prompt"] == "slow push-in"
    assert {c["scene_id"] for c in changes} == {"00", "01"}


def _run_standalone() -> int:
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok   {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL {fn.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  ERR  {fn.__name__}: {exc!r}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run_standalone())
