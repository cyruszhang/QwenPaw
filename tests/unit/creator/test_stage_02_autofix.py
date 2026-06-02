# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_autofix_module():
    repo = Path(__file__).resolve().parents[3]
    module_path = (
        repo
        / "plugins/bundle/qwenpaw-creator/skills/storybook-video/pipeline"
        / "stage_02_autofix.py"
    )
    skill_dir = module_path.parents[1]
    if str(skill_dir) not in sys.path:
        sys.path.insert(0, str(skill_dir))
    spec = importlib.util.spec_from_file_location(
        "qwenpaw_creator_stage_02_autofix",
        module_path,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_real_failures_ignores_indeterminate_checks():
    autofix = _load_autofix_module()

    failures = autofix.real_failures({
        "failures": [
            {"rule": "mast visible", "indeterminate": False},
            {"rule": "validator 403", "indeterminate": True},
        ],
    })

    assert failures == [{"rule": "mast visible", "indeterminate": False}]


def test_append_autofix_notes_preserves_user_notes_and_replaces_old_autofix():
    autofix = _load_autofix_module()
    draft = {
        "scenes": [
            {
                "id": "00",
                "regen_notes": (
                    "keep the warmer lighting\n"
                    "[auto-fix] stale validator note"
                ),
            },
        ],
    }

    updated = autofix.append_autofix_notes(
        draft,
        [
            (
                "00",
                {
                    "failures": [
                        {
                            "kind": "must_contain",
                            "rule": "a wooden mast",
                            "indeterminate": False,
                        },
                        {
                            "kind": "must_not_contain",
                            "rule": "extra boats",
                            "indeterminate": False,
                        },
                        {
                            "kind": "composition",
                            "rule": "marlin is larger than the skiff",
                            "indeterminate": False,
                        },
                        {
                            "kind": "must_contain",
                            "rule": "ignored validator error",
                            "indeterminate": True,
                        },
                    ],
                },
            ),
        ],
    )

    assert updated["scenes"][0]["regen_notes"] == (
        "keep the warmer lighting\n"
        "[auto-fix] Make clearly visible: a wooden mast; "
        "Remove from frame: extra boats; "
        "Fix composition: marlin is larger than the skiff"
    )
